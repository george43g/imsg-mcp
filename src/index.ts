/**
 * iMessage MCP Server
 * Enables AI agents to send and receive iMessages on macOS
 */

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { checkLocalAccess, formatAccessReport } from "./access-check.js";
import { dispatchAnalytic } from "./analytics.js";
import { lookupCache, storeCache } from "./analytics-cache.js";
import {
  checkImessageAvailability,
  checkMessagesAvailable,
  sendAttachment,
  sendMessageAlt,
  sendMessageReliable,
  sendToChat,
  sendToChatId,
} from "./applescript.js";
import { getContactsDbPaths, getImsgDbPath, getSlugsDbPath } from "./config.js";
import { rememberSearch, resolveContactSelector } from "./contact-resolver.js";
import { streamExport } from "./exportStream.js";
import { rankFuzzy } from "./fuzzy.js";
import { IMessageDB } from "./imessage-db.js";
import {
  appendLog,
  getFileLogLines,
  getLastSendError,
  getLogDirectory,
  getLogFilePath,
  getLogs,
  info,
  logShutdown,
  logStartup,
  perf,
  setLastSendError,
  startHeapMonitor,
  stopHeapMonitor,
} from "./logger.js";
import {
  ChatAnalyticsSchema,
  CheckImessageAvailabilitySchema,
  DEFAULT_TOOL_TIMEOUT_MS,
  DEV_TOOL_NAMES,
  ExportMessagesSchema,
  GetAttachmentSchema,
  GetContactSchema,
  GetLogsSchema,
  GetMessagesSchema,
  GetUnreadMessagesSchema,
  getActiveTools,
  isDevMode,
  ListContactsSchema,
  ListConversationsSchema,
  ResolveHandleSchema,
  resolveLimit,
  SearchAttachmentsSchema,
  SearchContactsSchema,
  SearchMessagesSchema,
  SendMessageSchema,
  TOOL_TIMEOUTS_MS,
  type ToolName,
  WaitForReplySchema,
} from "./mcp-tools.js";
import { APP_NAME, APP_VERSION } from "./meta.js";
import { hasNativeModule } from "./native-bridge.js";
import { wrapUntrusted } from "./prompt-injection.js";
import { defaultCountryFromEnv, resolveRecipient } from "./recipient.js";
import { sanitizeUserText } from "./sanitize.js";
import {
  enableOrphanWatchdog,
  enableStdinEofDetection,
  installShutdownHandlers,
  registerCleanup,
  shutdown,
} from "./shutdown.js";
import { parseUserDate } from "./tui/dateParse.js";
import type { Message } from "./types.js";
import { installWatchdog, noteActivity, readWatchdogState } from "./watchdog.js";

const execFileAsync = promisify(execFile);

