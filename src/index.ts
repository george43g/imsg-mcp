/**
 * iMessage MCP Server
 * Enables AI agents to send and receive iMessages on macOS
 */

import { execSync } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { checkMessagesAvailable, sendMessageAlt, sendToChat, sendToChatId } from "./applescript.js";
import { getContactsDbPaths, getImsgDbPath, getSlugsDbPath } from "./config.js";
import { IMessageDB } from "./imessage-db.js";
import { appendLog, getLastSendError, getLogs } from "./logger.js";
import type { Message } from "./types.js";

// Tool input schemas
const GetMessagesSchema = z.object({
  limit: z.number().min(1).max(100).default(20).describe("Number of messages to retrieve"),
  chatIdentifier: z.string().optional().describe("Phone number, email, or chat ID to filter by"),
});

const GetUnreadMessagesSchema = z.object({
  limit: z
    .number()
    .min(1)
    .max(500)
    .optional()
    .describe("Max number of unread messages to return (default 100)"),
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
  limit: z.number().min(1).max(50).default(20).describe("Number of conversations to list"),
});

const SearchMessagesSchema = z.object({
  query: z.string().describe("Search query"),
  limit: z.number().min(1).max(50).default(20).describe("Number of results"),
});

const GetLogsSchema = z.object({
  tail: z.number().min(1).max(500).optional().describe("Return only last N lines (default: all)"),
});

const _RunBuildSchema = z.object({});
const _RequestRestartSchema = z.object({});

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
          description: "Number of messages to retrieve (1-100)",
          default: 20,
        },
        chatIdentifier: {
          type: "string",
          description: "Phone number, email, or chat ID to filter by",
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
          description: "Max number of unread messages to return (1-500, default 100)",
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
          description: "Number of conversations to list (1-50)",
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
        limit: { type: "number", description: "Number of results (1-50)", default: 20 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_logs",
    description:
      "Return in-memory debug log lines from this MCP server (errors and send failures are appended). Use to inspect why send_message failed.",
    inputSchema: {
      type: "object",
      properties: {
        tail: { type: "number", description: "Return only last N lines (default: all)" },
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
];

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
 */
function formatMessage(msg: Message): string {
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

  return `[${dateStr}] ${direction} ${sender}${svcTag}: ${msg.text || "(no text)"}${status}`;
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

  constructor() {
    this.server = new Server(
      {
        name: "imsg-mcp",
        version: "1.0.0",
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
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "get_messages":
            return await this.handleGetMessages(args);
          case "get_unread_messages":
            return await this.handleGetUnreadMessages(args);
          case "send_message":
            return await this.handleSendMessage(args);
          case "wait_for_reply":
            return await this.handleWaitForReply(args);
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
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error: any) {
        appendLog("error", "Tool error", { tool: name, error: error.message || String(error) });
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message || String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleGetLogs(args: unknown) {
    const { tail } = GetLogsSchema.parse(args ?? {});
    const lines = getLogs(tail);
    const text = lines.length === 0 ? "No log lines yet." : lines.join("\n");
    return { content: [{ type: "text", text }] };
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
    setImmediate(() => process.exit(0));
    return { content: [{ type: "text", text: msg }] };
  }

  private async handleGetMessages(args: unknown) {
    const { limit, chatIdentifier } = GetMessagesSchema.parse(args);

    let messages: Message[];
    let threadHeader = "";
    if (chatIdentifier) {
      messages = await this.db.getMessagesForChat(chatIdentifier, limit);
      const conv = await this.db.findChatByHandle(chatIdentifier);
      if (conv) {
        const name = conv.displayName || conv.rawIdentifier;
        const ident = conv.displayName ? ` (${conv.rawIdentifier})` : "";
        const kind = conv.isGroupChat ? "Group" : "1-on-1";
        threadHeader = `Thread: ${conv.threadSlug} | ${name}${ident} | ${conv.serviceType} | ${kind}\n\n`;
      }
    } else {
      messages = await this.db.getRecentMessages(limit);
    }

    if (messages.length === 0) {
      return {
        content: [{ type: "text", text: `${threadHeader}No messages found.` }],
      };
    }

    const formatted = messages.map(formatMessage).join("\n");
    return {
      content: [
        {
          type: "text",
          text: `${threadHeader}Found ${messages.length} message(s):\n\n${formatted}`,
        },
      ],
    };
  }

  private async handleGetUnreadMessages(args: unknown) {
    const { limit } = GetUnreadMessagesSchema.parse(args ?? {});
    const messages = await this.db.getUnreadMessages(limit ?? 100);

    if (messages.length === 0) {
      return {
        content: [{ type: "text", text: "No unread messages." }],
      };
    }

    const formatted = messages.map(formatMessage).join("\n");
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

  private async handleWaitForReply(args: unknown): Promise<any> {
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

    // Poll for new messages
    while (Date.now() - startTime < timeoutMs) {
      const newMessages = await this.db.getMessagesAfter(chat.chatIdentifier, lastKnownId);

      if (newMessages.length > 0) {
        const formatted = newMessages.map(formatMessage).join("\n");
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

    const limited = await this.db.listConversations(limit);

    if (limited.length === 0) {
      return {
        content: [{ type: "text", text: "No conversations found." }],
      };
    }

    const formatted = limited
      .map((conv) => {
        const slug = conv.threadSlug ?? conv.chatIdentifier;
        const name = conv.displayName || conv.chatIdentifier;
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

    const messages = await this.db.searchMessages(query, limit);

    if (messages.length === 0) {
      return {
        content: [{ type: "text", text: `No messages found matching "${query}".` }],
      };
    }

    const formatted = messages.map(formatMessage).join("\n");
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
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    appendLog("info", "iMessage MCP Server running on stdio");
    console.error("iMessage MCP Server running on stdio");
  }
}

// Run the server
const server = new IMessageMCPServer();
server.run().catch(console.error);
