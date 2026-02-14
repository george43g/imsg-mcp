/**
 * iMessage Database Reader
 * Uses imessage-parser for robust attributedBody parsing
 */

import { IMessageDatabase, type ChatRow, type MessageRow } from 'imessage-parser';
import type { Message, Conversation } from './types.js';

// macOS epoch offset (seconds between 1970-01-01 and 2001-01-01)
const MAC_EPOCH_OFFSET = 978307200;

/**
 * Convert macOS timestamp (nanoseconds since 2001) to JS Date
 */
function macTimestampToDate(timestamp: number | null): Date | null {
  if (!timestamp || timestamp === 0) return null;
  const unixSeconds = timestamp / 1_000_000_000 + MAC_EPOCH_OFFSET;
  return new Date(unixSeconds * 1000);
}

/**
 * Wrapper around imessage-parser that provides a cleaner interface
 * for MCP server operations
 */
export class IMessageDB {
  private db: IMessageDatabase;

  constructor(dbPath?: string) {
    this.db = new IMessageDatabase(dbPath);
  }

  /**
   * Get the N most recent messages across all conversations
   */
  async getRecentMessages(limit: number = 20): Promise<Message[]> {
    const chats = await this.db.getChats();
    const allMessages: Message[] = [];

    // Get messages from the first few chats
    for (const chat of chats.slice(0, 10)) {
      try {
        const messages = await this.db.getMessagesFromChat(
          chat.ROWID,
          Math.min(limit, 20)
        );
        
        for (const msg of messages) {
          const parsed = this.db.parseMessage(msg);
          allMessages.push(this.convertMessage(msg, parsed.text, chat.chat_identifier));
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
   */
  async getMessagesForChat(chatIdentifier: string, limit: number = 50): Promise<Message[]> {
    const chat = await this.findChatByIdentifier(chatIdentifier);
    if (!chat) return [];

    const messages = await this.db.getMessagesFromChat(chat.ROWID, limit);
    
    return messages.map(msg => {
      const parsed = this.db.parseMessage(msg);
      return this.convertMessage(msg, parsed.text, chatIdentifier);
    });
  }

  /**
   * Get unread messages across all conversations
   * Note: imessage-parser doesn't expose is_read, so this returns recent incoming messages
   */
  async getUnreadMessages(): Promise<Message[]> {
    const messages = await this.getRecentMessages(100);
    // Filter to incoming messages only since we can't check read status
    return messages.filter(m => !m.isFromMe);
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
   * List all conversations with metadata
   */
  async listConversations(): Promise<Conversation[]> {
    const chats = await this.db.getChats();
    
    return chats.map(chat => ({
      chatId: chat.guid,
      chatIdentifier: chat.chat_identifier,
      displayName: chat.display_name || null,
      participants: [chat.chat_identifier], // Single participant for 1:1 chats
      lastMessageDate: null, // Would need additional query
      unreadCount: 0,
    }));
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
      unreadCount: 0,
    };
  }

  /**
   * Search messages across all conversations
   */
  async searchMessages(query: string, limit: number = 20): Promise<Message[]> {
    const results = await this.db.searchMessages(query, limit);
    
    return results.map(result => {
      const parsed = this.db.parseMessage(result);
      return this.convertMessage(
        result,
        parsed.text,
        (result as any).chat_identifier || 'unknown'
      );
    });
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
   * Convert imessage-parser message to our Message type
   */
  private convertMessage(raw: MessageRow, text: string | null, chatId: string): Message {
    return {
      id: raw.ROWID,
      guid: raw.guid,
      text: text || raw.text || null,
      handle: raw.handle_id || 'unknown',
      isFromMe: Boolean(raw.is_from_me),
      date: macTimestampToDate(raw.date) || new Date(0),
      dateRead: null, // Not exposed by imessage-parser
      isRead: true,   // Assume read since we can't check
      chatId: chatId,
      service: 'iMessage', // Default to iMessage
    };
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.db.close();
  }
}
