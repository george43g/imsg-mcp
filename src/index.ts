/**
 * iMessage MCP Server
 * Enables AI agents to send and receive iMessages on macOS
 */

import { execSync } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { checkLocalAccess, formatAccessReport } from "./access-check.js";
import { checkMessagesAvailable, sendMessageAlt, sendToChat, sendToChatId } from "./applescript.js";
import { getContactsDbPaths, getImsgDbPath, getSlugsDbPath } from "./config.js";
import { IMessageDB } from "./imessage-db.js";
import { appendLog, getFileLogLines, getLastSendError, getLogDirectory, getLogFilePath, getLogs, info, logShutdown, logStartup, perf, startHeapMonitor, stopHeapMonitor } from "./logger.js";
import { enableOrphanWatchdog, enableStdinEofDetection, installShutdownHandlers, registerCleanup, shutdown } from "./shutdown.js";
import { hasNativeModule } from "./native-bridge.js";
import { installWatchdog, noteActivity, readWatchdogState } from "./watchdog.js";
import { APP_NAME, APP_VERSION } from "./meta.js";
import type { Message } from "./types.js";

// Tool input schemas
//
// Limit semantics:
//   - 0 means UNLIMITED — bounded only by the per-tool timeout (Priority 1a).
//   - omitted -> default
//   - positive integer -> exact cap
// All previous hard upper bounds (50/100/500/1000) have been removed; the
// timeout watchdog provides safety instead of arbitrary numeric caps.
const UNLIMITED = Number.MAX_SAFE_INTEGER;

/** Resolve a user-supplied limit (with 0 = unlimited) to a concrete number for the DB layer. */
function resolveLimit(limit: number | undefined, defaultValue = 20): number {
  if (limit === undefined) return defaultValue;
  if (limit === 0) return UNLIMITED;
  return limit;
}

const GetMessagesSchema = z.object({
  limit: z.number().int().min(0).default(20).describe("Number of messages to retrieve. 0 = unlimited (bounded only by tool timeout). Default 20."),
  chatIdentifier: z.string().optional().describe("Phone number, email, or chat ID to filter by"),
  threadSlug: z.string().optional().describe("Thread slug from list_conversations"),
});

const GetUnreadMessagesSchema = z.object({
  limit: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Max unread messages. 0 = unlimited. Default 100."),
});

const SendMessageSchema = z.object({
  recipient: z.string().optional().describe("Phone number or email address to send to"),
  threadSlug: z
    .string()
    .optional()
    .describe("Thread slug (from list_conversations) to send to — works for groups too"),
  message: z.string().describe("Message text to send"),
});

const WaitForReplySchema = z.object({
  chatIdentifier: z.string().optional().describe("Phone number, email, or chat ID to monitor"),
  threadSlug: z.string().optional().describe("Thread slug (from list_conversations) to monitor"),
  timeoutSeconds: z
    .number()
    .min(10)
    .max(3600)
    .default(300)
    .describe("Timeout in seconds (default 5 minutes)"),
  pollIntervalSeconds: z
    .number()
    .min(5)
    .max(60)
    .default(10)
    .describe("How often to check for replies"),
  afterMessageId: z.number().optional().describe("Only return messages after this ID"),
});

const ListConversationsSchema = z.object({
  limit: z.number().int().min(0).default(20).describe("Number of conversations. 0 = unlimited (bounded only by tool timeout). Default 20."),
});

const SearchMessagesSchema = z.object({
  query: z.string().describe("Search query"),
  limit: z.number().int().min(0).default(20).describe("Number of results. 0 = unlimited (bounded only by tool timeout). Default 20."),
});

const GetLogsSchema = z.object({
  tail: z.number().min(1).max(500).optional().describe("Return only last N lines (default: 50)"),
  source: z.enum(["memory", "file", "all"]).optional().describe("Log source: memory, file, or all"),
});

const _RunBuildSchema = z.object({});
const _RequestRestartSchema = z.object({});

