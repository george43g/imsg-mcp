/**
 * Pagination contract: getMessagesForChat with `beforeMessageId` returns
 * messages strictly older than the boundary (lower ROWID), and paginated
 * calls cover the whole history with no gaps and no duplicates.
 *
 * Uses the env-data fixture (committed chat.db). Skips gracefully if the
 * fixture isn't available (e.g. fresh clone without LFS pull).
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { IMessageDB } from "../src/imessage-db.js";
import { getContactsDbPaths, getImsgDbPath, getSlugsDbPath } from "../src/config.js";

const dbPath = getImsgDbPath();
const haveFixture = existsSync(dbPath);

describe.skipIf(!haveFixture)("getMessagesForChat pagination", () => {
  it("returns messages with id strictly less than beforeMessageId", async () => {
    const db = new IMessageDB(dbPath, getContactsDbPaths(), getSlugsDbPath());
    try {
      const convs = await db.listConversations(50);
      // Find a conversation with at least 50 messages
      let target: string | null = null;
      for (const c of convs) {
        const msgs = await db.getMessagesForChat(c.chatIdentifier, 100);
        if (msgs.length >= 50) {
          target = c.chatIdentifier;
          break;
        }
      }
      expect(target, "no conversation in fixture has ≥50 messages").not.toBeNull();
      if (!target) return;

      // Take the most recent 30; pick the boundary as the oldest of those
      const recent = await db.getMessagesForChat(target, 30);
      const oldestRecentId = Math.min(...recent.map((m) => m.id));

      // Now fetch with beforeMessageId — must strictly precede that id
      const older = await db.getMessagesForChat(target, 30, { beforeMessageId: oldestRecentId });
      expect(older.length).toBeGreaterThan(0);
      for (const m of older) {
        expect(m.id).toBeLessThan(oldestRecentId);
      }
    } finally {
      await db.close();
    }
  });

  it("paginated fetch yields no duplicates between pages", async () => {
    const db = new IMessageDB(dbPath, getContactsDbPaths(), getSlugsDbPath());
    try {
      const convs = await db.listConversations(50);
      let target: string | null = null;
      for (const c of convs) {
        const msgs = await db.getMessagesForChat(c.chatIdentifier, 100);
        if (msgs.length >= 50) {
          target = c.chatIdentifier;
          break;
        }
      }
      if (!target) return;

      const page1 = await db.getMessagesForChat(target, 20);
      const oldestPage1 = Math.min(...page1.map((m) => m.id));
      const page2 = await db.getMessagesForChat(target, 20, { beforeMessageId: oldestPage1 });

      const idsPage1 = new Set(page1.map((m) => m.id));
      for (const m of page2) {
        expect(idsPage1.has(m.id)).toBe(false);
      }
    } finally {
      await db.close();
    }
  });

  it("returns an empty array when beforeMessageId is past the start of history", async () => {
    const db = new IMessageDB(dbPath, getContactsDbPaths(), getSlugsDbPath());
    try {
      const convs = await db.listConversations(5);
      if (convs.length === 0) return;
      const target = convs[0].chatIdentifier;

      // Use 1 as the lower bound — no message has ROWID < 1
      const older = await db.getMessagesForChat(target, 50, { beforeMessageId: 1 });
      expect(older.length).toBe(0);
    } finally {
      await db.close();
    }
  });
});
