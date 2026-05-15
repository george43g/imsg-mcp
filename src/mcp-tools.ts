import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const UNLIMITED = Number.MAX_SAFE_INTEGER;
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

const nonEmptyString = (description: string) => z.string().trim().min(1).describe(description);

export const ReactionSchema = z.object({
  type: z.string(),
  emoji: z.string().optional(),
  fromHandle: z.string(),
  isRemoval: z.boolean(),
  targetMessageGuid: z.string(),
  targetMessagePart: z.number().int(),
});

export const ReplyContextSchema = z.object({
  replyToGuid: z.string(),
  replyToText: z.string().nullable().optional(),
});

export const AttachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string().nullable(),
  transferName: z.string().nullable(),
  totalBytes: z.number().int(),
});

export const MessageSchema = z.object({
  id: z.number().int(),
  guid: z.string(),
  text: z.string().nullable(),
  handle: z.string(),
  displayName: z.string().optional(),
  isFromMe: z.boolean(),
  date: z.string(),
  dateRead: z.string().nullable(),
  dateDelivered: z.string().nullable(),
  isRead: z.boolean(),
  isDelivered: z.boolean(),
  chatId: z.string(),
  service: z.enum(["iMessage", "SMS"]),
  isReaction: z.boolean(),
  reaction: ReactionSchema.optional(),
  isReply: z.boolean(),
  replyTo: ReplyContextSchema.optional(),
  reactions: z.array(ReactionSchema).optional(),
  richContentType: z.string().optional(),
  richContentSummary: z.string().optional(),
  isEdited: z.boolean(),
  isRetracted: z.boolean(),
  hasAttachments: z.boolean(),
  attachments: z.array(AttachmentSchema).optional(),
});

export const ConversationSchema = z.object({
  chatId: z.string(),
  chatIdentifier: z.string(),
  displayName: z.string().nullable(),
  rawIdentifier: z.string(),
  participants: z.array(z.string()),
  lastMessageDate: z.string().nullable(),
  lastMessageSnippet: z.string().nullable(),
  unreadCount: z.number().int(),
  threadSlug: z.string(),
  isGroupChat: z.boolean(),
  serviceType: z.enum(["iMessage", "SMS"]),
});

export const GetMessagesSchema = z.object({
  limit: z
    .number()
    .int()
    .min(0)
    .default(20)
    .describe(
      "Number of messages to retrieve. 0 = unlimited (bounded by tool safety limits). Default 20.",
    ),
  chatIdentifier: nonEmptyString("Phone number, email, or chat ID to filter by").optional(),
  threadSlug: nonEmptyString("Thread slug from list_conversations").optional(),
  beforeMessageId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Pagination cursor. Pass `oldestMessageId` from a previous response."),
});

export const GetMessagesOutputSchema = z.object({
  messages: z.array(MessageSchema),
  count: z.number().int(),
  hasMore: z.boolean(),
  oldestMessageId: z.number().int().optional(),
});

export const ExportMessagesSchema = z.object({
  chatIdentifier: nonEmptyString("Phone number, email, or chat ID").optional(),
  threadSlug: nonEmptyString("Thread slug from list_conversations").optional(),
  format: z.enum(["markdown", "csv", "json", "ndjson"]).default("markdown"),
  outputPath: nonEmptyString(
    "Absolute path. Parent directory must exist; file will be created/overwritten.",
  ),
  since: nonEmptyString("Earliest date, ISO or relative like '1 year ago'").optional(),
  until: nonEmptyString("Latest date, ISO or relative like 'yesterday'").optional(),
  pageSize: z.number().int().min(100).max(5000).default(1000),
});

export const ExportMessagesOutputSchema = z.object({
  count: z.number().int(),
  sizeBytes: z.number().int(),
  savedTo: z.string(),
  format: z.string(),
  oldest: z.string().nullable(),
  newest: z.string().nullable(),
  durationMs: z.number(),
});

export const GetUnreadMessagesSchema = z.object({
  limit: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Max unread messages. 0 = unlimited. Default 100."),
});

