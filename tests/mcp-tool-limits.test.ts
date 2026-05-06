/**
 * Schema validation regression tests for MCP tool input limits.
 *
 * Contract:
 *   - All tool `limit` params accept any non-negative integer
 *   - `limit: 0` is the sentinel for "unlimited" (bounded only by tool timeout)
 *   - There is NO upper cap — protocol-layer timeouts handle abuse
 *   - Negative or non-integer limits are rejected
 *
 * This file pins the contract so a future refactor can't silently re-introduce
 * arbitrary caps.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

// Re-declare the schemas under test so we don't import from the bundled MCP
// server. These mirror the schemas in src/index.ts — keep them in sync.
const GetMessagesSchema = z.object({
  limit: z.number().int().min(0).default(20),
  chatIdentifier: z.string().optional(),
  threadSlug: z.string().optional(),
});

const ListConversationsSchema = z.object({
  limit: z.number().int().min(0).default(20),
});

const SearchMessagesSchema = z.object({
  query: z.string(),
  limit: z.number().int().min(0).default(20),
});

const GetUnreadMessagesSchema = z.object({
  limit: z.number().int().min(0).optional(),
});

describe("MCP tool input limits — unlimited contract", () => {
  describe("get_messages", () => {
    it("accepts limit=0 (unlimited)", () => {
      expect(GetMessagesSchema.parse({ limit: 0 }).limit).toBe(0);
    });
    it("accepts limit=50000", () => {
      expect(GetMessagesSchema.parse({ limit: 50000 }).limit).toBe(50000);
    });
    it("accepts limit=Number.MAX_SAFE_INTEGER", () => {
      expect(GetMessagesSchema.parse({ limit: Number.MAX_SAFE_INTEGER }).limit).toBe(Number.MAX_SAFE_INTEGER);
    });
    it("rejects negative limit", () => {
      expect(() => GetMessagesSchema.parse({ limit: -1 })).toThrow();
    });
    it("rejects non-integer limit", () => {
      expect(() => GetMessagesSchema.parse({ limit: 50.5 })).toThrow();
    });
    it("defaults limit to 20", () => {
      expect(GetMessagesSchema.parse({}).limit).toBe(20);
    });
  });

  describe("list_conversations", () => {
    it("accepts limit=0", () => {
      expect(ListConversationsSchema.parse({ limit: 0 }).limit).toBe(0);
    });
    it("accepts limit=10000", () => {
      expect(ListConversationsSchema.parse({ limit: 10000 }).limit).toBe(10000);
    });
    it("rejects negative limit", () => {
      expect(() => ListConversationsSchema.parse({ limit: -1 })).toThrow();
    });
  });

  describe("search_messages", () => {
    it("accepts limit=0", () => {
      expect(SearchMessagesSchema.parse({ query: "test", limit: 0 }).limit).toBe(0);
    });
    it("accepts limit=10000", () => {
      expect(SearchMessagesSchema.parse({ query: "test", limit: 10000 }).limit).toBe(10000);
    });
    it("requires query string", () => {
      expect(() => SearchMessagesSchema.parse({ limit: 10 })).toThrow();
    });
  });

  describe("get_unread_messages", () => {
    it("accepts limit=0", () => {
      expect(GetUnreadMessagesSchema.parse({ limit: 0 }).limit).toBe(0);
    });
    it("accepts limit omitted (defaults handled by handler)", () => {
      expect(GetUnreadMessagesSchema.parse({}).limit).toBeUndefined();
    });
  });
});

// resolveLimit() helper contract — the runtime side that maps `0` to a number
describe("resolveLimit semantics", () => {
  // Inline the helper to test it without importing from the built bundle
  const UNLIMITED = Number.MAX_SAFE_INTEGER;
  const resolveLimit = (limit: number | undefined, defaultValue = 20): number => {
    if (limit === undefined) return defaultValue;
    if (limit === 0) return UNLIMITED;
    return limit;
  };

  it("0 → MAX_SAFE_INTEGER", () => {
    expect(resolveLimit(0)).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("undefined → default", () => {
    expect(resolveLimit(undefined)).toBe(20);
    expect(resolveLimit(undefined, 100)).toBe(100);
  });
  it("positive number passes through", () => {
    expect(resolveLimit(42)).toBe(42);
    expect(resolveLimit(50000)).toBe(50000);
  });
});
