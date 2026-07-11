import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IMessageMCPServer } from "../src/index.js";

/**
 * Pagination contract for list_conversations: the per-call cap is a page size,
 * and `offset` + `nextOffset` must let a caller tile the full list with no
 * overlaps or gaps. Regression guard for the old behaviour where the tool
 * returned `hasMore: true` with `nextOffset: null` — a dead end that stranded
 * every conversation past the cap.
 */
describe("list_conversations pagination", () => {
  let server: any;

  beforeAll(() => {
    process.env.IMSG_DEV = "1";
    server = new IMessageMCPServer();
  });

  afterAll(async () => {
    delete process.env.IMSG_DEV;
    await server.db?.close();
  });

  const slugsOf = (res: any): string[] =>
    (res?.structuredContent?.conversations ?? []).map((c: any) => c.threadSlug);

  it("tiles pages with offset/nextOffset — no overlap, no gaps", async () => {
    const baseline = await server.handleListConversations({ limit: 6, offset: 0 });
    const baseSlugs = slugsOf(baseline);
    // Needs a fixture with enough conversations to page; skip otherwise.
    if (baseSlugs.length < 6) return;

    const page0 = await server.handleListConversations({ limit: 2, offset: 0 });
    const page1 = await server.handleListConversations({ limit: 2, offset: 2 });
    const page2 = await server.handleListConversations({ limit: 2, offset: 4 });

    // Each early page reports the next window and is non-empty.
    expect(page0.structuredContent.hasMore).toBe(true);
    expect(page0.structuredContent.nextOffset).toBe(2);
    expect(page1.structuredContent.nextOffset).toBe(4);

    const tiled = [...slugsOf(page0), ...slugsOf(page1), ...slugsOf(page2)];
    // Three 2-wide pages reconstruct the first 6 of the single-call baseline...
    expect(tiled).toEqual(baseSlugs);
    // ...with no conversation appearing on two pages.
    expect(new Set(tiled).size).toBe(tiled.length);
  });

  it("returns an empty, terminal page when offset runs past the end", async () => {
    const res = await server.handleListConversations({ limit: 5, offset: 1_000_000 });
    expect(res.structuredContent.count).toBe(0);
    expect(res.structuredContent.hasMore).toBe(false);
    expect(res.structuredContent.nextOffset).toBeNull();
  });
});
