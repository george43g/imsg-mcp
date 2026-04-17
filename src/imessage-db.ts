/**
 * iMessage Database Reader
 *
 * All database access goes through a single better-sqlite3 connection.
 * attributedBody parsing uses our local TypedStreamParser fork.
 *
 * See docs/IMESSAGE_DB_SCHEMA.md for database structure reference.
 * Schema constants and epoch/timestamp helpers live in db-schema.ts.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

/** Minimal chat row from the chat table. */
export interface ChatRow {
  ROWID: number;
  guid: string;
  chat_identifier: string;
  display_name: string | null;
}

/** Raw message row from the message table (columns used throughout this module). */
export interface MessageRow {
  ROWID: number;
  guid: string;
  text: string | null;
  attributedBody: Buffer | null;
  date: number;
  is_from_me: number;
  handle_id: string | null;
  cache_has_attachments: number;
}
import { extractAttributedBodyText } from "./attributed-body-text.js";
import { ContactsDB } from "./contacts-db.js";
import {
  AssociatedMessageType,
  isReactionType,
  OBJECT_REPLACEMENT_CHAR,
  macTimestampToDate as schemaMacTimestampToDate,
  parseAssociatedMessageGuid as schemaParseAssociatedMessageGuid,
  Tables,
} from "./db-schema.js";
import {
  isMetadataOnlySnippet,
  normalizeRichMetadataText,
  pickConversationSnippet,
} from "./conversation-snippet.js";
import { extractChatSummaryText } from "./plist-text.js";
import { type SlugRecord, SlugStore } from "./slug-store.js";
import { generateThreadSlug, isGroupChatIdentifier, isGroupGuid } from "./thread-slug.js";
import type {
  Attachment,
  Conversation,
  Message,
  Reaction,
  ReplyContext,
  RichContentType,
  TapbackType,
} from "./types.js";

/** Chat row with last message date and service from join (for sorting by activity). */
type ChatWithLastDate = ChatRow & { last_date: number | null; service_name?: string | null };
type LastConversationRow = {
  chatId: number;
  lastDate: number;
  lastMessageId: number;
  lastService: string | null;
  lastIsFromMe: boolean;
  balloonBundleId: string | null;
  snippet: string | null;
  chatProperties: Buffer | null;
};
type PreparedConversationEntry = {
  last?: LastConversationRow;
  mergeKey: string;
  conversation: Conversation;
};

function toChatRow(c: ChatWithLastDate): ChatRow {
  return {
    ROWID: c.ROWID,
    guid: c.guid,
    chat_identifier: c.chat_identifier,
    display_name: c.display_name,
  };
}

/**
 * Tapback type codes from iMessage database
 * 2000-2005: Add reaction, 3000-3005: Remove reaction
 */
const TAPBACK_TYPE_MAP: Record<number, { type: TapbackType; isRemoval: boolean }> = {
  2000: { type: "love", isRemoval: false },
  2001: { type: "like", isRemoval: false },
  2002: { type: "dislike", isRemoval: false },
  2003: { type: "laugh", isRemoval: false },
  2004: { type: "emphasize", isRemoval: false },
  2005: { type: "question", isRemoval: false },
  2006: { type: "emoji", isRemoval: false }, // iOS 18+ custom emoji
  3000: { type: "love", isRemoval: true },
  3001: { type: "like", isRemoval: true },
  3002: { type: "dislike", isRemoval: true },
  3003: { type: "laugh", isRemoval: true },
  3004: { type: "emphasize", isRemoval: true },
  3005: { type: "question", isRemoval: true },
  3006: { type: "emoji", isRemoval: true },
  1000: { type: "sticker", isRemoval: false },
};

/** Use schema helper for parsing associated_message_guid. */
const parseAssociatedMessageGuid = schemaParseAssociatedMessageGuid;

function isPlaceholderText(text: string | null | undefined): boolean {
  if (!text) return true;
  return /^[\uFFFC\uFFFD\s]+$/u.test(text);
}

function isHiddenSystemItem(itemType: number | null | undefined): boolean {
  return (itemType ?? 0) !== 0;
}

/**
 * Determine rich content type from balloon_bundle_id
 */
function getRichContentType(balloonBundleId: string | null): RichContentType | undefined {
  if (!balloonBundleId) return undefined;

  if (balloonBundleId === "com.apple.messages.URLBalloonProvider") {
    return "link_preview";
  }
  if (balloonBundleId === "com.apple.DigitalTouchBalloonProvider") {
    return "digital_touch";
  }
  if (balloonBundleId === "com.apple.Handwriting.HandwritingProvider") {
    return "handwriting";
  }
  if (balloonBundleId.includes("findmy") || balloonBundleId.includes("Maps")) {
    return "location";
  }
  if (balloonBundleId.includes("MSMessageExtensionBalloonPlugin")) {
    return "app_message";
  }
  return "unknown";
}

/** Use schema helper for Mac epoch timestamps. */
const macTimestampToDate = schemaMacTimestampToDate;

export class IMessageDB {
  private raw: Database.Database;
  private dbPath: string;
  private contacts: ContactsDB;
  private slugStore: SlugStore;
  /** In-memory slug -> ChatWithLastDate for fast lookups during a session. */
  private slugMap = new Map<string, ChatWithLastDate>();
  /** In-memory chat guid -> slug for stable per-chat slug lookups. */
  private guidToSlug = new Map<string, string>();

