/**
 * Represents a message from the iMessage database
 */
export interface Message {
  id: number;
  guid: string;
  text: string | null;
  handle: string; // phone number or email
  isFromMe: boolean;
  date: Date;
  dateRead: Date | null;
  isRead: boolean;
  chatId: string;
  service: 'iMessage' | 'SMS';
}

/**
 * Represents a conversation/chat thread
 */
export interface Conversation {
  chatId: string;
  chatIdentifier: string; // phone/email or group identifier
  displayName: string | null;
  participants: string[];
  lastMessageDate: Date | null;
  unreadCount: number;
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
