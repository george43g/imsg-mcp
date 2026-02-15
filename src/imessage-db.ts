/**
 * iMessage Database Reader
 * Uses imessage-parser for robust attributedBody parsing
 * 
 * See docs/IMESSAGE_DB_SCHEMA.md for database structure reference.
 * Schema constants and epoch/timestamp helpers live in db-schema.ts.
 */

import { IMessageDatabase, type ChatRow, type MessageRow } from 'imessage-parser';
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import {
  macTimestampToDate as schemaMacTimestampToDate,
  parseAssociatedMessageGuid as schemaParseAssociatedMessageGuid,
  isReactionType,
  OBJECT_REPLACEMENT_CHAR,
  AssociatedMessageType,
  Tables,
} from './db-schema.js';
import type { Message, Conversation, TapbackType, Reaction, ReplyContext, RichContentType, Attachment } from './types.js';

/**
 * Tapback type codes from iMessage database
 * 2000-2005: Add reaction, 3000-3005: Remove reaction
 */
const TAPBACK_TYPE_MAP: Record<number, { type: TapbackType; isRemoval: boolean }> = {
  2000: { type: 'love', isRemoval: false },
  2001: { type: 'like', isRemoval: false },
  2002: { type: 'dislike', isRemoval: false },
  2003: { type: 'laugh', isRemoval: false },
  2004: { type: 'emphasize', isRemoval: false },
  2005: { type: 'question', isRemoval: false },
  2006: { type: 'emoji', isRemoval: false },  // iOS 18+ custom emoji
  3000: { type: 'love', isRemoval: true },
  3001: { type: 'like', isRemoval: true },
  3002: { type: 'dislike', isRemoval: true },
  3003: { type: 'laugh', isRemoval: true },
  3004: { type: 'emphasize', isRemoval: true },
  3005: { type: 'question', isRemoval: true },
  3006: { type: 'emoji', isRemoval: true },
  1000: { type: 'sticker', isRemoval: false },
};

/** Use schema helper for parsing associated_message_guid. */
const parseAssociatedMessageGuid = schemaParseAssociatedMessageGuid;

/**
 * Determine rich content type from balloon_bundle_id
 */
function getRichContentType(balloonBundleId: string | null): RichContentType | undefined {
  if (!balloonBundleId) return undefined;
  
  if (balloonBundleId === 'com.apple.messages.URLBalloonProvider') {
    return 'link_preview';
  }
  if (balloonBundleId === 'com.apple.DigitalTouchBalloonProvider') {
    return 'digital_touch';
  }
  if (balloonBundleId === 'com.apple.Handwriting.HandwritingProvider') {
    return 'handwriting';
  }
  if (balloonBundleId.includes('findmy') || balloonBundleId.includes('Maps')) {
    return 'location';
  }
  if (balloonBundleId.includes('MSMessageExtensionBalloonPlugin')) {
    return 'app_message';
  }
  return 'unknown';
}

/** Use schema helper for Mac epoch timestamps. */
const macTimestampToDate = schemaMacTimestampToDate;

/**
 * Wrapper around imessage-parser that provides a cleaner interface
 * for MCP server operations
 */
