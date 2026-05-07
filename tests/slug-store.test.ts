import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SlugStore } from "../src/slug-store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function makeStore(): SlugStore {
  const dir = mkdtempSync(join(tmpdir(), "imsg-slug-store-"));
  tempDirs.push(dir);
  return new SlugStore(join(dir, "slugs.db"));
}

describe("SlugStore", () => {
  it("updates an existing chat guid when the slug changes", () => {
    const store = makeStore();

    try {
      // Synthetic data using fictional reserved phone (+1-555-01xx).
      // Same chatGuid keyed by both rows simulates a contact whose display
      // name changed (e.g. firstname → nickname after Address Book sync).
      const PHONE = "+15550000088";
      const GUID = `iMessage;-;${PHONE}`;

      store.upsert({
        slug: "alex-example~imsg~1234",
        chatGuid: GUID,
        chatIdentifier: PHONE,
        displayName: "Alex Example",
        service: "iMessage",
        isGroup: false,
        participants: PHONE,
        updatedAt: 1,
      });

      store.upsert({
        slug: "alexnick~imsg~1234",
        chatGuid: GUID,
        chatIdentifier: PHONE,
        displayName: "AlexNick",
        service: "iMessage",
        isGroup: false,
        participants: PHONE,
        updatedAt: 2,
      });

      expect(store.lookupByGuid(GUID)?.slug).toBe("alexnick~imsg~1234");
      expect(store.lookupBySlug("alex-example~imsg~1234")).toBeNull();
      expect(store.lookupBySlug("alexnick~imsg~1234")?.displayName).toBe("AlexNick");
    } finally {
      store.close();
    }
  });
});
