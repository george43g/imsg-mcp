import { useCallback, useRef } from "react";
import { sendMessageAlt, sendToChat, sendToChatId } from "../../applescript.js";
import { getContactsDbPaths, getImsgDbPath, getSlugsDbPath } from "../../config.js";
import { IMessageDB } from "../../imessage-db.js";
import type { Conversation, Message } from "../../types.js";

export function useImsg() {
  const dbRef = useRef<IMessageDB | null>(null);

  const getDb = useCallback(() => {
    if (!dbRef.current) {
      dbRef.current = new IMessageDB(getImsgDbPath(), getContactsDbPaths(), getSlugsDbPath());
    }
    return dbRef.current;
  }, []);

  const loadConversations = useCallback(async (): Promise<Conversation[]> => {
    return getDb().listConversations(200);
  }, [getDb]);

  const loadMessages = useCallback(async (chatIdentifier: string): Promise<Message[]> => {
    return getDb().getMessagesForChat(chatIdentifier, 200, { includeReactionDetails: true });
  }, [getDb]);

  const resolveNames = useCallback((handles: string[]): string[] => {
    return getDb().resolveParticipantNames(handles);
  }, [getDb]);

  const send = useCallback(async (threadSlug: string, text: string): Promise<{ success: boolean; error?: string }> => {
    const db = getDb();
    const slugRecord = db.getSlugRecord(threadSlug);
    if (!slugRecord) return { success: false, error: `Unknown slug: ${threadSlug}` };

    if (slugRecord.isGroup) {
      return slugRecord.displayName && !slugRecord.displayName.startsWith("chat")
        ? sendToChat(slugRecord.displayName, text)
        : sendToChatId(slugRecord.chatGuid, text);
    }
    return sendMessageAlt(slugRecord.chatIdentifier, text);
  }, [getDb]);

  const refresh = useCallback(() => {
    getDb().scheduleBackgroundRefresh();
  }, [getDb]);

  const close = useCallback(async () => {
    if (dbRef.current) {
      await dbRef.current.close();
      dbRef.current = null;
    }
  }, []);

  return { loadConversations, loadMessages, resolveNames, send, refresh, close };
}