  constructor(dbPath?: string, contactsDbPaths?: string | string[], slugStorePath?: string) {
    this.dbPath = dbPath || join(homedir(), "Library", "Messages", "chat.db");
    this.raw = new Database(this.dbPath, { readonly: true });
    this.contacts = new ContactsDB(contactsDbPaths);
    this.slugStore = new SlugStore(slugStorePath);

    try {
      this.contacts.initialize();
    } catch (err) {
      console.warn("Failed to initialize contacts database:", err);
    }

    this.syncSlugs();
  }

  /**
   * Sync thread slugs: iterate all chats, generate slugs, upsert into SlugStore, prune stale.
   */
  private syncSlugs(): void {
    const chats = this.getAllChatsWithLastDate();
    const validGuids = new Set<string>();
    const records: SlugRecord[] = [];

    this.slugMap.clear();
    this.guidToSlug.clear();

    for (const chat of chats) {
      validGuids.add(chat.guid);
      const isGroup = isGroupGuid(chat.guid) || isGroupChatIdentifier(chat.chat_identifier);
      const resolvedName =
        !isGroup && chat.chat_identifier ? this.contacts.lookupHandle(chat.chat_identifier) : null;

      const slug = generateThreadSlug({
        chatIdentifier: chat.chat_identifier,
        guid: chat.guid,
        displayName: chat.display_name,
        serviceName: chat.service_name ?? null,
        resolvedContactName: resolvedName !== chat.chat_identifier ? resolvedName : null,
      });

      const participants = isGroup
        ? this.fetchChatParticipants(chat.ROWID)
        : [chat.chat_identifier];

      records.push({
        slug,
        chatGuid: chat.guid,
        chatIdentifier: chat.chat_identifier,
        displayName:
          resolvedName !== chat.chat_identifier ? resolvedName : chat.display_name || null,
        service: this.detectServiceForChat(chat),
        isGroup,
        participants: participants.join(","),
        updatedAt: Date.now(),
      });

      this.slugMap.set(slug, chat);
      this.guidToSlug.set(chat.guid, slug);
    }

    this.slugStore.upsertMany(records);
    this.slugStore.prune(validGuids);
  }

  /** Look up a chat by thread slug. */
  findChatBySlug(slug: string): ChatRow | null {
    const cached = this.slugMap.get(slug);
    if (cached) return toChatRow(cached);
    const record = this.slugStore.lookupBySlug(slug);
    if (!record) return null;
    return this.findChatByIdentifier(record.chatIdentifier);
  }

  /** Get the slug for a specific chat GUID. */
  getSlugForChatGuid(chatGuid: string): string | null {
    const cached = this.guidToSlug.get(chatGuid);
    if (cached) return cached;
    const record = this.slugStore.lookupByGuid(chatGuid);
    return record?.slug ?? null;
  }

  /** Get the slug record for a chat_identifier (for attaching to output). */
  getSlugForChatIdentifier(chatIdentifier: string): string | null {
    const matches = [...this.slugMap.entries()].filter(([, chat]) => chat.chat_identifier === chatIdentifier);
    if (matches.length === 1) return matches[0][0];
    if (matches.length > 1) return null;
    const record = this.slugStore.lookupByChatIdentifier(chatIdentifier);
    return record?.slug ?? null;
  }

  /** Get slug record by slug string. */
  getSlugRecord(slug: string): SlugRecord | null {
    return this.slugStore.lookupBySlug(slug);
  }

  /** Get all slug records. */
  getAllSlugs(): SlugRecord[] {
    return this.slugStore.all();
  }

  /** Fetch group chat participants from chat_handle_join. */
  private fetchChatParticipants(chatRowId: number): string[] {
    const stmt = this.raw.prepare(`
      SELECT h.id
      FROM ${Tables.CHAT_HANDLE_JOIN} chj
      JOIN ${Tables.HANDLE} h ON chj.handle_id = h.ROWID
      WHERE chj.chat_id = ?
    `);
    const rows = stmt.all(chatRowId) as { id: string }[];
    return rows.map((r) => r.id);
  }

  /** Detect service type from chat data. */
  private detectServiceForChat(chat: ChatWithLastDate): "iMessage" | "SMS" {
    if (chat.service_name) {
      return chat.service_name.toLowerCase().includes("sms") ? "SMS" : "iMessage";
    }
    if (chat.guid) {
      return chat.guid.toLowerCase().startsWith("sms") ? "SMS" : "iMessage";
    }
    return "iMessage";
  }