// ── Per-tool timeouts ────────────────────────────────────────────────────
//
// Every tool dispatch is wrapped in a Promise.race against this timeout so
// that a single bad query or hung handler never wedges the MCP protocol.
// On timeout, the tool returns isError:true to the host (which unblocks the
// agent immediately) — the orphaned promise keeps running but the watchdog
// will catch the resulting event-loop lag if it persists.
const TOOL_TIMEOUTS_MS: Record<string, number> = {
  // wait_for_reply has its own timeoutSeconds parameter (max 1h) — don't
  // double-clip it here, just give it generous headroom.
  wait_for_reply: 0, // 0 = no wrapper timeout
  run_build: 120_000,
  search_messages: 60_000,
  get_messages: 60_000,
  list_conversations: 60_000,
  get_unread_messages: 60_000,
  send_message: 60_000,
  // Health/status tools should be near-instant — short ceiling
  health_check: 5_000,
  get_logs: 10_000,
  get_last_send_error: 5_000,
  request_restart: 5_000,
};
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

class ToolTimeoutError extends Error {
  constructor(public readonly toolName: string, public readonly timeoutMs: number) {
    super(`Tool '${toolName}' timed out after ${timeoutMs}ms. The MCP server has unblocked; the underlying query may still be running in the background.`);
    this.name = "ToolTimeoutError";
  }
}

/** Race a tool handler against its configured timeout. */
function withTimeout<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
  const ms = TOOL_TIMEOUTS_MS[toolName] ?? DEFAULT_TOOL_TIMEOUT_MS;
  if (ms <= 0) return fn();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ToolTimeoutError(toolName, ms)), ms);
    timer.unref();
    fn().then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// Tool definitions
