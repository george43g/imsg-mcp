/**
 * Tapback reaction types
 * 2000-2005: Add reaction, 3000-3005: Remove reaction
 */
export type TapbackType =
  | "love"
  | "like"
  | "dislike"
  | "laugh"
  | "emphasize"
  | "question"
  | "emoji" // iOS 18+ custom emoji
  | "sticker"
  | "unknown";

/**
 * Represents a tapback reaction on a message
 */
export interface Reaction {
  type: TapbackType;
  emoji?: string; // For custom emoji reactions (iOS 18+)
  fromHandle: string;
  isRemoval: boolean; // true if this removes a previous reaction
  targetMessageGuid: string;
  targetMessagePart: number; // Which part of a multi-part message
}

/**
 * Represents a reply context
 */
export interface ReplyContext {
  replyToGuid: string;
  replyToText?: string | null; // The text of the message being replied to
}

/**
 * Rich message content types
 */
export type RichContentType =
  | "link_preview"
  | "location"
  | "digital_touch"
  | "handwriting"
  | "app_message"
  | "unknown";

/**
 * Represents a message from the iMessage database
 */
export interface Message {
  id: number;
  guid: string;
  text: string | null;
  handle: string; // phone number or email
  displayName?: string; // Resolved contact name (if available)
  isFromMe: boolean;
  date: Date;
  dateRead: Date | null;
  dateDelivered: Date | null;
  isRead: boolean;
  isDelivered: boolean;
  chatId: string;
  service: "iMessage" | "SMS";

  // Reaction info (if this message is a tapback)
  isReaction: boolean;
  reaction?: Reaction;

  // Reply context (if this message is a reply to another)
  isReply: boolean;
  replyTo?: ReplyContext;

  // Reactions received on this message
  reactions?: Reaction[];

  // Rich content
  richContentType?: RichContentType;
  richContentSummary?: string; // Parsed summary from message_summary_info BLOB

  // Edit/retract status (iOS 16+)
  isEdited: boolean;
  isRetracted: boolean;

  // Attachments
  hasAttachments: boolean;
  attachments?: Attachment[];
}

/**
 * Represents an attachment
 */
export interface Attachment {
  filename: string;
  mimeType: string | null;
  transferName: string | null;
  totalBytes: number;
}

/**
 * Represents a conversation/chat thread
 */
export interface Conversation {
  chatId: string;
  chatIdentifier: string; // phone/email or group identifier
  displayName: string | null; // Contact display name or group name
  rawIdentifier: string; // Original phone/email before contact lookup
  participants: string[];
  lastMessageDate: Date | null;
  /** Last message text preview (may be empty if stored in attributedBody only). */
  lastMessageSnippet: string | null;
  unreadCount: number;
  /** Stable human-readable thread slug (e.g. "alice~imsg~a3f2"). */
  threadSlug: string;
  /** True for group conversations (multiple participants). */
  isGroupChat: boolean;
  /** Service type for this conversation. */
  serviceType: "iMessage" | "SMS";
}

/**
 * Result of sending a message
 */
export interface SendMessageResult {
  success: boolean;
  error?: string;
  timestamp?: Date;
}

/**
 * Options for waiting for a reply
 */
export interface WaitForReplyOptions {
  chatId: string;
  afterMessageId?: number;
  timeoutMs: number;
  pollIntervalMs?: number;
}

/**
 * Result of waiting for a reply
 */
export interface WaitForReplyResult {
  received: boolean;
  message?: Message;
  timedOut: boolean;
}

/**
 * Conversation thread context for AI agents
 */
export interface ConversationThread {
  conversationId: string;
  recipient: string;
  messages: Message[];
  lastSentByMe: Message | null;
  lastReceivedFromThem: Message | null;
  awaitingReply: boolean;
}