class ToolTimeoutError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Tool '${toolName}' timed out after ${timeoutMs}ms. The MCP server has unblocked; the underlying query may still be running in the background.`,
    );
    this.name = "ToolTimeoutError";
  }
}

function withTimeout<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
  const ms = TOOL_TIMEOUTS_MS[toolName] ?? DEFAULT_TOOL_TIMEOUT_MS;
  if (ms <= 0) return fn();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ToolTimeoutError(toolName, ms)), ms);
    timer.unref();
    fn().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

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
  const rawText = sanitizeUserText(msg.text);
  // Wrap user-controlled message bodies in <untrusted> so a downstream LLM
  // treats prompt-injection attempts in the body as data, not instructions.
  // The empty-message placeholder is server-generated and trusted.
  const text = rawText ? wrapUntrusted(rawText) : "(no text)";
  return `[${dateStr}] ${direction} ${sender}${svcTag}: ${text}${status}${convCtx}`;
}

function messageToStructured(msg: Message) {
  return {
    ...msg,
    text: sanitizeUserText(msg.text),
    date: msg.date.toISOString(),
    dateRead: msg.dateRead?.toISOString() ?? null,
    dateDelivered: msg.dateDelivered?.toISOString() ?? null,
  };
}

/**
 * Sleep utility
 */
/**
 * Sleep for `ms`, resolving early if `signal` aborts. The caller is
 * expected to re-check `signal.aborted` after — sleep just wakes up
 * promptly so the caller doesn't sit on a 10–60s setTimeout while a
 * cancellation is already in flight. Without this, `wait_for_reply`
 * could take up to a full poll interval to honor a cancel.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function toolText(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function toolError(text: string, _structuredContent?: Record<string, unknown>) {
  return {
    ...toolText(text),
    isError: true,
  };
}

function validateExportOutputPath(outputPath: string): string | null {
  if (!isAbsolute(outputPath)) {
    return "outputPath must be an absolute path.";
  }

  const parent = dirname(outputPath);
  if (!existsSync(parent)) {
    return `Parent directory does not exist: ${parent}`;
  }

  const parentStat = statSync(parent);
  if (!parentStat.isDirectory()) {
    return `Parent path is not a directory: ${parent}`;
  }

  if (existsSync(outputPath) && statSync(outputPath).isDirectory()) {
    return `outputPath points to a directory, not a file: ${outputPath}`;
  }

  return null;
}

function engineLabel(): string {
  return hasNativeModule() ? "Rust parser + TS DB" : "TS";
}

/**
 * Main MCP server class
 */
export class IMessageMCPServer {
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
          resources: { subscribe: false, listChanged: false },
        },
      },
    );

    this.db = new IMessageDB(getImsgDbPath(), getContactsDbPaths(), getSlugsDbPath());
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: getActiveTools(),
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

      const startedAt = performance.now();
      const stampMeta = <T extends Record<string, unknown>>(result: T): T => {
        const duration_ms = Math.round((performance.now() - startedAt) * 10) / 10;
        return { ...result, _meta: { engine: engineLabel(), duration_ms } } as T;
      };

      try {
        return stampMeta(await withTimeout(name, () => this.dispatchTool(name, args, signal)));
      } catch (error: any) {
        const isTimeout = error instanceof ToolTimeoutError;
        appendLog(isTimeout ? "warn" : "error", isTimeout ? "Tool timed out" : "Tool error", {
          tool: name,
          error: error.message || String(error),
        });
        if (!isTimeout) this.recentErrorCount++;
        return stampMeta(
          toolError(`Error: ${error.message || String(error)}`, {
            tool: name,
            error: error.message || String(error),
            timedOut: isTimeout,
          }),
        );
      } finally {
        this.db.scheduleBackgroundRefresh();
      }
    });

    // MCP Resources — let hosts browse/subscribe without an explicit tool call.
    // We advertise templates (parameterized URIs) rather than concrete
    // resources because the user's data is open-ended.
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [],
    }));

    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: [
        {
          uriTemplate: "messages://recent/{hours}",
          name: "Recent messages (last N hours)",
          description: "Read all messages across every chat from the last {hours} hours.",
          mimeType: "application/json",
        },
        {
          uriTemplate: "messages://contact/{handle}/{hours}",
          name: "Messages with a contact (last N hours)",
          description:
            "Read messages from the chat containing {handle} (phone/email) in the last {hours} hours.",
          mimeType: "application/json",
        },
        {
          uriTemplate: "contacts://",
          name: "All loaded contacts",
          description: "Read all contacts from the macOS Address Book sources.",
          mimeType: "application/json",
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      try {
        const result = await this.readResource(uri);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (e: any) {
        throw new Error(`Resource ${uri} failed: ${e.message ?? e}`);
      }
    });
  }

  private async readResource(uri: string): Promise<unknown> {
    // messages://recent/{hours}
    let m = uri.match(/^messages:\/\/recent\/(\d+)$/);
    if (m?.[1]) {
      const hours = Number(m[1]);
      const cutoffMs = Date.now() - hours * 3600 * 1000;
      // Use existing getRecentMessages then filter by date (cheap; recent is
      // already bounded). For hours > 24 callers should use get_messages
      // tool instead.
      const msgs = await this.db.getRecentMessages(500);
      return {
        windowHours: hours,
        messages: msgs
          .filter((mm: Message) => mm.date.getTime() >= cutoffMs)
          .map(messageToStructured),
      };
    }
    // messages://contact/{handle}/{hours}
    m = uri.match(/^messages:\/\/contact\/([^/]+)\/(\d+)$/);
    if (m?.[1] && m?.[2]) {
      const handle = decodeURIComponent(m[1]);
      const hours = Number(m[2]);
      const cutoffMs = Date.now() - hours * 3600 * 1000;
      const chat = await this.db.findChatByHandle(handle);
      if (!chat) return { handle, windowHours: hours, messages: [] };
      const msgs = await this.db.getMessagesForChat(chat.chatIdentifier, 500);
      return {
        handle,
        chatId: chat.chatIdentifier,
        windowHours: hours,
        messages: msgs
          .filter((mm: Message) => mm.date.getTime() >= cutoffMs)
          .map(messageToStructured),
      };
    }
    // contacts://
    if (uri === "contacts://") {
      const all = this.db.contacts.listContacts(0, 10000);
      return { count: all.contacts.length, contacts: all.contacts };
    }
    throw new Error(`Unknown resource URI: ${uri}`);
  }

  private async dispatchTool(name: string, args: unknown, signal?: AbortSignal) {
    if (DEV_TOOL_NAMES.has(name as ToolName) && !isDevMode()) {
      throw new Error(`Unknown tool: ${name}`);
    }
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
      case "export_messages":
        return await this.handleExportMessages(args, signal);
      case "list_contacts":
        return await this.handleListContacts(args);
      case "search_contacts":
        return await this.handleSearchContacts(args);
      case "get_contact":
        return await this.handleGetContact(args);
      case "resolve_handle":
        return await this.handleResolveHandle(args);
      case "check_imessage_availability":
        return await this.handleCheckImessageAvailability(args);
      case "search_attachments":
        return await this.handleSearchAttachments(args);
      case "get_attachment":
        return await this.handleGetAttachment(args);
      case "chat_analytics":
        return await this.handleChatAnalytics(args);
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
      sections.push(
        `## In-Memory Logs (${memLines.length} lines)\n${memLines.length === 0 ? "No log lines yet." : memLines.join("\n")}`,
      );
    }

    if (source === "file" || source === "all") {
      const fileLines = getFileLogLines(n);
      const logPath = getLogFilePath() ?? getLogDirectory();
      sections.push(
        `## File Logs (${logPath})\n${fileLines.length === 0 ? "No file log entries." : fileLines.join("\n")}`,
      );
    }

    if (source !== "file" && source !== "all") {
      // Also show log file location for reference
      const logPath = getLogFilePath() ?? getLogDirectory();
      sections.push(`\n📁 Full NDJSON logs: ${logPath}`);
    }

    return toolText(sections.join("\n\n"), { source: source ?? "memory", tail: n, sections });
  }

  private async handleGetLastSendError() {
    const err = getLastSendError();
    if (!err) {
      return toolText(
        "No send failure recorded. Last send either succeeded or occurred before this server run.",
        {
          lastSendError: null,
        },
      );
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
    return toolText(text, { lastSendError: err });
  }

  private async handleRunBuild(): Promise<any> {
    try {
      const { stdout, stderr } = await execFileAsync("pnpm", ["build"], {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        cwd: process.cwd(),
      });
      return toolText(
        `Build succeeded.\n\nstdout:\n${stdout}${stderr ? `\n\nstderr:\n${stderr}` : ""}`,
        {
          ok: true,
          stdout,
          stderr,
        },
      );
    } catch (error: any) {
      const stderr = error.stderr?.toString?.() ?? error.message ?? "";
      const stdout = error.stdout?.toString?.() ?? "";
      appendLog("error", "run_build failed", { stderr, stdout });
      return toolError(`Build failed.\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`, {
        ok: false,
        stdout,
        stderr,
      });
    }
  }

  private async handleRequestRestart(): Promise<any> {
    const msg =
      "Restart requested. Please restart the MCP server in your client (e.g. Cursor) to load new code.";
    setImmediate(() => shutdown(0));
    return toolText(msg, { restartRequested: true });
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
      `Engine: ${engineLabel()}`,
    ].filter((l) => l !== null);

    return toolText(lines.join("\n"), {
      status,
      issues,
      uptimeMs,
      idleMs,
      pid: process.pid,
      node: process.version,
      heapMb: wd.heapMb || round1(process.memoryUsage().heapUsed / 1024 / 1024),
      rssMb: wd.rssMb || round1(process.memoryUsage().rss / 1024 / 1024),
      eventLoopP99Ms: wd.eventLoopP99Ms,
      eventLoopMaxMs: wd.eventLoopMaxMs,
      toolCallCount: this.toolCallCount,
      recentErrorCount: this.recentErrorCount,
      engine: engineLabel(),
    });
  }

  private async handleGetMessages(args: unknown) {
    const span = perf("tool:get_messages");
    const parsed = GetMessagesSchema.parse(args);
    const { chatIdentifier, threadSlug, beforeMessageId } = parsed;
    // Internal cap to prevent OOM regardless of caller's request.
    const HARD_PAGE_CAP = 5000;
    const requested = resolveLimit(parsed.limit);
    const limit = Math.min(requested, HARD_PAGE_CAP);
    const wasCapped = requested > HARD_PAGE_CAP;

    let messages: Message[];
    let threadHeader = "";
    if (chatIdentifier || threadSlug) {
      let targetIdentifier = chatIdentifier;
      if (threadSlug) {
        const slugRecord = this.db.getSlugRecord(threadSlug);
        if (!slugRecord) {
          return toolError(`Unknown thread slug: ${threadSlug}`, { threadSlug });
        }
        targetIdentifier = slugRecord.chatIdentifier;
      }

      messages = await this.db.getMessagesForChat(targetIdentifier!, limit, { beforeMessageId });
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
      return toolText(`${threadHeader}No messages found.`, {
        messages: [],
        count: 0,
        hasMore: false,
      });
    }

    const formatted = messages.map((m) => formatMessage(m)).join("\n");
    const oldestId = Math.min(...messages.map((m) => m.id));
    const hasMore = messages.length === limit; // heuristic — full page suggests more
    const paginationLine =
      chatIdentifier || threadSlug
        ? `\n_Pagination: oldestMessageId=${oldestId}, hasMore=${hasMore}${wasCapped ? ` (capped at ${HARD_PAGE_CAP} per call — use beforeMessageId or export_messages)` : ""}_`
        : "";
    const perfLine = `\n_Engine: TS | Query: ${durMs.toFixed(0)}ms | Messages: ${messages.length}_`;
    return toolText(
      `${threadHeader}Found ${messages.length} message(s):\n\n${formatted}${paginationLine}${perfLine}`,
      {
        messages: messages.map(messageToStructured),
        count: messages.length,
        hasMore,
        oldestMessageId: chatIdentifier || threadSlug ? oldestId : undefined,
      },
    );
  }

  private async handleExportMessages(args: unknown, signal?: AbortSignal) {
    const span = perf("tool:export_messages");
    const parsed = ExportMessagesSchema.parse(args);
    const { format, outputPath, since, until, pageSize } = parsed;

    // Resolve target chat
    let chatIdentifier = parsed.chatIdentifier;
    if (parsed.threadSlug) {
      const slugRecord = this.db.getSlugRecord(parsed.threadSlug);
      if (!slugRecord) {
        return toolError(`Unknown thread slug: ${parsed.threadSlug}`, {
          threadSlug: parsed.threadSlug,
        });
      }
      chatIdentifier = slugRecord.chatIdentifier;
    }
    if (!chatIdentifier) {
      return toolError("chatIdentifier or threadSlug required", {});
    }

    const pathError = validateExportOutputPath(outputPath);
    if (pathError) {
      return toolError(pathError, { outputPath });
    }

    // Parse date bounds (reuse the same parser the TUI uses)
    const sinceDate = since ? parseUserDate(since) : null;
    const untilDate = until ? parseUserDate(until) : null;
    if (since && !sinceDate) {
      return toolError(`Could not parse 'since': ${since}`, { since });
    }
    if (until && !untilDate) {
      return toolError(`Could not parse 'until': ${until}`, { until });
    }

    const result = await streamExport({
      db: this.db,
      chatIdentifier,
      format,
      outputPath,
      since: sinceDate,
      until: untilDate,
      pageSize,
      signal,
    });
    const durMs = span.end({ format, count: result.count, sizeBytes: result.sizeBytes });

    return toolText(
      [
        `Exported ${result.count} message(s) to ${result.savedTo}`,
        `Format: ${format}`,
        `Range: ${result.oldest?.toISOString() ?? "(none)"} → ${result.newest?.toISOString() ?? "(none)"}`,
        `Size: ${(result.sizeBytes / 1024).toFixed(1)} KB`,
        `_Took ${durMs.toFixed(0)}ms_`,
      ].join("\n"),
      {
        ...result,
        format,
        oldest: result.oldest?.toISOString() ?? null,
        newest: result.newest?.toISOString() ?? null,
        durationMs: durMs,
      },
    );
  }

  private async handleGetUnreadMessages(args: unknown) {
    const { limit } = GetUnreadMessagesSchema.parse(args ?? {});
    const resolvedLimit = resolveLimit(limit, 100);
    const messages = await this.db.getUnreadMessages(resolvedLimit + 1);
    const hasMore = messages.length > resolvedLimit;
    const results = messages.slice(0, resolvedLimit);

    if (results.length === 0) {
      return toolText("No unread messages.", {
        messages: [],
        count: 0,
        hasMore: false,
        nextOffset: null,
      });
    }

    // Add conversation context per message (slug or display name)
    const formatted = results
      .map((msg) => {
        const slug = this.db.getSlugForChatIdentifier(msg.chatId);
        const label = slug ?? msg.chatId;
        return formatMessage(msg, label);
      })
      .join("\n");
    return toolText(`Found ${results.length} unread message(s):\n\n${formatted}`, {
      messages: results.map(messageToStructured),
      count: results.length,
      hasMore,
      nextOffset: null,
    });
  }

  private async handleSendMessage(args: unknown) {
    const { recipient, threadSlug, message, attachments } = SendMessageSchema.parse(args);

    // Wrapper so every validation early-exit also records to
    // `lastSendError`. Pre-fix, get_last_send_error returned null after
    // a failed send because validation errors never reached the
    // AppleScript layer where the only setLastSendError call lived.
    const failValidation = (msg: string, data: Record<string, unknown> = {}) => {
      setLastSendError({ message: msg, code: "validation", stderr: undefined, stdout: undefined });
      return toolError(msg, data);
    };

    if (!recipient && !threadSlug) {
      return failValidation("Either recipient or threadSlug is required.", {});
    }

    // Pre-validate attachment paths so we fail fast (before sending the
    // text body) when a path is bogus.
    if (attachments?.length) {
      for (const p of attachments) {
        if (!isAbsolute(p)) {
          return failValidation(`Attachment path must be absolute: ${p}`, { attachment: p });
        }
        if (!existsSync(p)) {
          return failValidation(`Attachment file not found: ${p}`, { attachment: p });
        }
      }
    }

    const available = await checkMessagesAvailable();
    if (!available) {
      return failValidation("Messages.app is not running or accessible.", {
        messagesAvailable: false,
      });
    }

    let result: { success: boolean; error?: string; timestamp?: Date };
    let resolvedTarget = recipient ?? threadSlug ?? "";

    // Normalize `recipient` if provided. Accepts E.164 / local phone /
    // iMessage email / contact name. The pre-existing path only worked
    // for E.164 + email (AppleScript layer's expectation) — now any of
    // the 4 forms route through one normalizer + the contact:N selector
    // for ambiguous lookups.
    let normalizedRecipient = recipient;
    if (recipient && !threadSlug) {
      const resolution = resolveRecipient(recipient, {
        contacts: this.db.contacts,
        defaultCountry: defaultCountryFromEnv(),
      });
      if (resolution.kind === "error") {
        return failValidation(resolution.message, { recipient });
      }
      if (resolution.kind === "ambiguous") {
        // Surface the same disambiguation list the contact:N selector uses.
        const lines = resolution.candidates
          .map((c, i) => `  contact:${i + 1}  ${c.displayName}  →  ${c.handle}`)
          .join("\n");
        return failValidation(
          `Ambiguous recipient "${recipient}" — multiple matches:\n${lines}\n\nCall again with one of the contact:N labels.`,
          {
            recipient,
            candidates: resolution.candidates,
          },
        );
      }
      normalizedRecipient = resolution.handle;
      resolvedTarget = resolution.handle;
    }

    if (threadSlug) {
      const slugRecord = this.db.getSlugRecord(threadSlug);
      if (!slugRecord) {
        return failValidation(
          `Unknown thread slug: ${threadSlug}. Use list_conversations to see available slugs.`,
          {
            threadSlug,
          },
        );
      }

      if (slugRecord.isGroup) {
        if (slugRecord.displayName && !slugRecord.displayName.startsWith("chat")) {
          result = await sendToChat(slugRecord.displayName, message);
        } else {
          result = await sendToChatId(slugRecord.chatGuid, message);
        }
      } else {
        // Route 1:1 sends through the temp-file + SMS-fallback path. Falls
        // back to sendMessageAlt only if the reliable path itself errors
        // before AppleScript runs (e.g. tmp-file write failure).
        result = await sendMessageReliable(slugRecord.chatIdentifier, message);
        if (!result.success) {
          result = await sendMessageAlt(slugRecord.chatIdentifier, message);
        }
      }
      resolvedTarget = slugRecord.displayName || slugRecord.chatIdentifier;
    } else {
      result = await sendMessageReliable(normalizedRecipient!, message);
      if (!result.success) {
        result = await sendMessageAlt(normalizedRecipient!, message);
      }
    }

    if (result.success) {
      // Ship attachments as follow-up sends. 1:1 only — Messages.app's
      // `send (POSIX file …) to chat …` form is unreliable, so for slug-based
      // group sends we surface the limitation in the response rather than
      // attempting it.
      const attachmentResults: Array<{ path: string; success: boolean; error?: string }> = [];
      if (attachments?.length) {
        const targetHandle = threadSlug
          ? this.db.getSlugRecord(threadSlug)?.chatIdentifier
          : recipient;
        const isGroupTarget = threadSlug
          ? Boolean(this.db.getSlugRecord(threadSlug)?.isGroup)
          : false;

        if (isGroupTarget) {
          for (const p of attachments) {
            attachmentResults.push({
              path: p,
              success: false,
              error: "Attachment send to group chats not supported (Messages.app limitation).",
            });
          }
        } else if (targetHandle) {
          for (const p of attachments) {
            const r = await sendAttachment(targetHandle, p);
            attachmentResults.push({
              path: p,
              success: r.success,
              error: r.error,
            });
          }
        }
      }

      const chat = await this.db.findChatByHandle(
        threadSlug ? (this.db.getSlugRecord(threadSlug)?.chatIdentifier ?? "") : recipient!,
      );
      let lastMessageId: number | undefined;

      if (chat) {
        const lastMsg = await this.db.getLastMessage(chat.chatIdentifier);
        lastMessageId = lastMsg?.id;
      }

      const attSummary =
        attachmentResults.length > 0
          ? `\nAttachments: ${attachmentResults.filter((a) => a.success).length}/${attachmentResults.length} delivered`
          : "";

      return toolText(
        `Message sent to ${resolvedTarget} at ${result.timestamp?.toLocaleString()}${chat ? `\nThread: ${chat.threadSlug}` : ""}${lastMessageId ? `\nLast message ID: ${lastMessageId} (use with wait_for_reply)` : ""}${attSummary}`,
        {
          success: true,
          target: resolvedTarget,
          timestamp: result.timestamp?.toISOString() ?? null,
          threadSlug: chat?.threadSlug,
          lastMessageId,
          attachments: attachmentResults.length > 0 ? attachmentResults : undefined,
        },
      );
    } else {
      appendLog("error", "send_message failed", { recipient: resolvedTarget, error: result.error });
      return toolError(
        `Failed to send message: ${result.error}. Use get_last_send_error for details.`,
        {
          success: false,
          target: resolvedTarget,
          error: result.error,
        },
      );
    }
  }

  private async handleWaitForReply(args: unknown, signal?: AbortSignal): Promise<any> {
    const { chatIdentifier, threadSlug, timeoutSeconds, pollIntervalSeconds, afterMessageId } =
      WaitForReplySchema.parse(args);

    if (!chatIdentifier && !threadSlug) {
      return toolError("Either chatIdentifier or threadSlug is required.", {});
    }

    const timeoutMs = timeoutSeconds * 1000;
    const pollIntervalMs = pollIntervalSeconds * 1000;
    const startTime = Date.now();

    let chat: Awaited<ReturnType<typeof this.db.findChatByHandle>>;
    if (threadSlug) {
      const slugRecord = this.db.getSlugRecord(threadSlug);
      if (!slugRecord) {
        return toolError(`Unknown thread slug: ${threadSlug}`, { threadSlug });
      }
      chat = await this.db.findChatByHandle(slugRecord.chatIdentifier);
    } else {
      chat = await this.db.findChatByHandle(chatIdentifier!);
    }
    if (!chat) {
      return toolError(`Could not find conversation for: ${threadSlug || chatIdentifier}`, {
        threadSlug,
        chatIdentifier,
      });
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
        return toolError(
          `Cancelled by client after ${Math.round((Date.now() - startTime) / 1000)}s`,
          {
            cancelled: true,
            elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
          },
        );
      }
      const newMessages = await this.db.getMessagesAfter(chat.chatIdentifier, lastKnownId);

      if (newMessages.length > 0) {
        const formatted = newMessages.map((m) => formatMessage(m)).join("\n");
        return toolText(`Received ${newMessages.length} new message(s):\n\n${formatted}`, {
          received: true,
          messages: newMessages.map(messageToStructured),
          count: newMessages.length,
        });
      }

      await sleep(pollIntervalMs, signal);
    }

    // Timeout reached
    return toolText(
      `Timeout reached (${timeoutSeconds}s) - no new messages received in conversation with ${threadSlug || chatIdentifier}`,
      {
        received: false,
        timedOut: true,
        timeoutSeconds,
        threadSlug,
        chatIdentifier: chat.chatIdentifier,
      },
    );
  }

  private async handleListConversations(args: unknown) {
    const { limit } = ListConversationsSchema.parse(args);
    const resolvedLimit = resolveLimit(limit);
    const limited = await this.db.listConversations(resolvedLimit + 1);
    const hasMore = limited.length > resolvedLimit;
    const results = limited.slice(0, resolvedLimit);

    if (results.length === 0) {
      return toolText("No conversations found.", {
        conversations: [],
        count: 0,
        hasMore: false,
        nextOffset: null,
      });
    }

    const formatted = results
      .map((conv) => {
        const slug = conv.threadSlug ?? conv.chatIdentifier;
        let name = conv.displayName || conv.chatIdentifier;
        // For group chats without a display name, show resolved participant names
        if (conv.isGroupChat && !conv.displayName) {
          const resolved = this.db.resolveParticipantNames(conv.participants);
          const names = resolved.filter((n, i) => n !== conv.participants[i]);
          if (names.length > 0) {
            name =
              names.length <= 3
                ? names.join(", ")
                : `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
          }
        }
        const ident =
          conv.displayName && conv.displayName !== conv.rawIdentifier
            ? ` (${conv.rawIdentifier})`
            : "";
        const svc = conv.serviceType === "SMS" ? " [SMS]" : "";
        const group = conv.isGroupChat ? " [Group]" : "";
        const lastDate = conv.lastMessageDate ? ` - ${relativeDate(conv.lastMessageDate)}` : "";
        let snippetText = conv.lastMessageSnippet;
        if (snippetText) {
          snippetText = sanitizeUserText(snippetText);
        }
        const snippet = snippetText
          ? ` - "${wrapUntrusted(snippetText.length > 50 ? `${snippetText.slice(0, 47)}...` : snippetText)}"`
          : "";
        const unread = conv.unreadCount > 0 ? ` [${conv.unreadCount} unread]` : "";
        return `• [${slug}] ${name}${ident}${svc}${group}${lastDate}${snippet}${unread}`;
      })
      .join("\n");

    return toolText(`Found ${results.length} conversation(s):\n\n${formatted}`, {
      conversations: results.map((conversation) => ({
        ...conversation,
        lastMessageDate: conversation.lastMessageDate?.toISOString() ?? null,
        lastMessageSnippet: sanitizeUserText(conversation.lastMessageSnippet),
      })),
      count: results.length,
      hasMore,
      nextOffset: null,
    });
  }

  private async handleSearchMessages(args: unknown) {
    const { query, limit, mode, minScore } = SearchMessagesSchema.parse(args);
    const resolvedLimit = resolveLimit(limit);

    // Fuzzy mode: pull a wider candidate set via LIKE on individual tokens
    // (so the DB doesn't return the entire history), then score+rank in TS.
    // Pure LIKE for literal mode.
    const SOFT_CAP = 10_000;
    let messages: Message[];
    let softCapWarning: string | undefined;
    if (mode === "fuzzy") {
      const candidates = await this.db.searchMessages(query, SOFT_CAP);
      const ranked = rankFuzzy(query, candidates, (m) => m.text ?? "", minScore);
      messages = ranked.slice(0, resolvedLimit + 1).map((r) => r.item);
      if (candidates.length >= SOFT_CAP) {
        softCapWarning = `Candidate pool capped at ${SOFT_CAP} pre-scoring. Tighten the query for more reliable ranking.`;
      }
    } else {
      messages = await this.db.searchMessages(query, resolvedLimit + 1);
    }

    const hasMore = messages.length > resolvedLimit;
    const results = messages.slice(0, resolvedLimit);

    if (results.length === 0) {
      return toolText(`No messages found matching "${query}".`, {
        query,
        mode,
        messages: [],
        count: 0,
        hasMore: false,
        nextOffset: null,
        softCapWarning,
      });
    }

    const formatted = results
      .map((msg) => {
        const slug = this.db.getSlugForChatIdentifier(msg.chatId);
        const label = slug ?? msg.chatId;
        return formatMessage(msg, label);
      })
      .join("\n");
    return toolText(`Found ${results.length} message(s) matching "${query}":\n\n${formatted}`, {
      query,
      mode,
      messages: results.map(messageToStructured),
      count: results.length,
      hasMore,
      nextOffset: null,
      softCapWarning,
    });
  }

  // ── Contact tools ──────────────────────────────────────────────────────

  private async handleListContacts(args: unknown) {
    const { limit, offset } = ListContactsSchema.parse(args);
    const resolvedLimit = resolveLimit(limit);
    // Internal cap mirrors get_messages safety bound.
    const SAFETY_CAP = 5_000;
    const effectiveLimit = Math.min(resolvedLimit, SAFETY_CAP);
    const { contacts, total } = this.db.contacts.listContacts(offset, effectiveLimit);
    const hasMore = offset + contacts.length < total;

    if (contacts.length === 0) {
      return toolText(`No contacts found${offset > 0 ? ` (offset ${offset})` : ""}.`, {
        contacts: [],
        count: 0,
        hasMore: false,
        totalCount: total,
      });
    }

    const formatted = contacts
      .map((c) => {
        const phones = c.phoneNumbers.length > 0 ? ` 📱 ${c.phoneNumbers.join(", ")}` : "";
        const emails = c.emails.length > 0 ? ` ✉ ${c.emails.join(", ")}` : "";
        return `• ${sanitizeUserText(c.displayName)}${phones}${emails}`;
      })
      .join("\n");
    return toolText(`Showing ${contacts.length} of ${total} contact(s):\n\n${formatted}`, {
      contacts,
      count: contacts.length,
      hasMore,
      totalCount: total,
    });
  }

  private async handleSearchContacts(args: unknown) {
    const { query, limit } = SearchContactsSchema.parse(args);
    const resolvedLimit = resolveLimit(limit);
    const all = this.db.contacts.searchContacts(query);
    const results = resolvedLimit === Number.MAX_SAFE_INTEGER ? all : all.slice(0, resolvedLimit);

    if (results.length === 0) {
      return toolText(`No contacts match "${query}".`, {
        query,
        contacts: [],
        count: 0,
      });
    }

    // Remember this result set so the next call can re-select by `contact:N`.
    // Use the first phone or email as the canonical "handle" for the selector.
    rememberSearch(
      query,
      results.map((c) => ({
        handle: c.phoneNumbers[0] ?? c.emails[0] ?? c.displayName,
        displayName: c.displayName,
      })),
    );

    const formatted = results
      .map((c, i) => {
        const phones = c.phoneNumbers.length > 0 ? ` 📱 ${c.phoneNumbers.join(", ")}` : "";
        const emails = c.emails.length > 0 ? ` ✉ ${c.emails.join(", ")}` : "";
        return `[contact:${i + 1}] ${sanitizeUserText(c.displayName)}${phones}${emails}`;
      })
      .join("\n");
    const hint =
      results.length > 1
        ? `\n\nRe-select by index in any contact-accepting tool: handle: "contact:1" … "contact:${results.length}".`
        : "";
    return toolText(
      `Found ${results.length} contact(s) matching "${query}":\n\n${formatted}${hint}`,
      {
        query,
        contacts: results,
        count: results.length,
      },
    );
  }

  private async handleGetContact(args: unknown) {
    const { handle, id } = GetContactSchema.parse(args);
    let contact = null;
    if (handle !== undefined) {
      const selectorHit = resolveContactSelector(handle);
      const effectiveHandle = selectorHit?.handle ?? handle;
      const lookup = this.db.contacts.lookupContact(effectiveHandle);
      contact = lookup ? this.db.contacts.getContact(lookup.contactId) : null;
    } else if (id !== undefined) {
      contact = this.db.contacts.getContact(id);
    }
    if (!contact) {
      return toolText("Contact not found.", { contact: null });
    }
    const phones =
      contact.phoneNumbers.length > 0 ? `\nPhones: ${contact.phoneNumbers.join(", ")}` : "";
    const emails = contact.emails.length > 0 ? `\nEmails: ${contact.emails.join(", ")}` : "";
    const org = contact.organization ? `\nOrganization: ${contact.organization}` : "";
    return toolText(
      `${sanitizeUserText(contact.displayName)} (id ${contact.id})${phones}${emails}${org}`,
      { contact },
    );
  }

  private async handleResolveHandle(args: unknown) {
    const { handle } = ResolveHandleSchema.parse(args);
    const selectorHit = resolveContactSelector(handle);
    const effectiveHandle = selectorHit?.handle ?? handle;
    const lookup = this.db.contacts.lookupContact(effectiveHandle);
    if (lookup) {
      return toolText(`${handle} → ${sanitizeUserText(lookup.displayName)}`, {
        handle,
        displayName: lookup.displayName,
        contactId: lookup.contactId,
        label: lookup.label ?? null,
        resolved: true,
      });
    }
    return toolText(`No contact for ${handle}.`, {
      handle,
      displayName: handle,
      contactId: null,
      label: null,
      resolved: false,
    });
  }

  private async handleCheckImessageAvailability(args: unknown) {
    const { handle } = CheckImessageAvailabilitySchema.parse(args);
    const selectorHit = resolveContactSelector(handle);
    const effectiveHandle = selectorHit?.handle ?? handle;
    const result = await checkImessageAvailability(effectiveHandle);
    const text = result.reachable
      ? `${handle} reachable via ${result.service}.`
      : `${handle} not reachable. ${result.hint ?? ""}`.trim();
    return toolText(text, {
      handle,
      service: result.service,
      reachable: result.reachable,
      hint: result.hint,
    });
  }

  private async handleSearchAttachments(args: unknown) {
    const { mimePrefix, chatIdentifier, since, until, limit } = SearchAttachmentsSchema.parse(args);
    const sinceMs = since ? parseUserDate(since)?.getTime() : undefined;
    const untilMs = until ? parseUserDate(until)?.getTime() : undefined;
    const resolvedLimit = resolveLimit(limit);
    const opts: Parameters<typeof this.db.searchAttachments>[0] = {
      limit: resolvedLimit,
    };
    if (mimePrefix !== undefined) opts.mimePrefix = mimePrefix;
    if (chatIdentifier !== undefined) opts.chatIdentifier = chatIdentifier;
    if (sinceMs !== undefined) opts.sinceMs = sinceMs;
    if (untilMs !== undefined) opts.untilMs = untilMs;
    const results = this.db.searchAttachments(opts);

    const formatted = results
      .map(
        (a) =>
          `[${a.rowId}] ${a.mimeType ?? "?"} · ${a.totalBytes}B · ${a.createdDate.toISOString().slice(0, 10)} · ${a.transferName ?? a.filename}`,
      )
      .join("\n");
    return toolText(`Found ${results.length} attachment(s):\n\n${formatted}`, {
      attachments: results.map((a) => ({
        rowId: a.rowId,
        filename: a.filename,
        mimeType: a.mimeType,
        transferName: a.transferName,
        totalBytes: a.totalBytes,
        createdDate: a.createdDate.toISOString(),
        chatId: a.chatId,
      })),
      count: results.length,
    });
  }

  private async handleGetAttachment(args: unknown) {
    const { readFileSync } = await import("node:fs");
    const { rowId, inlineMaxBytes } = GetAttachmentSchema.parse(args);
    const rec = this.db.getAttachmentByRowId(rowId);
    if (!rec) return toolError(`Attachment ROWID ${rowId} not found.`, { rowId });

    const resolvedPath = rec.filename.replace(/^~/, process.env.HOME ?? "~");
    if (!existsSync(resolvedPath)) {
      return toolError(`Attachment file does not exist: ${resolvedPath}`, {
        rowId,
        resolvedPath,
      });
    }

    const stat = statSync(resolvedPath);
    const sizeBytes = stat.size;
    const isHeic =
      (rec.mimeType ?? "").toLowerCase().includes("heic") ||
      resolvedPath.toLowerCase().endsWith(".heic");

    // Inline if small AND not too large to base64-encode (base64 inflates ~33%).
    const inline = sizeBytes <= inlineMaxBytes;

    let base64: string | undefined;
    let convertedNote: string | undefined;
    let finalMime = rec.mimeType;
    let finalPath = resolvedPath;

    if (inline) {
      if (isHeic) {
        // Convert HEIC → PNG via macOS sips (zero-dep, ships with macOS).
        try {
          const { execFileSync } = await import("node:child_process");
          const { tmpdir } = await import("node:os");
          const { join: pjoin } = await import("node:path");
          const out = pjoin(tmpdir(), `imsg-att-${rowId}.png`);
          execFileSync("sips", ["-s", "format", "png", resolvedPath, "--out", out], {
            stdio: "ignore",
          });
          finalPath = out;
          finalMime = "image/png";
          convertedNote = "HEIC → PNG via sips";
          base64 = readFileSync(out).toString("base64");
        } catch (e: any) {
          return toolError(`HEIC→PNG conversion failed: ${e.message ?? e}`, { rowId });
        }
      } else {
        base64 = readFileSync(resolvedPath).toString("base64");
      }
    }

    return toolText(
      inline
        ? `Attachment ${rowId} (${sizeBytes}B, ${finalMime ?? "?"}) returned inline.`
        : `Attachment ${rowId} too large to inline (${sizeBytes}B > ${inlineMaxBytes}B). Use path: ${resolvedPath}`,
      {
        rowId,
        filename: rec.filename,
        resolvedPath: finalPath,
        mimeType: finalMime,
        totalBytes: sizeBytes,
        inline,
        base64,
        converted: convertedNote,
      },
    );
  }

  private async handleChatAnalytics(args: unknown) {
    const { type, windowDays } = ChatAnalyticsSchema.parse(args);
    // year_in_review pins to 365 days regardless of caller; otherwise use the
    // requested window.
    const effectiveDays = type === "year_in_review_wrapped" ? 365 : windowDays;
    const cutoffMs = Date.now() - effectiveDays * 86_400_000;

    // Cache lookup. Key includes effectiveDays + the DB's max message ROWID,
    // so a recent send/receive invalidates the cache.
    const maxRowId = this.db.getMaxMessageRowId();
    const cacheArgs = { type, windowDays: effectiveDays };
    const hit = lookupCache(type, cacheArgs, maxRowId);
    if (hit) {
      return toolText(`Cached ${type} (computed at ${new Date(hit.computedAt).toISOString()}).`, {
        type,
        windowDays: effectiveDays,
        computedAtIso: new Date(hit.computedAt).toISOString(),
        fromCache: true,
        data: hit.data,
      });
    }

    const messages = await this.db.getMessagesInWindow(cutoffMs);
    const result = dispatchAnalytic(type, messages);
    const computedAtIso = new Date().toISOString();
    storeCache(type, cacheArgs, maxRowId, result.data);

    return toolText(
      `Computed ${type} over ${messages.length} messages in the last ${effectiveDays}d.`,
      {
        type,
        windowDays: effectiveDays,
        computedAtIso,
        fromCache: false,
        data: result.data,
      },
    );
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

export async function runMcpServer(): Promise<void> {
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