export class IMessageDB {
  private db: IMessageDatabase;
  private raw: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || join(homedir(), 'Library', 'Messages', 'chat.db');
    this.db = new IMessageDatabase(this.dbPath);
    this.raw = new Database(this.dbPath, { readonly: true });
  }

  /**
   * Get the N most recent messages across all conversations
   * By default excludes reactions (tapbacks) for cleaner output
   */
  async getRecentMessages(limit: number = 20, includeReactions: boolean = false): Promise<Message[]> {
    const chats = await this.db.getChats();
    const allMessages: Message[] = [];

    // Get messages from the first few chats
    for (const chat of chats.slice(0, 10)) {
      try {
        const messages = await this.db.getMessagesFromChat(
          chat.ROWID,
          Math.min(limit * 2, 40)  // Fetch more to account for filtered reactions
        );
        
        for (const msg of messages) {
          const parsed = this.db.parseMessage(msg);
          const converted = this.convertMessage(msg, parsed.text, chat.chat_identifier);
          
          // Skip reaction messages unless explicitly requested
          if (!includeReactions && converted.isReaction) continue;
          
          allMessages.push(converted);
        }
      } catch {
        // Skip chats that fail to load
      }
    }

    // Sort by date descending and limit
    return allMessages
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, limit);
  }

  /**
   * Get messages from a specific conversation
   * By default excludes reactions (tapbacks) for cleaner output
   */
  async getMessagesForChat(
    chatIdentifier: string,
    limit: number = 50,
    options: { includeReactions?: boolean; includeReactionDetails?: boolean } = {}
  ): Promise<Message[]> {
    const { includeReactions = false, includeReactionDetails = false } = options;
    const chat = await this.findChatByIdentifier(chatIdentifier);
    if (!chat) return [];

    const messages = await this.db.getMessagesFromChat(chat.ROWID, limit * 2);
    
    const result: Message[] = [];
    for (const msg of messages) {
      const parsed = this.db.parseMessage(msg);
      const converted = this.convertMessage(msg, parsed.text, chatIdentifier, undefined, includeReactionDetails);
      
      // Skip reaction messages unless explicitly requested
      if (!includeReactions && converted.isReaction) continue;
      
      result.push(converted);
    }
    
    return result.slice(0, limit);
  }

  /**
   * Get unread messages across all conversations
   * Excludes reactions for cleaner output
   */
  async getUnreadMessages(): Promise<Message[]> {
    // Query unread incoming directly via raw DB for accuracy
    // Exclude reactions (associated_message_type = 0 means normal message; see db-schema)
    const stmt = this.raw.prepare(`
      SELECT 
        m.ROWID as rowid,
        m.is_from_me,
        m.is_read,
        m.date_read,
        h.id as handle_id,
        c.chat_identifier
      FROM ${Tables.MESSAGE} m
      LEFT JOIN ${Tables.HANDLE} h ON m.handle_id = h.ROWID
      LEFT JOIN ${Tables.CHAT_MESSAGE_JOIN} cmj ON m.ROWID = cmj.message_id
      LEFT JOIN ${Tables.CHAT} c ON cmj.chat_id = c.ROWID
      WHERE m.is_from_me = 0 
        AND m.is_read = 0
        AND m.associated_message_type = ${AssociatedMessageType.NORMAL}
      ORDER BY m.date DESC
      LIMIT 100
    `);

    const flags = stmt.all() as any[];

    // Fetch messages with parser and merge
    const result: Message[] = [];
    for (const f of flags) {
      if (!f.chat_identifier) continue;
      const chat = await this.findChatByIdentifier(f.chat_identifier);
      if (!chat) continue;
      const msgs = await this.db.getMessagesFromChat(chat.ROWID, 50);
      const match = msgs.find(m => m.ROWID === f.rowid);
      if (!match) continue;
      const parsed = this.db.parseMessage(match);
      result.push(this.convertMessage(match, parsed.text, chat.chat_identifier));
    }

    return result;
  }

  /**
   * Get the most recent message in a conversation
   */
  async getLastMessage(chatIdentifier: string): Promise<Message | null> {
    const messages = await this.getMessagesForChat(chatIdentifier, 1);
    return messages[0] || null;
  }

  /**
   * Get messages after a specific message ID (for polling new messages)
   */
  async getMessagesAfter(chatIdentifier: string, afterMessageId: number): Promise<Message[]> {
    const messages = await this.getMessagesForChat(chatIdentifier, 100);
    // Filter to messages after the given ID and not from me
    return messages.filter(m => m.id > afterMessageId && !m.isFromMe);
  }

  /**
   * List all conversations with metadata, sorted by last message date (newest first).
   * Populates lastMessageDate, lastMessageSnippet, and unreadCount to match Messages.app left pane.
   */
  async listConversations(): Promise<Conversation[]> {
    const chats = await this.db.getChats();

    // Last message per chat (date, snippet from text column; attributedBody-only messages may have empty snippet)
    const lastMsgStmt = this.raw.prepare(`
      SELECT chat_id, last_date, last_message_id, snippet FROM (
        SELECT cmj.chat_id, m.date as last_date, m.ROWID as last_message_id,
          COALESCE(TRIM(SUBSTR(m.text, 1, 200)), '') as snippet,
          ROW_NUMBER() OVER (PARTITION BY cmj.chat_id ORDER BY m.date DESC) as rn
        FROM ${Tables.MESSAGE} m
        JOIN ${Tables.CHAT_MESSAGE_JOIN} cmj ON m.ROWID = cmj.message_id
        WHERE m.associated_message_type = ${AssociatedMessageType.NORMAL}
      ) WHERE rn = 1
    `);
    const lastByChat = (lastMsgStmt.all() as { chat_id: number; last_date: number; last_message_id: number; snippet: string }[])
      .reduce((acc, row) => {
        acc[row.chat_id] = {
          lastDate: row.last_date,
          snippet: row.snippet || null,
        };
        return acc;
      }, {} as Record<number, { lastDate: number; snippet: string | null }>);

    // Unread count per chat (incoming, not read, normal messages only)
    const unreadStmt = this.raw.prepare(`
      SELECT cmj.chat_id, COUNT(*) as unread
      FROM ${Tables.MESSAGE} m
      JOIN ${Tables.CHAT_MESSAGE_JOIN} cmj ON m.ROWID = cmj.message_id
      WHERE m.associated_message_type = ${AssociatedMessageType.NORMAL}
        AND m.is_from_me = 0 AND m.is_read = 0
      GROUP BY cmj.chat_id
    `);
    const unreadByChat = (unreadStmt.all() as { chat_id: number; unread: number }[])
      .reduce((acc, row) => { acc[row.chat_id] = row.unread; return acc; }, {} as Record<number, number>);

    const result: Conversation[] = chats.map(chat => {
      const last = lastByChat[chat.ROWID];
      const lastDate = last ? macTimestampToDate(last.lastDate) : null;
      const snippet = last?.snippet ?? null;
      return {
        chatId: chat.guid,
        chatIdentifier: chat.chat_identifier,
        displayName: chat.display_name || null,
        participants: [chat.chat_identifier],
        lastMessageDate: lastDate,
        lastMessageSnippet: snippet && snippet.length > 0 ? snippet : null,
        unreadCount: unreadByChat[chat.ROWID] ?? 0,
      };
    });

    // Sort by last message date descending (newest first), then by chat
    result.sort((a, b) => {
      const aTime = a.lastMessageDate?.getTime() ?? 0;
      const bTime = b.lastMessageDate?.getTime() ?? 0;
      return bTime - aTime;
    });
    return result;
  }

  /**
   * Find a chat by phone number, email, or chat identifier
   */
  async findChatByHandle(handle: string): Promise<Conversation | null> {
    const chats = await this.db.getChats();
    
    // Normalize the search handle
    const normalized = handle.replace(/[\s\-\(\)]/g, '').toLowerCase();
    
    const found = chats.find(chat => {
      const chatNorm = chat.chat_identifier?.replace(/[\s\-\(\)]/g, '').toLowerCase() || '';
      return chatNorm.includes(normalized) || normalized.includes(chatNorm);
    });

    if (!found) return null;

    return {
      chatId: found.guid,
      chatIdentifier: found.chat_identifier,
      displayName: found.display_name || null,
      participants: [found.chat_identifier],
      lastMessageDate: null,
      lastMessageSnippet: null,
      unreadCount: 0,
    };
  }

  /**
   * Search messages across all conversations
   */
  async searchMessages(query: string, limit: number = 20): Promise<Message[]> {
    const results = await this.db.searchMessages(query, limit * 2);  // Fetch extra to filter reactions
    
    const messages: Message[] = [];
    for (const result of results) {
      const parsed = this.db.parseMessage(result);
      const converted = this.convertMessage(
        result,
        parsed.text,
        (result as any).chat_identifier || 'unknown'
      );
      
      // Skip reactions in search results
      if (converted.isReaction) continue;
      
      messages.push(converted);
      if (messages.length >= limit) break;
    }
    
    return messages;
  }

  /**
   * Get a deep link to open a specific conversation in Messages.app
   */
  getConversationLink(chatIdentifier: string): string {
    return `imessage://${encodeURIComponent(chatIdentifier)}`;
  }

  /**
   * Helper to find chat by identifier
   */
  private async findChatByIdentifier(identifier: string): Promise<ChatRow | null> {
    const chats = await this.db.getChats();
    return chats.find(c => 
      c.chat_identifier === identifier || 
      c.guid === identifier ||
      c.chat_identifier.includes(identifier) ||
      identifier.includes(c.chat_identifier)
    ) || null;
  }

  /**
   * Convert imessage-parser message to our Message type with full extended data
   */
  private convertMessage(
    raw: MessageRow,
    text: string | null,
    chatId: string,
    extended?: ExtendedMessageData,
    includeReactions: boolean = false
  ): Message {
    // If no extended data provided, fetch it
    const ext = extended || this.fetchExtendedMessageData(raw.ROWID);
    
    // Clean up text - handle object replacement characters and other special chars
    let cleanText = text || raw.text || null;
    if (cleanText) {
      // U+FFFC is Object Replacement Character (inline attachment placeholder); see db-schema
      // U+FFFD is Replacement Character (invalid UTF-8)
      const re = new RegExp(OBJECT_REPLACEMENT_CHAR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '+', 'g');
      cleanText = cleanText
        .replace(re, '📎 ')  // Use paperclip emoji for inline attachments
        .replace(/\uFFFD/g, '')
        .trim();
      
      // If only attachment markers remain, indicate it's an attachment-only message
      if (!cleanText || cleanText === '📎' || /^(📎\s*)+$/.test(cleanText)) {
        cleanText = '(image/attachment)';
      }
    }
    
    // Determine if this is a reaction (see db-schema.ts and docs)
    const associatedType = ext.associated_message_type ?? AssociatedMessageType.NORMAL;
    const isReaction = isReactionType(associatedType);
    
    // Parse reaction info
    let reaction: Reaction | undefined;
    if (isReaction && ext.associated_message_guid) {
      const typeInfo = TAPBACK_TYPE_MAP[associatedType] || { type: 'unknown' as TapbackType, isRemoval: false };
      const parsed = parseAssociatedMessageGuid(ext.associated_message_guid);
      
      reaction = {
        type: typeInfo.type,
        emoji: ext.associated_message_emoji || undefined,
        fromHandle: raw.is_from_me ? 'me' : (ext.handle_id || 'unknown'),
        isRemoval: typeInfo.isRemoval,
        targetMessageGuid: parsed?.targetGuid || '',
        targetMessagePart: parsed?.partIndex || 0,
      };
    }
    
    // Determine if this is a reply
    const isReply = Boolean(ext.thread_originator_guid);
    let replyTo: ReplyContext | undefined;
    if (isReply && ext.thread_originator_guid) {
      const originalText = this.getMessageTextByGuid(ext.thread_originator_guid);
      replyTo = {
        replyToGuid: ext.thread_originator_guid,
        replyToText: originalText,
      };
    }
    
    // Get rich content type
    const richContentType = getRichContentType(ext.balloon_bundle_id || null);
    
    // Get attachments if needed
    const hasAttachments = Boolean(ext.cache_has_attachments);
    let attachments: Attachment[] | undefined;
    if (hasAttachments) {
      attachments = this.fetchAttachments(raw.ROWID);
    }
    
    // Get reactions for this message if requested
    let reactions: Reaction[] | undefined;
    if (includeReactions && !isReaction) {
      reactions = this.fetchReactionsForMessage(raw.guid);
      // Filter out removal reactions that cancel out adds
      if (reactions.length > 0) {
        reactions = this.consolidateReactions(reactions);
      }
      if (reactions.length === 0) reactions = undefined;
    }
    
    return {
      id: raw.ROWID,
      guid: raw.guid,
      text: cleanText,
      handle: raw.is_from_me ? 'me' : (ext.handle_id || 'unknown'),
      isFromMe: Boolean(raw.is_from_me),
      date: macTimestampToDate(raw.date) || new Date(0),
      dateRead: macTimestampToDate(ext.date_read ?? null),
      isRead: ext.is_read != null ? Boolean(ext.is_read) : true,
      chatId: chatId,
      service: 'iMessage', // Default to iMessage
      isReaction,
      reaction,
      isReply,
      replyTo,
      reactions,
      richContentType,
      isEdited: Boolean(ext.date_edited && ext.date_edited > 0),
      isRetracted: Boolean(ext.date_retracted && ext.date_retracted > 0),
      hasAttachments,
      attachments,
    };
  }

  /**
   * Consolidate reactions by removing reactions that are canceled by removal messages
   */
  private consolidateReactions(reactions: Reaction[]): Reaction[] {
    const reactionMap = new Map<string, Reaction>();
    
    for (const r of reactions) {
      const key = `${r.fromHandle}-${r.type}-${r.targetMessagePart}`;
      if (r.isRemoval) {
        reactionMap.delete(key);
      } else {
        reactionMap.set(key, r);
      }
    }
    
    return Array.from(reactionMap.values());
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.db.close();
    this.raw.close();
  }

  /**
   * Fetch extended message data using raw DB
   * Includes: is_read, date_read, handle_id, reaction data, reply data, edit status, attachments
   */
  private fetchExtendedMessageData(rowid: number): ExtendedMessageData {
    const stmt = this.raw.prepare(`
      SELECT 
        m.is_read,
        m.date_read,
        h.id as handle_id,
        m.associated_message_type,
        m.associated_message_guid,
        m.associated_message_emoji,
        m.thread_originator_guid,
        m.thread_originator_part,
        m.balloon_bundle_id,
        m.date_edited,
        m.date_retracted,
        m.cache_has_attachments
      FROM ${Tables.MESSAGE} m
      LEFT JOIN ${Tables.HANDLE} h ON m.handle_id = h.ROWID
      WHERE m.ROWID = ?
      LIMIT 1
    `);
    return (stmt.get(rowid) as ExtendedMessageData) || {};
  }

  /**
   * Fetch attachments for a message
   */
  private fetchAttachments(messageRowId: number): Attachment[] {
    const stmt = this.raw.prepare(`
      SELECT 
        a.filename,
        a.mime_type,
        a.transfer_name,
        a.total_bytes
      FROM ${Tables.ATTACHMENT} a
      JOIN ${Tables.MESSAGE_ATTACHMENT_JOIN} maj ON a.ROWID = maj.attachment_id
      WHERE maj.message_id = ?
    `);
    const rows = stmt.all(messageRowId) as any[];
    return rows.map(r => ({
      filename: r.filename || '',
      mimeType: r.mime_type,
      transferName: r.transfer_name,
      totalBytes: r.total_bytes || 0,
    }));
  }

  /**
   * Fetch reactions for a specific message GUID
   */
  private fetchReactionsForMessage(messageGuid: string): Reaction[] {
    const stmt = this.raw.prepare(`
      SELECT 
        m.associated_message_type,
        m.associated_message_guid,
        m.associated_message_emoji,
        h.id as handle_id,
        m.is_from_me
      FROM ${Tables.MESSAGE} m
      LEFT JOIN ${Tables.HANDLE} h ON m.handle_id = h.ROWID
      WHERE m.associated_message_guid LIKE ?
        AND m.associated_message_type >= 2000
    `);
    
    const rows = stmt.all(`%/${messageGuid}`) as any[];
    
    return rows.map(r => {
      const typeInfo = TAPBACK_TYPE_MAP[r.associated_message_type] || { type: 'unknown' as TapbackType, isRemoval: false };
      const parsed = parseAssociatedMessageGuid(r.associated_message_guid);
      
      return {
        type: typeInfo.type,
        emoji: r.associated_message_emoji || undefined,
        fromHandle: r.is_from_me ? 'me' : (r.handle_id || 'unknown'),
        isRemoval: typeInfo.isRemoval,
        targetMessageGuid: parsed?.targetGuid || messageGuid,
        targetMessagePart: parsed?.partIndex || 0,
      };
    });
  }

  /**
   * Look up the text of a message by GUID (for reply context)
   * Falls back to parsing attributedBody if text is null
   */
  private getMessageTextByGuid(guid: string): string | null {
    const stmt = this.raw.prepare(`SELECT ROWID, text, attributedBody FROM ${Tables.MESSAGE} WHERE guid = ? LIMIT 1`);
    const row = stmt.get(guid) as { ROWID: number; text: string | null; attributedBody: Buffer | null } | undefined;
    if (!row) return null;
    
    // Try text field first
    if (row.text) return row.text;
    
    // Fall back to parsing attributedBody if available
    if (row.attributedBody) {
      try {
        // Use imessage-parser to parse the attributedBody
        // We need to fetch the full message row for the parser
        const fullRow = this.raw.prepare(`SELECT * FROM ${Tables.MESSAGE} WHERE ROWID = ?`).get(row.ROWID);
        if (fullRow) {
          const parsed = this.db.parseMessage(fullRow as any);
          return parsed.text || null;
        }
      } catch {
        // Ignore parsing errors
      }
    }
    
    return null;
  }
}

/**
 * Extended message data from raw database query
 */
interface ExtendedMessageData {
  is_read?: number;
  date_read?: number;
  handle_id?: string | null;
  associated_message_type?: number;
  associated_message_guid?: string | null;
  associated_message_emoji?: string | null;
  thread_originator_guid?: string | null;
  thread_originator_part?: string | null;
  balloon_bundle_id?: string | null;
  date_edited?: number;
  date_retracted?: number;
  cache_has_attachments?: number;
}
