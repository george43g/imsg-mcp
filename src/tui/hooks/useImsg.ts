import { useCallback, useRef } from "react";
import { sendMessageAlt, sendToChat, sendToChatId } from "../../applescript.js";
import { getContactsDbPaths, getImsgDbPath, getSlugsDbPath } from "../../config.js";
import { IMessageDB } from "../../imessage-db.js";
import type { Conversation, Message } from "../../types.js";
import { getCached, isFresh, prependCached, setCached } from "../messageCache.js";

export function useImsg() {
  const dbRef = useRef<IMessageDB | null>(null);

  const getDb = useCallback(() => {
    if (!dbRef.current) {
      dbRef.current = new IMessageDB(getImsgDbPath(), getContactsDbPaths(), getSlugsDbPath());
    }
    return dbRef.current;
  }, []);

  const loadConversations = useCallback(
    async (limit = 200): Promise<Conversation[]> => {
      return getDb().listConversations(limit);
    },
    [getDb],
  );

  const loadMessages = useCallback(
    async (chatIdentifier: string): Promise<Message[]> => {
      // Read-through cache: return fresh entries directly without hitting the DB.
      const cached = getCached(chatIdentifier);
      if (cached && isFresh(cached)) return cached.messages;

      const messages = await getDb().getMessagesForChat(chatIdentifier, 200, {
        includeReactionDetails: true,
      });
      const oldestId = messages.length > 0 ? Math.min(...messages.map((m) => m.id)) : 0;
      setCached(chatIdentifier, messages, oldestId);
      return messages;
    },
    [getDb],
  );

  const loadOlderMessages = useCallback(
    async (chatIdentifier: string, beforeMessageId: number): Promise<Message[]> => {
      const older = await getDb().getMessagesForChat(chatIdentifier, 100, {
        includeReactionDetails: true,
        beforeMessageId,
      });
      // Merge into cache so subsequent re-entries see the full loaded history.
      if (older.length > 0) prependCached(chatIdentifier, older);
      return older;
    },
    [getDb],
  );

  const resolveNames = useCallback(
    (handles: string[]): string[] => {
      return getDb().resolveParticipantNames(handles);
    },
    [getDb],
  );

  const send = useCallback(
    async (threadSlug: string, text: string): Promise<{ success: boolean; error?: string }> => {
      const db = getDb();
      const slugRecord = db.getSlugRecord(threadSlug);
      if (!slugRecord) return { success: false, error: `Unknown slug: ${threadSlug}` };

      if (slugRecord.isGroup) {
        return slugRecord.displayName && !slugRecord.displayName.startsWith("chat")
          ? sendToChat(slugRecord.displayName, text)
          : sendToChatId(slugRecord.chatGuid, text);
      }
      return sendMessageAlt(slugRecord.chatIdentifier, text);
    },
    [getDb],
  );

  const refresh = useCallback(() => {
    getDb().scheduleBackgroundRefresh();
  }, [getDb]);

  const close = useCallback(async () => {
    if (dbRef.current) {
      await dbRef.current.close();
      dbRef.current = null;
    }
  }, []);

  return { loadConversations, loadMessages, loadOlderMessages, resolveNames, send, refresh, close };
}