export const GetUnreadMessagesOutputSchema = z.object({
  messages: z.array(MessageSchema),
  count: z.number().int(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nullable(),
});

export const SendMessageSchema = z.object({
  recipient: nonEmptyString("Phone number or email address to send to").optional(),
  threadSlug: nonEmptyString("Thread slug from list_conversations").optional(),
  message: nonEmptyString("Message text to send"),
});

export const SendMessageOutputSchema = z.object({
  success: z.boolean(),
  target: z.string().optional(),
  error: z.string().optional(),
  timestamp: z.string().nullable().optional(),
  threadSlug: z.string().optional(),
  lastMessageId: z.number().int().optional(),
});

export const WaitForReplySchema = z.object({
  chatIdentifier: nonEmptyString("Phone number, email, or chat ID to monitor").optional(),
  threadSlug: nonEmptyString("Thread slug from list_conversations to monitor").optional(),
  timeoutSeconds: z.number().min(10).max(3600).default(300),
  pollIntervalSeconds: z.number().min(5).max(60).default(10),
  afterMessageId: z.number().int().positive().optional(),
});

export const WaitForReplyOutputSchema = z.object({
  received: z.boolean().optional(),
  messages: z.array(MessageSchema).optional(),
  count: z.number().int().optional(),
  timedOut: z.boolean().optional(),
  timeoutSeconds: z.number().optional(),
  threadSlug: z.string().optional(),
  chatIdentifier: z.string().optional(),
  cancelled: z.boolean().optional(),
  elapsedSeconds: z.number().optional(),
});

export const ListConversationsSchema = z.object({
  limit: z.number().int().min(0).default(20),
});

export const ListConversationsOutputSchema = z.object({
  conversations: z.array(ConversationSchema),
  count: z.number().int(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nullable(),
});

export const SearchMessagesSchema = z.object({
  query: nonEmptyString("Search query"),
  limit: z.number().int().min(0).default(20),
});

export const SearchMessagesOutputSchema = z.object({
  query: z.string().optional(),
  messages: z.array(MessageSchema),
  count: z.number().int(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nullable(),
});

export const GetLogsSchema = z.object({
  tail: z.number().int().min(1).max(500).optional(),
  source: z.enum(["memory", "file", "all"]).optional(),
});

export const GetLogsOutputSchema = z.object({
  source: z.string(),
  tail: z.number().int(),
  sections: z.array(z.string()),
});

export const RunBuildSchema = z.object({});
export const RunBuildOutputSchema = z.object({
  ok: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
});

export const RequestRestartSchema = z.object({});
export const RequestRestartOutputSchema = z.object({
  restartRequested: z.boolean(),
});

export const HealthCheckSchema = z.object({});
export const HealthCheckOutputSchema = z.object({
  status: z.string(),
  issues: z.array(z.string()),
  uptimeMs: z.number(),
  idleMs: z.number(),
  pid: z.number(),
  node: z.string(),
  heapMb: z.number(),
  rssMb: z.number(),
  eventLoopP99Ms: z.number(),
  eventLoopMaxMs: z.number(),
  toolCallCount: z.number(),
  recentErrorCount: z.number(),
  engine: z.string(),
});

export const GetLastSendErrorSchema = z.object({});
export const GetLastSendErrorOutputSchema = z.object({
  lastSendError: z
    .object({
      message: z.string(),
      timestamp: z.string(),
      stderr: z.string().optional(),
      stdout: z.string().optional(),
      code: z.number().optional(),
    })
    .nullable(),
});

// ── Contact tools ────────────────────────────────────────────────────────

export const ContactSchema = z.object({
  id: z.number().int(),
  displayName: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  middleName: z.string().nullable(),
  nickname: z.string().nullable(),
  organization: z.string().nullable(),
  phoneNumbers: z.array(z.string()),
  emails: z.array(z.string()),
});

export const ListContactsSchema = z.object({
  limit: z
    .number()
    .int()
    .min(0)
    .default(20)
    .describe("Max contacts. 0 = unlimited (bounded by safety cap)."),
  offset: z.number().int().min(0).default(0).describe("Offset for pagination."),
});
export const ListContactsOutputSchema = z.object({
  contacts: z.array(ContactSchema),
  count: z.number().int(),
  hasMore: z.boolean(),
  totalCount: z.number().int(),
});

export const SearchContactsSchema = z.object({
  query: nonEmptyString("Substring to match against name, phone, or email."),
  limit: z.number().int().min(0).default(20).describe("Max results. 0 = unlimited."),
});
export const SearchContactsOutputSchema = z.object({
  query: z.string(),
  contacts: z.array(ContactSchema),
  count: z.number().int(),
});

export const GetContactSchema = z
  .object({
    handle: z.string().optional().describe("Phone number or email to look up."),
    id: z.number().int().optional().describe("Numeric contact id."),
  })
  .refine((v) => v.handle !== undefined || v.id !== undefined, {
    message: "Provide either `handle` or `id`.",
  });
export const GetContactOutputSchema = z.object({
  contact: ContactSchema.nullable(),
});

export const ResolveHandleSchema = z.object({
  handle: nonEmptyString("Phone number or email to resolve to a contact name."),
});
export const ResolveHandleOutputSchema = z.object({
  handle: z.string(),
  displayName: z.string(),
  contactId: z.number().int().nullable(),
  label: z.string().nullable(),
  resolved: z.boolean(),
});

export type ToolName = keyof typeof TOOL_SCHEMAS;

export const TOOL_SCHEMAS = {
  get_messages: GetMessagesSchema,
  export_messages: ExportMessagesSchema,
  get_unread_messages: GetUnreadMessagesSchema,
  send_message: SendMessageSchema,
  wait_for_reply: WaitForReplySchema,
  list_conversations: ListConversationsSchema,
  search_messages: SearchMessagesSchema,
  get_logs: GetLogsSchema,
  get_last_send_error: GetLastSendErrorSchema,
  run_build: RunBuildSchema,
  request_restart: RequestRestartSchema,
  health_check: HealthCheckSchema,
  list_contacts: ListContactsSchema,
  search_contacts: SearchContactsSchema,
  get_contact: GetContactSchema,
  resolve_handle: ResolveHandleSchema,
} as const;

export const OUTPUT_SCHEMAS = {
  get_messages: GetMessagesOutputSchema,
  export_messages: ExportMessagesOutputSchema,
  get_unread_messages: GetUnreadMessagesOutputSchema,
  send_message: SendMessageOutputSchema,
  wait_for_reply: WaitForReplyOutputSchema,
  list_conversations: ListConversationsOutputSchema,
  search_messages: SearchMessagesOutputSchema,
  get_logs: GetLogsOutputSchema,
  get_last_send_error: GetLastSendErrorOutputSchema,
  run_build: RunBuildOutputSchema,
  request_restart: RequestRestartOutputSchema,
  health_check: HealthCheckOutputSchema,
  list_contacts: ListContactsOutputSchema,
  search_contacts: SearchContactsOutputSchema,
  get_contact: GetContactOutputSchema,
  resolve_handle: ResolveHandleOutputSchema,
} as const;

type JsonSchema = Tool["inputSchema"];

const noArgsSchema: JsonSchema = { type: "object", properties: {} };

const annotations = {
  read: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  status: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  send: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  export: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  build: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
} satisfies Record<string, ToolAnnotations>;

export const TOOL_TIMEOUTS_MS: Record<string, number> = {
  wait_for_reply: 0,
  run_build: 120_000,
  search_messages: 60_000,
  get_messages: 60_000,
  list_conversations: 60_000,
  get_unread_messages: 60_000,
  send_message: 60_000,
  health_check: 5_000,
  export_messages: 600_000,
  get_logs: 10_000,
  get_last_send_error: 5_000,
  request_restart: 5_000,
  list_contacts: 10_000,
  search_contacts: 10_000,
  get_contact: 5_000,
  resolve_handle: 5_000,
};

export function resolveLimit(limit: number | undefined, defaultValue = 20): number {
  if (limit === undefined) return defaultValue;
  if (limit === 0) return UNLIMITED;
  return limit;
}

export const TOOLS: Tool[] = [
  {
    name: "get_messages",
    description:
      "Get recent iMessages. Optionally filter by conversation. Response footer includes oldestMessageId for beforeMessageId pagination; use export_messages for very large histories.",
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 20, description: "Number of messages. 0 = unlimited." },
        chatIdentifier: { type: "string", description: "Phone number, email, or chat ID" },
        threadSlug: { type: "string", description: "Thread slug from list_conversations" },
        beforeMessageId: {
          type: "number",
          description: "Fetch messages older than this message id",
        },
      },
    },
    // @ts-expect-error
    outputSchema: zodToJsonSchema(GetMessagesOutputSchema),
  },
  {
    name: "export_messages",
    description:
      "Stream-export a conversation to markdown, csv, json, or ndjson without loading all history into memory.",
    annotations: annotations.export,
    inputSchema: {
      type: "object",
      required: ["outputPath"],
      properties: {
        chatIdentifier: { type: "string", description: "Phone number, email, or chat ID" },
        threadSlug: { type: "string", description: "Thread slug from list_conversations" },
        format: {
          type: "string",
          enum: ["markdown", "csv", "json", "ndjson"],
          default: "markdown",
        },
        outputPath: {
          type: "string",
          description: "Absolute output path. Existing files are overwritten.",
        },
        since: { type: "string", description: "Earliest date, ISO or relative" },
        until: { type: "string", description: "Latest date, ISO or relative" },
        pageSize: { type: "number", default: 1000, description: "Internal page size, 100-5000" },
      },
    },
    // @ts-expect-error
    outputSchema: zodToJsonSchema(ExportMessagesOutputSchema),
  },
  {
    name: "get_unread_messages",
    description: "Get unread iMessages across all conversations, newest first.",
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max unread messages. 0 = unlimited. Default 100." },
      },
    },
    // @ts-expect-error
    outputSchema: zodToJsonSchema(GetUnreadMessagesOutputSchema),
  },
  {
    name: "send_message",
    description:
      "Send an iMessage or SMS. Use recipient for 1-on-1 or threadSlug for existing threads, including groups.",
    annotations: annotations.send,
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: {
        recipient: { type: "string", description: "Phone number or email" },
        threadSlug: { type: "string", description: "Thread slug from list_conversations" },
        message: { type: "string", description: "Message text to send" },
      },
    },
    // @ts-expect-error
    outputSchema: zodToJsonSchema(SendMessageOutputSchema),
  },
  {
    name: "wait_for_reply",
    description:
      "Wait for a new incoming message in a conversation until timeout or client cancellation.",
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      properties: {
        chatIdentifier: { type: "string", description: "Phone number, email, or chat ID" },
        threadSlug: { type: "string", description: "Thread slug from list_conversations" },
        timeoutSeconds: {
          type: "number",
          default: 300,
          description: "Timeout in seconds, 10-3600",
        },
        pollIntervalSeconds: {
          type: "number",
          default: 10,
          description: "Polling interval in seconds, 5-60",
        },
        afterMessageId: { type: "number", description: "Only return messages after this id" },
      },
    },
    // @ts-expect-error
    outputSchema: zodToJsonSchema(WaitForReplyOutputSchema),
  },
  {
    name: "list_conversations",
    description:
      "List recent conversations with thread slugs, snippets, unread counts, participants, and service metadata.",
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          default: 20,
          description: "Number of conversations. 0 = unlimited.",
        },
      },
    },
    // @ts-expect-error
    outputSchema: zodToJsonSchema(ListConversationsOutputSchema),
  },
  {
    name: "search_messages",
    description: "Search message text across all conversations.",
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", default: 20, description: "Number of results. 0 = unlimited." },
      },
    },
    // @ts-expect-error
    outputSchema: zodToJsonSchema(SearchMessagesOutputSchema),
  },
  {
    name: "get_logs",
    description: "Return debug logs from memory, file, or both.",
    annotations: annotations.status,
    inputSchema: {
      type: "object",
      properties: {
        tail: { type: "number", description: "Return last N lines. Default 50." },
        source: { type: "string", enum: ["memory", "file", "all"], description: "Log source" },
      },
    },
    // @ts-expect-error
    outputSchema: zodToJsonSchema(GetLogsOutputSchema),
  },
  {
    name: "get_last_send_error",
    description: "Return details for the last send_message failure.",
    annotations: annotations.status,
    inputSchema: noArgsSchema,
    // @ts-expect-error
    outputSchema: zodToJsonSchema(GetLastSendErrorOutputSchema),
  },
  {
    name: "run_build",
    description: "Run pnpm build in the project directory and return stdout/stderr.",
    annotations: annotations.build,
    inputSchema: noArgsSchema,
    // @ts-expect-error
    outputSchema: zodToJsonSchema(RunBuildOutputSchema),
  },
  {
    name: "request_restart",
    description: "Exit the MCP server process so the client can restart it and load new code.",
    annotations: annotations.build,
    inputSchema: noArgsSchema,
    // @ts-expect-error
    outputSchema: zodToJsonSchema(RequestRestartOutputSchema),
  },
  {
    name: "health_check",
    description: "Return in-memory MCP vital signs without touching SQLite.",
    annotations: annotations.status,
    inputSchema: noArgsSchema,
    // @ts-expect-error
    outputSchema: zodToJsonSchema(HealthCheckOutputSchema),
  },
  {
    name: "list_contacts",
    description:
      "List loaded contacts (from macOS Address Book + iCloud sources), sorted by name. Use search_contacts for substring matching.",
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 20, description: "Max contacts. 0 = unlimited." },
        offset: { type: "number", default: 0, description: "Offset for pagination." },
      },
    },
    // @ts-expect-error
    outputSchema: zodToJsonSchema(ListContactsOutputSchema),
  },
  {
    name: "search_contacts",
    description: "Substring-match contacts by display name, phone number, or email.",
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Substring (case-insensitive for name/email)." },
        limit: { type: "number", default: 20, description: "Max results. 0 = unlimited." },
      },
    },
    // @ts-expect-error
    outputSchema: zodToJsonSchema(SearchContactsOutputSchema),
  },
  {
    name: "get_contact",
    description:
      "Fetch a single contact by handle (phone/email) or by numeric id. Returns null if not found.",
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string", description: "Phone number or email to look up." },
        id: { type: "number", description: "Numeric contact id." },
      },
    },
    // @ts-expect-error
    outputSchema: zodToJsonSchema(GetContactOutputSchema),
  },
  {
    name: "resolve_handle",
    description:
      "Resolve a phone number or email to its contact display name. Pass-through if unknown.",
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      required: ["handle"],
      properties: {
        handle: { type: "string", description: "Phone number or email." },
      },
    },
    // @ts-expect-error
    outputSchema: zodToJsonSchema(ResolveHandleOutputSchema),
  },
];
