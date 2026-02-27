/**
 * iMessage wire format — message types, payloads, and serialization.
 *
 * Phase 3 implementation. This module will handle:
 * - Binary plist message payloads
 * - Message type catalog (text, reactions, read receipts, typing, group ops)
 * - Multi-device addressing
 * - MMCS attachment upload/download
 *
 * Reference: docs/RESEARCH_IMESSAGE_PROTOCOL_AND_IMPLEMENTATIONS.md
 */

export enum MessageType {
  Normal = 0,
  Sticker = 1000,
  LoveAdd = 2000,
  LikeAdd = 2001,
  DislikeAdd = 2002,
  LaughAdd = 2003,
  EmphasizeAdd = 2004,
  QuestionAdd = 2005,
  EmojiAdd = 2006,
}

export interface iMessagePayload {
  type: MessageType;
  text?: string;
  subject?: string;
  groupId?: string;
  replyToGuid?: string;
  attachments?: AttachmentRef[];
}

export interface AttachmentRef {
  mimeType: string;
  filename: string;
  size: number;
  mmcsUrl?: string;
  decryptionKey?: Buffer;
}

// Phase 3: Full message formatting and parsing will be implemented here.
