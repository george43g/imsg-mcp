import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { macTimestampToDate } from "../src/db-schema.js";
import { IMessageDB } from "../src/imessage-db.js";

const FIXTURE_CHAT_DB = "env-data/chat.db";
const FIXTURE_CONTACT_DBS = [
  "env-data/AddressBook/AddressBook-v22.abcddb",
  "env-data/AddressBook/Sources/776498A0-67C1-4BD2-93D1-478DB327E31D/AddressBook-v22.abcddb",
];

function isGitLfsPointer(path: string): boolean {
  try {
    const head = readFileSync(path).subarray(0, 80).toString("utf-8");
    return head.startsWith("version https://git-lfs.github.com/spec/v1");
  } catch {
    return true;
  }
}

describe("contact-based thread merging", () => {
  it("merges Michelle's phone and email chats into one visible conversation", async () => {
    if (
      isGitLfsPointer(FIXTURE_CHAT_DB) ||
      FIXTURE_CONTACT_DBS.some((path) => isGitLfsPointer(path))
    ) {
      return;
    }

    const raw = new Database(FIXTURE_CHAT_DB, { readonly: true });
    const latestDate = raw
      .prepare(`
        SELECT MAX(m.date) as last_date
        FROM chat c
        JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
        JOIN message m ON m.ROWID = cmj.message_id
        WHERE c.chat_identifier IN (?, ?)
          AND m.associated_message_type = 0
          AND COALESCE(m.item_type, 0) = 0
      `)
      .get(
        "+61472685952",
        "michelleirena444@gmail.com",
      ) as { last_date: number | null };
    raw.close();

    const tempDir = mkdtempSync(join(tmpdir(), "imsg-contact-merge-"));
    const slugsPath = join(tempDir, "slugs.db");
    const db = new IMessageDB(FIXTURE_CHAT_DB, FIXTURE_CONTACT_DBS, slugsPath);

    try {
      const conversations = await db.listConversations(200);
      const michelleRows = conversations.filter((conversation) => conversation.displayName === "Michelle");

      expect(michelleRows).toHaveLength(1);
      expect(michelleRows[0]?.participants).toContain("+61472685952");
      expect(michelleRows[0]?.participants).toContain("michelleirena444@gmail.com");

      const lastMessage = (await db.getMessagesForChat("michelleirena444@gmail.com", 1))[0];
      expect(lastMessage?.date.getTime()).toBe(macTimestampToDate(latestDate.last_date)?.getTime());
    } finally {
      await db.close();
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