  /**
   * Get the N most recent messages across all conversations
   * By default excludes reactions (tapbacks) for cleaner output
   */
  async getRecentMessages(
    limit: number = 20,
    includeReactions: boolean = false,
  ): Promise<Message[]> {
    const chats = this.getAllChatsWithLastDate()
      .sort((a, b) => (b.last_date ?? 0) - (a.last_date ?? 0))
      .slice(0, 10);

    const allMessages: Message[] = [];

    for (const chat of chats) {
      try {
        const rows = this.fetchMessagesForChatRowId(chat.ROWID, Math.min(limit * 2, 40));

        for (const msg of rows) {
          const text = this.parseMessageText(msg);
          const ext = this.fetchExtendedMessageData(msg.ROWID);
          if (isHiddenSystemItem(ext.item_type)) continue;
          const converted = this.convertMessage(msg, text, chat.chat_identifier, ext);

          if (!includeReactions && converted.isReaction) continue;

          allMessages.push(converted);
        }
      } catch {
        // Skip chats that fail to load
      }
    }

    return allMessages.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, limit);
  }

  /**
   * Get messages from a specific conversation, sorted by date ascending (chronological).
   * By default excludes reactions (tapbacks) for cleaner output.
   */
  async getMessagesForChat(
    chatIdentifier: string,
    limit: number = 50,
    options: { includeReactions?: boolean; includeReactionDetails?: boolean } = {},
  ): Promise<Message[]> {
    const { includeReactions = false, includeReactionDetails = false } = options;
    const chats = this.resolveChatsForConversation(chatIdentifier);
    if (chats.length === 0) return [];

    const perChatLimit = Math.max(limit * 2, 50);
    const result = new Map<number, Message>();
    for (const chat of chats) {
      const rows = this.fetchMessagesForChatRowId(chat.ROWID, perChatLimit);

      for (const msg of rows) {
        const text = this.parseMessageText(msg);
        const ext = this.fetchExtendedMessageData(msg.ROWID);
        if (isHiddenSystemItem(ext.item_type)) continue;
        const converted = this.convertMessage(
          msg,
          text,
          chat.chat_identifier,
          ext,
          includeReactionDetails,
        );

        if (!includeReactions && converted.isReaction) continue;

        result.set(converted.id, converted);
      }
    }

    // Sort by timestamp ascending (chronological conversation order)
    return [...result.values()]
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(-limit);
  }

  /**
   * Get unread messages across all conversations, sorted by date descending (newest first).
   * Excludes reactions for cleaner output.
   * @param limit Max number of messages to return (default 100).
   */
  async getUnreadMessages(limit: number = 100): Promise<Message[]> {
    const stmt = this.raw.prepare(`
      SELECT
        m.ROWID,
        m.guid,
        m.text,
        m.attributedBody,
        m.date,
        m.is_from_me,
        h.id as handle_id,
        m.cache_has_attachments,
        c.chat_identifier
      FROM ${Tables.MESSAGE} m
      LEFT JOIN ${Tables.HANDLE} h ON m.handle_id = h.ROWID
      LEFT JOIN ${Tables.CHAT_MESSAGE_JOIN} cmj ON m.ROWID = cmj.message_id
      LEFT JOIN ${Tables.CHAT} c ON cmj.chat_id = c.ROWID
      WHERE m.is_from_me = 0
        AND m.is_read = 0
        AND m.associated_message_type = ${AssociatedMessageType.NORMAL}
        AND COALESCE(m.item_type, 0) = 0
      ORDER BY m.date DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as (MessageRow & { chat_identifier: string | null })[];

    const result: Message[] = [];
    for (const row of rows) {
      if (!row.chat_identifier) continue;
      const text = this.parseMessageText(row);
      const ext = this.fetchExtendedMessageData(row.ROWID);
      result.push(this.convertMessage(row, text, row.chat_identifier, ext));
    }

    result.sort((a, b) => b.date.getTime() - a.date.getTime());
    return result.slice(0, limit);
  }

  /**
   * Get the most recent message in a conversation
   */
  async getLastMessage(chatIdentifier: string): Promise<Message | null> {
    const messages = await this.getMessagesForChat(chatIdentifier, 1);
    return messages.length > 0 ? messages[messages.length - 1] : null;
  }

  /**
   * Get messages after a specific message ID (for polling new messages).
   * Returns incoming messages only, sorted by date ascending (chronological).
   */
  async getMessagesAfter(chatIdentifier: string, afterMessageId: number): Promise<Message[]> {
    const messages = await this.getMessagesForChat(chatIdentifier, 100);
    const filtered = messages.filter((m) => m.id > afterMessageId && !m.isFromMe);
    filtered.sort((a, b) => a.date.getTime() - b.date.getTime());
    return filtered;
  }

  /**
   * List all conversations with metadata, sorted by last message date (newest first).
   * Populates lastMessageDate, lastMessageSnippet, and unreadCount to match Messages.app left pane.
   */
  async listConversations(limit: number = 200): Promise<Conversation[]> {
    const chats = this.getAllChats();

    // Last message per chat (date, snippet from text column; attributedBody-only messages may have empty snippet)
    const lastMsgStmt = this.raw.prepare(`
      SELECT chat_id, last_date, last_message_id, last_service, last_is_from_me, balloon_bundle_id, snippet, chat_properties FROM (
        SELECT cmj.chat_id, m.date as last_date, m.ROWID as last_message_id,
          m.service as last_service,
          m.is_from_me as last_is_from_me,
          m.balloon_bundle_id as balloon_bundle_id,
          COALESCE(TRIM(SUBSTR(m.text, 1, 200)), '') as snippet,
          c.properties as chat_properties,
          ROW_NUMBER() OVER (PARTITION BY cmj.chat_id ORDER BY m.date DESC) as rn
        FROM ${Tables.MESSAGE} m
        JOIN ${Tables.CHAT_MESSAGE_JOIN} cmj ON m.ROWID = cmj.message_id
        JOIN ${Tables.CHAT} c ON c.ROWID = cmj.chat_id
        WHERE m.associated_message_type = ${AssociatedMessageType.NORMAL}
          AND COALESCE(m.item_type, 0) = 0
      ) WHERE rn = 1
    `);
    const lastByChat = (
      lastMsgStmt.all() as {
        chat_id: number;
        last_date: number;
        last_message_id: number;
        last_service: string | null;
        last_is_from_me: number;
        balloon_bundle_id: string | null;
        snippet: string;
        chat_properties: Buffer | null;
      }[]
    ).reduce(
      (acc, row) => {
        acc[row.chat_id] = {
          chatId: row.chat_id,
          lastDate: row.last_date,
          lastMessageId: row.last_message_id,
          lastService: row.last_service,
          lastIsFromMe: Boolean(row.last_is_from_me),
          balloonBundleId: row.balloon_bundle_id,
          snippet: row.snippet || null,
          chatProperties: row.chat_properties,
        };
        return acc;
      },
      {} as Record<number, LastConversationRow>,
    );

    // Unread count per chat (incoming, not read, normal messages only)
    const unreadStmt = this.raw.prepare(`
      SELECT cmj.chat_id, COUNT(*) as unread
      FROM ${Tables.MESSAGE} m
      JOIN ${Tables.CHAT_MESSAGE_JOIN} cmj ON m.ROWID = cmj.message_id
      WHERE m.associated_message_type = ${AssociatedMessageType.NORMAL}
        AND COALESCE(m.item_type, 0) = 0
        AND m.is_from_me = 0 AND m.is_read = 0
      GROUP BY cmj.chat_id
    `);
    const unreadByChat = (unreadStmt.all() as { chat_id: number; unread: number }[]).reduce(
      (acc, row) => {
        acc[row.chat_id] = row.unread;
        return acc;
      },
      {} as Record<number, number>,
    );

    const prepared = chats.map((chat) => {
      const last = lastByChat[chat.ROWID];
      const lastDate = last ? macTimestampToDate(last.lastDate) : null;

      const rawIdentifier = chat.chat_identifier;
      const isGroup = isGroupGuid(chat.guid) || isGroupChatIdentifier(rawIdentifier);
      let displayName = chat.display_name;
      if (!displayName && rawIdentifier && !isGroup) {
        const resolved = this.contacts.lookupHandle(rawIdentifier);
        displayName = resolved !== rawIdentifier ? resolved : null;
      }

      const participants = isGroup ? this.fetchChatParticipants(chat.ROWID) : [rawIdentifier];
      const mergeKey = this.getConversationMergeKey(rawIdentifier, chat.guid, isGroup);

      const slug = this.getSlugForChatGuid(chat.guid) ?? rawIdentifier;

      const chatData = this.slugMap.get(slug);
      const serviceType = chatData ? this.detectServiceForChat(chatData) : "iMessage";

      return {
        last,
        mergeKey,
        conversation: {
          chatId: chat.guid,
          chatIdentifier: rawIdentifier,
          displayName: displayName || null,
          rawIdentifier,
          participants,
          lastMessageDate: lastDate,
          lastMessageSnippet: null,
          unreadCount: unreadByChat[chat.ROWID] ?? 0,
          threadSlug: slug,
          isGroupChat: isGroup,
          serviceType,
        } satisfies Conversation,
      };
    });

    // Sort by last message date descending (newest first), then merge duplicate rows
    prepared.sort((a, b) => {
      const aTime = a.conversation.lastMessageDate?.getTime() ?? 0;
      const bTime = b.conversation.lastMessageDate?.getTime() ?? 0;
      return bTime - aTime;
    });

    const deduped = this.mergeDuplicateConversations(prepared);
    const selected = deduped.slice(0, limit);

    return selected.map(({ conversation, last }) => ({
      ...conversation,
      lastMessageSnippet: this.resolveConversationSnippet(last),
    }));
  }

  /**
   * Find a chat by phone number, email, or chat identifier.
   * Uses a single join (chats + last message date), then filters and sorts by date.
   * When multiple chats match (e.g. same number, different threads), returns the one with the most recent message.
   */
  async findChatByHandle(handle: string): Promise<Conversation | null> {
    const chats = this.getAllChatsWithLastDate();

    // Normalize the search handle
    const normalized = handle.replace(/[\s\-()]/g, "").toLowerCase();

    const matches = chats.filter((chat) => {
      const chatNorm = chat.chat_identifier?.replace(/[\s\-()]/g, "").toLowerCase() || "";
      return chatNorm.includes(normalized) || normalized.includes(chatNorm);
    });

    if (matches.length === 0) return null;

    const found = this.pickMostRecentChat(matches);
    const rawIdentifier = found.chat_identifier;
    const isGroup = isGroupGuid(found.guid) || isGroupChatIdentifier(rawIdentifier);
    let displayName = found.display_name;
    if (!displayName && rawIdentifier && !isGroup) {
      const resolved = this.contacts.lookupHandle(rawIdentifier);
      displayName = resolved !== rawIdentifier ? resolved : null;
    }

    const slug = this.getSlugForChatGuid(found.guid) ?? rawIdentifier;
    const chatData = this.slugMap.get(slug);
    const serviceType = chatData ? this.detectServiceForChat(chatData) : "iMessage";

    return {
      chatId: found.guid,
      chatIdentifier: rawIdentifier,
      displayName: displayName || null,
      rawIdentifier,
      participants: isGroup ? this.fetchChatParticipants(found.ROWID) : [rawIdentifier],
      lastMessageDate: null,
      lastMessageSnippet: null,
      unreadCount: 0,
      threadSlug: slug,
      isGroupChat: isGroup,
      serviceType,
    };
  }

  /**
   * Search messages across all conversations.
   *
   * Strategy: search the `text` column via LIKE first (covers most messages).
   * For messages where text is NULL but attributedBody exists, we fetch a larger
   * window and post-filter after parsing the blob.  The upstream imessage-parser
   * had a bug here: its SQL `WHERE text LIKE ? OR attributedBody IS NOT NULL`
   * with a LIMIT meant the LIMIT was consumed by non-matching attributedBody rows,
   * hiding older text matches entirely.
   */
  async searchMessages(query: string, limit: number = 20): Promise<Message[]> {
    // Phase 1: direct text match -- fast and reliable
    const textStmt = this.raw.prepare(`
      SELECT
        m.ROWID, m.guid, m.text, m.attributedBody, m.date,
        m.is_from_me, h.id as handle_id, m.cache_has_attachments,
        c.chat_identifier
      FROM ${Tables.MESSAGE} m
      LEFT JOIN ${Tables.HANDLE} h ON m.handle_id = h.ROWID
      LEFT JOIN ${Tables.CHAT_MESSAGE_JOIN} cmj ON m.ROWID = cmj.message_id
      LEFT JOIN ${Tables.CHAT} c ON cmj.chat_id = c.ROWID
      WHERE m.text LIKE ?
        AND m.associated_message_type = ${AssociatedMessageType.NORMAL}
        AND COALESCE(m.item_type, 0) = 0
      ORDER BY m.date DESC
      LIMIT ?
    `);

    const textRows = textStmt.all(`%${query}%`, limit * 2) as (MessageRow & { chat_identifier: string | null })[];
    const seenIds = new Set<number>();
    const messages: Message[] = [];

    for (const row of textRows) {
      if (!row.chat_identifier) continue;
      seenIds.add(row.ROWID);
      const text = this.parseMessageText(row);
      const ext = this.fetchExtendedMessageData(row.ROWID);
      if (isHiddenSystemItem(ext.item_type)) continue;
      const converted = this.convertMessage(row, text, row.chat_identifier, ext);
      if (converted.isReaction) continue;
      messages.push(converted);
      if (messages.length >= limit) return messages;
    }

    // Phase 2: scan attributedBody-only messages (text IS NULL) for matches
    // Use a generous window so we don't miss older messages
    const blobStmt = this.raw.prepare(`
      SELECT
        m.ROWID, m.guid, m.text, m.attributedBody, m.date,
        m.is_from_me, h.id as handle_id, m.cache_has_attachments,
        c.chat_identifier
      FROM ${Tables.MESSAGE} m
      LEFT JOIN ${Tables.HANDLE} h ON m.handle_id = h.ROWID
      LEFT JOIN ${Tables.CHAT_MESSAGE_JOIN} cmj ON m.ROWID = cmj.message_id
      LEFT JOIN ${Tables.CHAT} c ON cmj.chat_id = c.ROWID
      WHERE m.text IS NULL
        AND m.attributedBody IS NOT NULL
        AND m.associated_message_type = ${AssociatedMessageType.NORMAL}
        AND COALESCE(m.item_type, 0) = 0
      ORDER BY m.date DESC
      LIMIT ?
    `);

    const blobRows = blobStmt.all(limit * 20) as (MessageRow & { chat_identifier: string | null })[];
    const queryLower = query.toLowerCase();

    for (const row of blobRows) {
      if (!row.chat_identifier || seenIds.has(row.ROWID)) continue;
      const text = this.parseMessageText(row);
      if (!text || !text.toLowerCase().includes(queryLower)) continue;
      const ext = this.fetchExtendedMessageData(row.ROWID);
      if (isHiddenSystemItem(ext.item_type)) continue;
      const converted = this.convertMessage(row, text, row.chat_identifier, ext);
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

  private resolveConversationSnippet(last?: LastConversationRow): string | null {
    if (!last) return null;

    const directSnippet = pickConversationSnippet({ rawText: last.snippet });
    if (directSnippet && !this.shouldFallbackToPreviousSnippet(directSnippet, last)) {
      return directSnippet;
    }

    const parsedSnippet = pickConversationSnippet({
      parsedText: this.getMessageTextByRowId(last.lastMessageId),
    });
    if (parsedSnippet && !this.shouldFallbackToPreviousSnippet(parsedSnippet, last)) {
      return parsedSnippet;
    }

    const previousSnippet = this.getPreviousConversationSnippet(last);
    if (previousSnippet) return previousSnippet;

    return pickConversationSnippet({
      summaryText: extractChatSummaryText(last.chatProperties) ?? null,
    });
  }

  private shouldFallbackToPreviousSnippet(snippet: string, last: LastConversationRow): boolean {
    return Boolean(
      last.balloonBundleId?.includes("URLBalloonProvider") && isMetadataOnlySnippet(snippet),
    );
  }

  private getPreviousConversationSnippet(last: LastConversationRow): string | null {
    const rows = this.raw.prepare(`
      SELECT m.ROWID, m.text, m.attributedBody, m.date, m.is_from_me
      FROM ${Tables.MESSAGE} m
      JOIN ${Tables.CHAT_MESSAGE_JOIN} cmj ON cmj.message_id = m.ROWID
      WHERE cmj.chat_id = ?
        AND m.associated_message_type = ${AssociatedMessageType.NORMAL}
        AND COALESCE(m.item_type, 0) = 0
        AND (m.date < ? OR (m.date = ? AND m.ROWID < ?))
      ORDER BY m.date DESC, m.ROWID DESC
      LIMIT 5
    `).all(last.chatId, last.lastDate, last.lastDate, last.lastMessageId) as Array<{
      ROWID: number;
      text: string | null;
      attributedBody: Buffer | null;
      date: number;
      is_from_me: number;
    }>;

    for (const row of rows) {
      if (Boolean(row.is_from_me) !== last.lastIsFromMe) break;
      if (Math.abs(last.lastDate - row.date) > 60_000_000_000) break;

      const snippet = pickConversationSnippet({
        rawText: row.text,
        parsedText: this.extractMessageText(row),
      });

      if (snippet && !isMetadataOnlySnippet(snippet)) {
        return snippet;
      }
    }

    return null;
  }

  private mergeDuplicateConversations(prepared: PreparedConversationEntry[]) {
    const merged: typeof prepared = [];
    const indexByKey = new Map<string, number>();

    for (const entry of prepared) {
      const existingIndex = indexByKey.get(entry.mergeKey);
      if (existingIndex === undefined) {
        indexByKey.set(entry.mergeKey, merged.length);
        merged.push(entry);
        continue;
      }

      merged[existingIndex] = this.mergeConversationEntries(merged[existingIndex], entry);
    }

    return merged;
  }

  private mergeConversationEntries(left: PreparedConversationEntry, right: PreparedConversationEntry) {
    const preferred = this.pickPreferredConversationEntry(left, right);
    const other = preferred === left ? right : left;
    const sameIdentifier = preferred.conversation.chatIdentifier === other.conversation.chatIdentifier;

    return {
      mergeKey: preferred.mergeKey,
      last: preferred.last ?? other.last,
      conversation: {
        ...preferred.conversation,
        displayName: preferred.conversation.displayName ?? other.conversation.displayName,
        participants: [...new Set([...preferred.conversation.participants, ...other.conversation.participants])],
        unreadCount: sameIdentifier
          ? Math.max(preferred.conversation.unreadCount, other.conversation.unreadCount)
          : preferred.conversation.unreadCount + other.conversation.unreadCount,
      },
    };
  }

  private pickPreferredConversationEntry(
    left: PreparedConversationEntry,
    right: PreparedConversationEntry,
  ): PreparedConversationEntry {
    const leftTime = left.conversation.lastMessageDate?.getTime() ?? 0;
    const rightTime = right.conversation.lastMessageDate?.getTime() ?? 0;
    if (leftTime !== rightTime) {
      return leftTime > rightTime ? left : right;
    }

    const preferredService = left.last?.lastService ?? right.last?.lastService ?? null;
    if (preferredService) {
      const preferredType = preferredService.toLowerCase().includes("sms") ? "SMS" : "iMessage";
      if (left.conversation.serviceType === preferredType && right.conversation.serviceType !== preferredType) {
        return left;
      }
      if (right.conversation.serviceType === preferredType && left.conversation.serviceType !== preferredType) {
        return right;
      }
    }

    if (left.conversation.displayName && !right.conversation.displayName) return left;
    if (right.conversation.displayName && !left.conversation.displayName) return right;

    if (left.conversation.serviceType === "iMessage" && right.conversation.serviceType === "SMS") {
      return left;
    }
    if (right.conversation.serviceType === "iMessage" && left.conversation.serviceType === "SMS") {
      return right;
    }

    return left;
  }

  private getConversationMergeKey(chatIdentifier: string, chatGuid: string, isGroup: boolean): string {
    if (isGroup) {
      return `group:${chatGuid}`;
    }

    const contact = this.contacts.lookupContact(chatIdentifier);
    if (contact) {
      return `contact:${contact.contactId}`;
    }

    return `identifier:${chatIdentifier.replace(/[\s\-()]/g, "").toLowerCase()}`;
  }

  private resolveChatsForConversation(identifier: string): ChatRow[] {
    const chats = this.getAllChatsWithLastDate();
    const normalized = identifier.replace(/[\s\-()]/g, "").toLowerCase();

    const directMatches = chats.filter(
      (chat) =>
        chat.chat_identifier === identifier ||
        chat.guid === identifier ||
        (chat.chat_identifier != null &&
          (chat.chat_identifier.replace(/[\s\-()]/g, "").toLowerCase().includes(normalized) ||
            normalized.includes(chat.chat_identifier.replace(/[\s\-()]/g, "").toLowerCase()))),
    );

    if (directMatches.length === 0) return [];

    const representative = this.pickMostRecentChat(directMatches);
    const isGroup = isGroupGuid(representative.guid) || isGroupChatIdentifier(representative.chat_identifier);
    if (isGroup) return [representative];

    const mergeKey = this.getConversationMergeKey(
      representative.chat_identifier,
      representative.guid,
      false,
    );

    return chats
      .filter(
        (chat) =>
          !(isGroupGuid(chat.guid) || isGroupChatIdentifier(chat.chat_identifier)) &&
          this.getConversationMergeKey(chat.chat_identifier, chat.guid, false) === mergeKey,
      )
      .map((chat) => toChatRow(chat));
  }

  /**
   * Get all chats with their last message date in one join query.
   * Used to resolve the correct chat for a contact when multiple chats exist (e.g. same number).
   * Results are suitable for filtering by handle/identifier then sorting by last_date descending.
   */
  private getAllChatsWithLastDate(): ChatWithLastDate[] {
    const stmt = this.raw.prepare(`
      SELECT
        c.ROWID as rowid,
        c.guid,
        c.chat_identifier,
        c.display_name,
        c.service_name,
        (SELECT MAX(m.date)
         FROM ${Tables.CHAT_MESSAGE_JOIN} cmj
         JOIN ${Tables.MESSAGE} m ON cmj.message_id = m.ROWID
         WHERE cmj.chat_id = c.ROWID
           AND m.associated_message_type = ${AssociatedMessageType.NORMAL}
           AND COALESCE(m.item_type, 0) = 0) as last_date
       FROM ${Tables.CHAT} c
     `);
    const rows = stmt.all() as {
      rowid: number;
      guid: string;
      chat_identifier: string;
      display_name: string | null;
      service_name: string | null;
      last_date: number | null;
    }[];
    return rows.map((r) => ({
      ROWID: r.rowid,
      guid: r.guid,
      chat_identifier: r.chat_identifier,
      display_name: r.display_name,
      service_name: r.service_name,
      last_date: r.last_date,
    }));
  }

  /** Get all chats (without last_date subquery -- lighter for listing). */
  private getAllChats(): ChatRow[] {
    const rows = this.raw
      .prepare(
        `SELECT ROWID, guid, chat_identifier, display_name FROM ${Tables.CHAT} ORDER BY ROWID DESC`,
      )
      .all() as ChatRow[];
    return rows;
  }

  /**
   * Fetch message rows for a chat ROWID, ordered by date DESC.
   * Replaces the upstream IMessageDatabase.getMessagesFromChat().
   */
  private fetchMessagesForChatRowId(chatRowId: number, limit: number): MessageRow[] {
    const stmt = this.raw.prepare(`
      SELECT
        m.ROWID, m.guid, m.text, m.attributedBody, m.date,
        m.is_from_me, h.id as handle_id, m.cache_has_attachments
      FROM ${Tables.MESSAGE} m
      LEFT JOIN ${Tables.HANDLE} h ON m.handle_id = h.ROWID
      LEFT JOIN ${Tables.CHAT_MESSAGE_JOIN} cmj ON m.ROWID = cmj.message_id
      WHERE cmj.chat_id = ?
      ORDER BY m.date DESC
      LIMIT ?
    `);
    return stmt.all(chatRowId, limit) as MessageRow[];
  }

  /**
   * Extract readable text from a message row.
   * Prefers the plain text column; falls back to parsing the attributedBody blob.
   * Replaces the upstream IMessageDatabase.parseMessage().
   */
  private parseMessageText(row: MessageRow): string | null {
    if (row.text && !isPlaceholderText(row.text)) return row.text;
    return extractAttributedBodyText(row.attributedBody) || null;
  }

  /**
   * From a list of chats with last_date, return the one with the most recent message (sort by last_date desc).
   */
  private pickMostRecentChat(chats: ChatWithLastDate[]): ChatRow {
    if (chats.length === 0) throw new Error("pickMostRecentChat requires at least one chat");
    if (chats.length === 1) return toChatRow(chats[0]);
    const sorted = chats.slice().sort((a, b) => {
      const aDate = a.last_date ?? 0;
      const bDate = b.last_date ?? 0;
      return bDate - aDate;
    });
    return toChatRow(sorted[0]);
  }

  /**
   * Helper to find chat by identifier.
   * When multiple chats match (e.g. same number in different services), returns the one with the most recent message.
   */
  private findChatByIdentifier(identifier: string): ChatRow | null {
    const chats = this.getAllChatsWithLastDate();
    const matches = chats.filter(
      (c) =>
        c.chat_identifier === identifier ||
        c.guid === identifier ||
        (c.chat_identifier != null &&
          (c.chat_identifier.includes(identifier) || identifier.includes(c.chat_identifier))),
    );
    if (matches.length === 0) return null;
    return this.pickMostRecentChat(matches);
  }

  /**
   * Convert a raw message row to our Message type with full extended data
   */
  private convertMessage(
    raw: MessageRow,
    text: string | null,
    chatId: string,
    extended?: ExtendedMessageData,
    includeReactions: boolean = false,
  ): Message {
    // If no extended data provided, fetch it
    const ext = extended || this.fetchExtendedMessageData(raw.ROWID);

    // Clean up text - handle object replacement characters and other special chars
    let cleanText = text || raw.text || null;
    if (isPlaceholderText(cleanText)) {
      const attributedText = extractAttributedBodyText(raw.attributedBody ?? null) || null;
      if (attributedText) {
        cleanText = attributedText;
      }
    }
    if (cleanText) {
      // U+FFFC is Object Replacement Character (inline attachment placeholder); see db-schema
      // U+FFFD is Replacement Character (invalid UTF-8)
      const re = new RegExp(
        `${OBJECT_REPLACEMENT_CHAR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}+`,
        "g",
      );
      cleanText = cleanText
        .replace(re, "📎 ") // Use paperclip emoji for inline attachments
        .replace(/\uFFFD/g, "")
        .trim();

      // If only attachment markers remain, indicate it's an attachment-only message
      if (!cleanText || cleanText === "📎" || /^(📎\s*)+$/.test(cleanText)) {
        cleanText = "(image/attachment)";
      }

      if (ext.balloon_bundle_id?.includes("URLBalloonProvider")) {
        cleanText = normalizeRichMetadataText(cleanText) ?? cleanText;
      }
    }

    // Determine if this is a reaction (see db-schema.ts and docs)
    const associatedType = ext.associated_message_type ?? AssociatedMessageType.NORMAL;
    const isReaction = isReactionType(associatedType);

    // Parse reaction info
    let reaction: Reaction | undefined;
    if (isReaction && ext.associated_message_guid) {
      const typeInfo = TAPBACK_TYPE_MAP[associatedType] || {
        type: "unknown" as TapbackType,
        isRemoval: false,
      };
      const parsed = parseAssociatedMessageGuid(ext.associated_message_guid);

      reaction = {
        type: typeInfo.type,
        emoji: ext.associated_message_emoji || undefined,
        fromHandle: raw.is_from_me ? "me" : ext.handle_id || "unknown",
        isRemoval: typeInfo.isRemoval,
        targetMessageGuid: parsed?.targetGuid || "",
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

    // Resolve display name from contacts
    const rawHandle = raw.is_from_me ? "me" : ext.handle_id || "unknown";
    const displayName = rawHandle === "me" ? undefined : this.contacts.lookupHandle(rawHandle);

    // Parse rich content summary if available
    let richContentSummary: string | undefined;
    if (ext.message_summary_info) {
      richContentSummary = this.parseRichContentSummary(ext.message_summary_info);
    }

    return {
      id: raw.ROWID,
      guid: raw.guid,
      text: cleanText,
      handle: rawHandle,
      displayName: displayName !== rawHandle ? displayName : undefined,
      isFromMe: Boolean(raw.is_from_me),
      date: macTimestampToDate(raw.date) || new Date(0),
      dateRead: macTimestampToDate(ext.date_read ?? null),
      dateDelivered: macTimestampToDate(ext.date_delivered ?? null),
      isRead: ext.is_read != null ? Boolean(ext.is_read) : true,
      isDelivered: ext.is_delivered != null ? Boolean(ext.is_delivered) : true,
      chatId: chatId,
      service: this.detectServiceForMessage(ext) as "iMessage" | "SMS",
      isReaction,
      reaction,
      isReply,
      replyTo,
      reactions,
      richContentType,
      richContentSummary,
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
   * Detect service from extended message data (handle.service column).
   */
  private detectServiceForMessage(ext: ExtendedMessageData): "iMessage" | "SMS" {
    if (ext.handle_service) {
      return ext.handle_service.toLowerCase().includes("sms") ? "SMS" : "iMessage";
    }
    return "iMessage";
  }

  /**
   * Close database connections
   */
  async close(): Promise<void> {
    this.raw.close();
    this.slugStore.close();
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
        m.is_delivered,
        m.date_delivered,
        h.id as handle_id,
        h.service as handle_service,
        m.associated_message_type,
        m.associated_message_guid,
        m.associated_message_emoji,
        m.thread_originator_guid,
        m.thread_originator_part,
        m.balloon_bundle_id,
        m.item_type,
        m.date_edited,
        m.date_retracted,
        m.cache_has_attachments,
        m.message_summary_info,
        m.payload_data
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
    return rows.map((r) => ({
      filename: r.filename || "",
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

    return rows.map((r) => {
      const typeInfo = TAPBACK_TYPE_MAP[r.associated_message_type] || {
        type: "unknown" as TapbackType,
        isRemoval: false,
      };
      const parsed = parseAssociatedMessageGuid(r.associated_message_guid);

      return {
        type: typeInfo.type,
        emoji: r.associated_message_emoji || undefined,
        fromHandle: r.is_from_me ? "me" : r.handle_id || "unknown",
        isRemoval: typeInfo.isRemoval,
        targetMessageGuid: parsed?.targetGuid || messageGuid,
        targetMessagePart: parsed?.partIndex || 0,
      };
    });
  }

  /**
   * Parse rich content summary from message_summary_info BLOB
   * This contains metadata about link previews, rich messages, etc.
   */
  private parseRichContentSummary(blob: Buffer | null): string | undefined {
    if (!blob) return undefined;

    try {
      // message_summary_info is a binary plist - try to extract text
      const str = blob.toString("utf8");

      // Look for common patterns in the summary
      // Link URLs
      const urlMatch = str.match(/https?:\/\/\S+/);
      if (urlMatch) {
        return `Link: ${urlMatch[0]}`;
      }

      // Title text (often in plists as <string>Title</string>)
      const titleMatch = str.match(/<string>([^<]+)<\/string>/);
      if (titleMatch) {
        return titleMatch[1];
      }

      // For now, just indicate rich content exists
      return "[Rich Content]";
    } catch {
      return undefined;
    }
  }

  /**
   * Look up the text of a message by GUID (for reply context)
   * Falls back to parsing attributedBody if text is null
   */
  private getMessageTextByRowId(rowId: number): string | null {
    const row = this.raw.prepare(`SELECT ROWID, text, attributedBody FROM ${Tables.MESSAGE} WHERE ROWID = ? LIMIT 1`).get(rowId) as
      | { ROWID: number; text: string | null; attributedBody: Buffer | null }
      | undefined;
    return this.extractMessageText(row);
  }

  private getMessageTextByGuid(guid: string): string | null {
    const row = this.raw
      .prepare(`SELECT ROWID, text, attributedBody FROM ${Tables.MESSAGE} WHERE guid = ? LIMIT 1`)
      .get(guid) as
      | { ROWID: number; text: string | null; attributedBody: Buffer | null }
      | undefined;
    return this.extractMessageText(row);
  }

  private extractMessageText(
    row: { ROWID: number; text: string | null; attributedBody: Buffer | null } | undefined,
  ): string | null {
    if (!row) return null;
    if (row.text && !isPlaceholderText(row.text)) return row.text;
    return extractAttributedBodyText(row.attributedBody) || null;
  }
}

/**
 * Extended message data from raw database query
 */
interface ExtendedMessageData {
  is_read?: number;
  date_read?: number;
  is_delivered?: number;
  date_delivered?: number;
  handle_id?: string | null;
  handle_service?: string | null;
  associated_message_type?: number;
  associated_message_guid?: string | null;
  associated_message_emoji?: string | null;
  thread_originator_guid?: string | null;
  thread_originator_part?: string | null;
  balloon_bundle_id?: string | null;
  item_type?: number;
  date_edited?: number;
  date_retracted?: number;
  cache_has_attachments?: number;
  message_summary_info?: Buffer | null;
  payload_data?: Buffer | null;
}
