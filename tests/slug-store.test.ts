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
      store.upsert({
        slug: "armen-grigorian~imsg~1234",
        chatGuid: "iMessage;-;+61408315498",
        chatIdentifier: "+61408315498",
        displayName: "Armen Grigorian",
        service: "iMessage",
        isGroup: false,
        participants: "+61408315498",
        updatedAt: 1,
      });

      store.upsert({
        slug: "dad~imsg~1234",
        chatGuid: "iMessage;-;+61408315498",
        chatIdentifier: "+61408315498",
        displayName: "Dad",
        service: "iMessage",
        isGroup: false,
        participants: "+61408315498",
        updatedAt: 2,
      });

      expect(store.lookupByGuid("iMessage;-;+61408315498")?.slug).toBe("dad~imsg~1234");
      expect(store.lookupBySlug("armen-grigorian~imsg~1234")).toBeNull();
      expect(store.lookupBySlug("dad~imsg~1234")?.displayName).toBe("Dad");
    } finally {
      store.close();
    }
  });
});