const TOOLS = [
  {
    name: "get_messages",
    description: "Get recent iMessages. Can optionally filter by a specific conversation.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of messages to retrieve. 0 = unlimited (bounded only by tool timeout). Default 20.",
          default: 20,
        },
        chatIdentifier: {
          type: "string",
          description: "Phone number, email, or chat ID to filter by",
        },
        threadSlug: {
          type: "string",
          description: "Thread slug from list_conversations",
        },
      },
    },
  },
  {
    name: "get_unread_messages",
    description:
      "Get unread iMessages across all conversations, sorted by date descending (newest first).",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max unread messages. 0 = unlimited (bounded only by tool timeout). Default 100.",
        },
      },
    },
  },
  {
    name: "send_message",
    description:
      "Send an iMessage or SMS. Use recipient (phone/email) for 1-on-1 or threadSlug (from list_conversations) for any thread including groups.",
    inputSchema: {
      type: "object",
      properties: {
        recipient: {
          type: "string",
          description: "Phone number (e.g., +1234567890) or email address",
        },
        threadSlug: {
          type: "string",
          description: "Thread slug from list_conversations — works for groups too",
        },
        message: { type: "string", description: "Message text to send" },
      },
      required: ["message"],
    },
  },
  {
    name: "wait_for_reply",
    description:
      "Wait for a reply in a specific conversation. Use chatIdentifier (phone/email) or threadSlug. Polls until a new message arrives or timeout.",
    inputSchema: {
      type: "object",
      properties: {
        chatIdentifier: {
          type: "string",
          description: "Phone number, email, or chat ID to monitor",
        },
        threadSlug: { type: "string", description: "Thread slug from list_conversations" },
        timeoutSeconds: {
          type: "number",
          description: "Timeout in seconds (10-3600, default 300)",
          default: 300,
        },
        pollIntervalSeconds: {
          type: "number",
          description: "How often to check for replies (5-60 seconds)",
          default: 10,
        },
        afterMessageId: { type: "number", description: "Only return messages after this ID" },
      },
    },
  },
  {
    name: "list_conversations",
    description:
      "List recent conversations with metadata like last message date and participant info.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of conversations to list. 0 = unlimited (bounded only by tool timeout). Default 20.",
          default: 20,
        },
      },
    },
  },
  {
    name: "search_messages",
    description: "Search for messages containing specific text across all conversations.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Number of results. 0 = unlimited (bounded only by tool timeout). Default 20.", default: 20 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_logs",
    description:
      "Return debug log lines from this MCP server. Source: 'memory' (in-process buffer, default), 'file' (NDJSON log from $TMPDIR/imsg-mcp/), or 'all' (both). File logs persist across restarts and include perf spans, heartbeats, startup/shutdown markers. A log file missing a 'shutdown' entry indicates a crash or hang.",
    inputSchema: {
      type: "object",
      properties: {
        tail: { type: "number", description: "Return only last N lines (default: 50)" },
        source: { type: "string", enum: ["memory", "file", "all"], description: "Log source (default: memory)" },
      },
    },
  },
  {
    name: "get_last_send_error",
    description:
      "Return the last send_message/send failure details (stderr, stdout, code from osascript). Use to debug why texting failed.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "run_build",
    description:
      "Run `pnpm build` in the project directory and return stdout/stderr. Restart the MCP server after building to load new code.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "request_restart",
    description:
      "Exit the MCP server process so the client can restart it and load new code. Call after run_build to apply changes.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "health_check",
    description:
      "Return MCP server vital signs: uptime, heap, RSS, event-loop lag, recent activity, tool call count, engine. Reads in-memory state only — returns instantly even when SQL is blocked, so it's the right tool to verify the server is alive when other calls hang.",
    inputSchema: { type: "object", properties: {} },
  },
];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Format a millisecond duration as e.g. "1h 23m" or "5s". */
function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const sec = Math.floor(ms / 1_000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

/**
 * Format a date as a relative short string ("Today 12:05 AM", "Yesterday 3:14 PM", or "2/14 9:00 AM").
 */
function relativeDate(d: Date): string {
  const now = new Date();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return `Yesterday ${time}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

/**
 * Format a message for output with display name, service, relative date, and delivery status.
 * Optional conversationLabel adds context for cross-conversation views (unread, search).
 */
function formatMessage(msg: Message, conversationLabel?: string): string {
  const direction = msg.isFromMe ? "→" : "←";
  const dateStr = relativeDate(msg.date);
  const svcTag = msg.service === "SMS" ? " [SMS]" : "";

  let sender: string;
  if (msg.isFromMe) {
    sender = "me";
  } else if (msg.displayName && msg.displayName !== msg.handle) {
    sender = `${msg.displayName} (${msg.handle})`;
  } else {
    sender = msg.handle;
  }

  let status = "";
  if (!msg.isFromMe && !msg.isRead) {
    status = " [UNREAD]";
  } else if (msg.isFromMe) {
    if (msg.dateRead) {
      status = ` [Read ${msg.dateRead.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}]`;
    } else if (msg.isDelivered) {
      status = " [Delivered]";
    }
  }

  const convCtx = conversationLabel ? ` {${conversationLabel}}` : "";
  return `[${dateStr}] ${direction} ${sender}${svcTag}: ${msg.text || "(no text)"}${status}${convCtx}`;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main MCP server class
 */
class IMessageMCPServer {
  private server: Server;
  private db: IMessageDB;

  // Activity tracking — surfaced via health_check and watchdog
  private toolCallCount = 0;
  private recentErrorCount = 0;
  private lastActivityTs = Date.now();

  constructor() {
    this.server = new Server(
      {
        name: APP_NAME,
        version: APP_VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.db = new IMessageDB(getImsgDbPath(), getContactsDbPaths(), getSlugsDbPath());
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS,
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name, arguments: args } = request.params;
      this.lastActivityTs = Date.now();
      this.toolCallCount++;
      noteActivity();

      // The SDK gives us an AbortSignal per request that fires when the host
      // sends notifications/cancelled with this request's id. We pass it down
      // to long-running handlers so they can bail out early.
      const signal = extra?.signal;

      try {
        return await withTimeout(name, () => this.dispatchTool(name, args, signal));
      } catch (error: any) {
        const isTimeout = error instanceof ToolTimeoutError;
        appendLog(isTimeout ? "warn" : "error", isTimeout ? "Tool timed out" : "Tool error", {
          tool: name,
          error: error.message || String(error),
        });
        if (!isTimeout) this.recentErrorCount++;
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message || String(error)}`,
            },
          ],
          isError: true,
        };
      } finally {
        this.db.scheduleBackgroundRefresh();
      }
    });
  }

  private async dispatchTool(name: string, args: unknown, signal?: AbortSignal) {
    switch (name) {
      case "get_messages":
        return await this.handleGetMessages(args);
      case "get_unread_messages":
        return await this.handleGetUnreadMessages(args);
      case "send_message":
        return await this.handleSendMessage(args);
      case "wait_for_reply":
        return await this.handleWaitForReply(args, signal);
      case "list_conversations":
        return await this.handleListConversations(args);
      case "search_messages":
        return await this.handleSearchMessages(args);
      case "get_logs":
        return await this.handleGetLogs(args);
      case "get_last_send_error":
        return await this.handleGetLastSendError();
      case "run_build":
        return await this.handleRunBuild();
      case "request_restart":
        return await this.handleRequestRestart();
      case "health_check":
        return await this.handleHealthCheck();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleGetLogs(args: unknown) {
    const { tail, source } = GetLogsSchema.parse(args ?? {});
    const n = tail ?? 50;
    const sections: string[] = [];

    if (source !== "file") {
      const memLines = getLogs(n);
      sections.push(`## In-Memory Logs (${memLines.length} lines)\n${memLines.length === 0 ? "No log lines yet." : memLines.join("\n")}`);
    }

    if (source === "file" || source === "all") {
      const fileLines = getFileLogLines(n);
      const logPath = getLogFilePath() ?? getLogDirectory();
      sections.push(`## File Logs (${logPath})\n${fileLines.length === 0 ? "No file log entries." : fileLines.join("\n")}`);
    }

    if (source !== "file" && source !== "all") {
      // Also show log file location for reference
      const logPath = getLogFilePath() ?? getLogDirectory();
      sections.push(`\n📁 Full NDJSON logs: ${logPath}`);
    }

    return { content: [{ type: "text", text: sections.join("\n\n") }] };
  }

  private async handleGetLastSendError() {
    const err = getLastSendError();
    if (!err) {
      return {
        content: [
          {
            type: "text",
            text: "No send failure recorded. Last send either succeeded or occurred before this server run.",
          },
        ],
      };
    }
    const text = [
      "Last send_message failure:",
      `  message: ${err.message}`,
      `  timestamp: ${err.timestamp}`,
      err.stderr != null ? `  stderr: ${err.stderr}` : "",
      err.stdout != null ? `  stdout: ${err.stdout}` : "",
      err.code != null ? `  code: ${err.code}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return { content: [{ type: "text", text }] };
  }

  private async handleRunBuild(): Promise<any> {
    try {
      const out = execSync("pnpm build", {
        encoding: "utf-8",
        maxBuffer: 2 * 1024 * 1024,
        cwd: process.cwd(),
      });
      return { content: [{ type: "text", text: `Build succeeded.\n\nstdout:\n${out}` }] };
    } catch (error: any) {
      const stderr = error.stderr?.toString?.() ?? error.message ?? "";
      const stdout = error.stdout?.toString?.() ?? "";
      appendLog("error", "run_build failed", { stderr, stdout });
      return {
        content: [
          { type: "text", text: `Build failed.\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}` },
        ],
        isError: true,
      };
    }
  }

  private async handleRequestRestart(): Promise<any> {
    const msg =
      "Restart requested. Please restart the MCP server in your client (e.g. Cursor) to load new code.";
    setImmediate(() => shutdown(0));
    return { content: [{ type: "text", text: msg }] };
  }

  /**
   * Returns vital signs in a fixed text format. Designed to never touch the
   * DB so it returns instantly even when SQL is blocked — that's the whole
   * point: this tool verifies "the MCP is alive even though queries are slow".
   */
  private async handleHealthCheck(): Promise<any> {
    const wd = readWatchdogState();
    const uptimeMs = Date.now() - wd.startedAt;
    const idleMs = Date.now() - this.lastActivityTs;

    // Compute status: healthy < degraded < unhealthy
    let status = "healthy";
    const issues: string[] = [];
    if (wd.eventLoopP99Ms > 500) {
      status = "degraded";
      issues.push(`event-loop lag p99 ${wd.eventLoopP99Ms.toFixed(0)}ms`);
    }
    if (wd.eventLoopP99Ms > 5_000) {
      status = "unhealthy";
    }
    if (wd.rssMb > 800) {
      status = status === "healthy" ? "degraded" : status;
      issues.push(`RSS ${wd.rssMb}MB`);
    }
    if (this.recentErrorCount > 5) {
      status = status === "healthy" ? "degraded" : status;
      issues.push(`${this.recentErrorCount} recent errors`);
    }

    const lines = [
      `Status: ${status}`,
      issues.length ? `Issues: ${issues.join("; ")}` : "",
      "",
      `Uptime: ${formatDuration(uptimeMs)}`,
      `Last activity: ${formatDuration(idleMs)} ago`,
      `PID: ${process.pid}`,
      `Node: ${process.version}`,
      "",
      `Heap: ${wd.heapMb || round1(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      `RSS: ${wd.rssMb || round1(process.memoryUsage().rss / 1024 / 1024)}MB`,
      `Event-loop p99: ${wd.eventLoopP99Ms.toFixed(1)}ms`,
      `Event-loop max: ${wd.eventLoopMaxMs.toFixed(1)}ms`,
      "",
      `Total tool calls: ${this.toolCallCount}`,
      `Recent errors: ${this.recentErrorCount}`,
      `Engine: ${hasNativeModule() ? "Rust+TS" : "TS"}`,
    ].filter((l) => l !== null);

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  private async handleGetMessages(args: unknown) {
    const span = perf("tool:get_messages");
    const parsed = GetMessagesSchema.parse(args);
    const { chatIdentifier, threadSlug } = parsed;
    const limit = resolveLimit(parsed.limit);

    let messages: Message[];
    let threadHeader = "";
    if (chatIdentifier || threadSlug) {
      let targetIdentifier = chatIdentifier;
      if (threadSlug) {
        const slugRecord = this.db.getSlugRecord(threadSlug);
        if (!slugRecord) {
          return {
            content: [{ type: "text", text: `Unknown thread slug: ${threadSlug}` }],
            isError: true,
          };
        }
        targetIdentifier = slugRecord.chatIdentifier;
      }

      messages = await this.db.getMessagesForChat(targetIdentifier!, limit);
      const conv = await this.db.findChatByHandle(targetIdentifier!);
      if (conv) {
        const name = conv.displayName || conv.rawIdentifier;
        const ident = conv.displayName ? ` (${conv.rawIdentifier})` : "";
        const kind = conv.isGroupChat ? "Group" : "1-on-1";
        threadHeader = `Thread: ${conv.threadSlug} | ${name}${ident} | ${conv.serviceType} | ${kind}\n\n`;
      }
    } else {
      messages = await this.db.getRecentMessages(limit);
    }

    const durMs = span.end({ limit, returned: messages.length });

    if (messages.length === 0) {
      return {
        content: [{ type: "text", text: `${threadHeader}No messages found.` }],
      };
    }

    const formatted = messages.map((m) => formatMessage(m)).join("\n");
    const perfLine = `\n\n_Engine: TS | Query: ${durMs.toFixed(0)}ms | Messages: ${messages.length}_`;
    return {
      content: [
        {
          type: "text",
          text: `${threadHeader}Found ${messages.length} message(s):\n\n${formatted}${perfLine}`,
        },
      ],
    };
  }

  private async handleGetUnreadMessages(args: unknown) {
    const { limit } = GetUnreadMessagesSchema.parse(args ?? {});
    const messages = await this.db.getUnreadMessages(resolveLimit(limit, 100));

    if (messages.length === 0) {
      return {
        content: [{ type: "text", text: "No unread messages." }],
      };
    }

    // Add conversation context per message (slug or display name)
    const formatted = messages.map((msg) => {
      const slug = this.db.getSlugForChatIdentifier(msg.chatId);
      const label = slug ?? msg.chatId;
      return formatMessage(msg, label);
    }).join("\n");
    return {
      content: [
        {
          type: "text",
          text: `Found ${messages.length} unread message(s):\n\n${formatted}`,
        },
      ],
    };
  }

  private async handleSendMessage(args: unknown) {
    const { recipient, threadSlug, message } = SendMessageSchema.parse(args);

    if (!recipient && !threadSlug) {
      return {
        content: [{ type: "text", text: "Either recipient or threadSlug is required." }],
        isError: true,
      };
    }

    const available = await checkMessagesAvailable();
    if (!available) {
      return {
        content: [{ type: "text", text: "Messages.app is not running or accessible." }],
        isError: true,
      };
    }

    let result: { success: boolean; error?: string; timestamp?: Date };
    let resolvedTarget = recipient ?? threadSlug ?? "";

    if (threadSlug) {
      const slugRecord = this.db.getSlugRecord(threadSlug);
      if (!slugRecord) {
        return {
          content: [
            {
              type: "text",
              text: `Unknown thread slug: ${threadSlug}. Use list_conversations to see available slugs.`,
            },
          ],
          isError: true,
        };
      }

      if (slugRecord.isGroup) {
        if (slugRecord.displayName && !slugRecord.displayName.startsWith("chat")) {
          result = await sendToChat(slugRecord.displayName, message);
        } else {
          result = await sendToChatId(slugRecord.chatGuid, message);
        }
      } else {
        result = await sendMessageAlt(slugRecord.chatIdentifier, message);
      }
      resolvedTarget = slugRecord.displayName || slugRecord.chatIdentifier;
    } else {
      result = await sendMessageAlt(recipient!, message);
    }

    if (result.success) {
      const chat = await this.db.findChatByHandle(
        threadSlug ? (this.db.getSlugRecord(threadSlug)?.chatIdentifier ?? "") : recipient!,
      );
      let lastMessageId: number | undefined;

      if (chat) {
        const lastMsg = await this.db.getLastMessage(chat.chatIdentifier);
        lastMessageId = lastMsg?.id;
      }

      return {
        content: [
          {
            type: "text",
            text: `Message sent to ${resolvedTarget} at ${result.timestamp?.toLocaleString()}${chat ? `\nThread: ${chat.threadSlug}` : ""}${lastMessageId ? `\nLast message ID: ${lastMessageId} (use with wait_for_reply)` : ""}`,
          },
        ],
      };
    } else {
      appendLog("error", "send_message failed", { recipient: resolvedTarget, error: result.error });
      return {
        content: [
          {
            type: "text",
            text: `Failed to send message: ${result.error}. Use get_last_send_error for details.`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleWaitForReply(args: unknown, signal?: AbortSignal): Promise<any> {
    const { chatIdentifier, threadSlug, timeoutSeconds, pollIntervalSeconds, afterMessageId } =
      WaitForReplySchema.parse(args);

    if (!chatIdentifier && !threadSlug) {
      return {
        content: [{ type: "text", text: "Either chatIdentifier or threadSlug is required." }],
        isError: true,
      };
    }

    const timeoutMs = timeoutSeconds * 1000;
    const pollIntervalMs = pollIntervalSeconds * 1000;
    const startTime = Date.now();

    let chat: Awaited<ReturnType<typeof this.db.findChatByHandle>>;
    if (threadSlug) {
      const slugRecord = this.db.getSlugRecord(threadSlug);
      if (!slugRecord) {
        return {
          content: [{ type: "text", text: `Unknown thread slug: ${threadSlug}` }],
          isError: true,
        };
      }
      chat = await this.db.findChatByHandle(slugRecord.chatIdentifier);
    } else {
      chat = await this.db.findChatByHandle(chatIdentifier!);
    }
    if (!chat) {
      return {
        content: [
          {
            type: "text",
            text: `Could not find conversation for: ${threadSlug || chatIdentifier}`,
          },
        ],
        isError: true,
      };
    }

    // Get the current last message ID if not provided
    let lastKnownId = afterMessageId;
    if (!lastKnownId) {
      const lastMsg = await this.db.getLastMessage(chat.chatIdentifier);
      lastKnownId = lastMsg?.id || 0;
    }

    // Poll for new messages — bail out early on cancellation
    while (Date.now() - startTime < timeoutMs) {
      if (signal?.aborted) {
        return {
          content: [
            { type: "text", text: `Cancelled by client after ${Math.round((Date.now() - startTime) / 1000)}s` },
          ],
          isError: true,
        };
      }
      const newMessages = await this.db.getMessagesAfter(chat.chatIdentifier, lastKnownId);

      if (newMessages.length > 0) {
        const formatted = newMessages.map((m) => formatMessage(m)).join("\n");
        return {
          content: [
            {
              type: "text",
              text: `Received ${newMessages.length} new message(s):\n\n${formatted}`,
            },
          ],
        };
      }

      await sleep(pollIntervalMs);
    }

    // Timeout reached
    return {
      content: [
        {
          type: "text",
          text: `Timeout reached (${timeoutSeconds}s) - no new messages received in conversation with ${chatIdentifier}`,
        },
      ],
    };
  }

  private async handleListConversations(args: unknown) {
    const { limit } = ListConversationsSchema.parse(args);
    const limited = await this.db.listConversations(resolveLimit(limit));

    if (limited.length === 0) {
      return {
        content: [{ type: "text", text: "No conversations found." }],
      };
    }

    const formatted = limited
      .map((conv) => {
        const slug = conv.threadSlug ?? conv.chatIdentifier;
        let name = conv.displayName || conv.chatIdentifier;
        // For group chats without a display name, show resolved participant names
        if (conv.isGroupChat && !conv.displayName) {
          const resolved = this.db.resolveParticipantNames(conv.participants);
          const names = resolved.filter((n, i) => n !== conv.participants[i]);
          if (names.length > 0) {
            name = names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
          }
        }
        const ident =
          conv.displayName && conv.displayName !== conv.rawIdentifier
            ? ` (${conv.rawIdentifier})`
            : "";
        const svc = conv.serviceType === "SMS" ? " [SMS]" : "";
        const group = conv.isGroupChat ? " [Group]" : "";
        const lastDate = conv.lastMessageDate ? ` - ${relativeDate(conv.lastMessageDate)}` : "";
        const snippet = conv.lastMessageSnippet
          ? ` - "${conv.lastMessageSnippet.length > 50 ? `${conv.lastMessageSnippet.slice(0, 47)}...` : conv.lastMessageSnippet}"`
          : "";
        const unread = conv.unreadCount > 0 ? ` [${conv.unreadCount} unread]` : "";
        return `• [${slug}] ${name}${ident}${svc}${group}${lastDate}${snippet}${unread}`;
      })
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Found ${limited.length} conversation(s):\n\n${formatted}`,
        },
      ],
    };
  }

  private async handleSearchMessages(args: unknown) {
    const { query, limit } = SearchMessagesSchema.parse(args);
    const messages = await this.db.searchMessages(query, resolveLimit(limit));

    if (messages.length === 0) {
      return {
        content: [{ type: "text", text: `No messages found matching "${query}".` }],
      };
    }

    const formatted = messages.map((msg) => {
      const slug = this.db.getSlugForChatIdentifier(msg.chatId);
      const label = slug ?? msg.chatId;
      return formatMessage(msg, label);
    }).join("\n");
    return {
      content: [
        {
          type: "text",
          text: `Found ${messages.length} message(s) matching "${query}":\n\n${formatted}`,
        },
      ],
    };
  }

  async run(): Promise<void> {
    // Install process lifecycle handlers
    installShutdownHandlers();
    registerCleanup(() => logShutdown("normal"));
    registerCleanup(() => stopHeapMonitor());
    registerCleanup(() => this.db.close());
    enableStdinEofDetection();
    enableOrphanWatchdog();
    installWatchdog();
    logStartup("mcp-server");

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    info("iMessage MCP Server running on stdio");
    startHeapMonitor();
    console.error(`iMessage MCP Server running on stdio (logs: ${getLogDirectory()})`);
  }
}

function printServerHelp(): void {
  console.error(`${APP_NAME} ${APP_VERSION}`);
  console.error("");
  console.error("Usage:");
  console.error(`  ${APP_NAME}           Run the MCP stdio server`);
  console.error(`  ${APP_NAME} --doctor  Check local permissions and database access`);
  console.error(`  ${APP_NAME} --help    Show this help`);
  console.error(`  ${APP_NAME} --version Show the version`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printServerHelp();
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(APP_VERSION);
    return;
  }
  if (args.includes("--doctor")) {
    const report = await checkLocalAccess();
    console.log(formatAccessReport(report));
    process.exit(report.ok ? 0 : 1);
  }

  try {
    const server = new IMessageMCPServer();
    await server.run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    const report = await checkLocalAccess();
    console.error("");
    console.error(formatAccessReport(report));
    await shutdown(1);
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await shutdown(1);
});
