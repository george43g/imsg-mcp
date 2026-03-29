import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getContactsDbPaths, getImsgDbPath, getSlugsDbPath } from "../src/config.js";
import { ContactsDB } from "../src/contacts-db.js";
import { IMessageDB } from "../src/imessage-db.js";

function isGitLfsPointer(path: string): boolean {
  try {
    const head = readFileSync(path).subarray(0, 80).toString("utf-8");
    return head.startsWith("version https://git-lfs.github.com/spec/v1");
  } catch {
    return true;
  }
}

describe("Contacts + iMessage integration (smoke)", () => {
  it("loads contacts stats when Address Book DB is present and not an LFS pointer", () => {
    const paths = getContactsDbPaths();
    const first = paths?.[0];
    if (!first || isGitLfsPointer(first)) {
      return;
    }

    const contacts = new ContactsDB(paths);
    contacts.initialize();
    try {
      const stats = contacts.getStats();
      expect(stats.totalContacts).toBeGreaterThanOrEqual(0);
      expect(stats.phoneNumbers).toBeGreaterThanOrEqual(0);
      expect(stats.emails).toBeGreaterThanOrEqual(0);
    } finally {
      contacts.close();
    }
  });

  it("lists conversations when chat.db is present and not an LFS pointer", async () => {
    const chatPath = getImsgDbPath();
    if (isGitLfsPointer(chatPath)) {
      return;
    }

    const paths = getContactsDbPaths();
    const imsg = new IMessageDB(chatPath, paths ?? undefined, getSlugsDbPath());
    try {
      const convs = await imsg.listConversations();
      expect(Array.isArray(convs)).toBe(true);
      if (convs.length > 0) {
        const c = convs[0];
        expect(c).toHaveProperty("chatIdentifier");
        expect(c).toHaveProperty("threadSlug");
      }
    } finally {
      await imsg.close();
    }
  });
});
