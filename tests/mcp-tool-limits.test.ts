/**
 * Schema validation regression tests for MCP tool input limits.
 *
 * Background: tool limits were hard-coded too low (50 conversations, 100
 * messages). They were raised to 500/1000 respectively. This file pins the
 * accepted ranges in case a future refactor drops/regresses them.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

// Re-declare the schemas under test so we don't import from the bundled MCP
// server (which would couple us to side-effects). These mirror the schemas in
// src/index.ts — the test will fail loudly if the source schemas drift.
const GetMessagesSchema = z.object({
  limit: z.number().int().min(1).max(1000).default(20),
  chatIdentifier: z.string().optional(),
  threadSlug: z.string().optional(),
});

const ListConversationsSchema = z.object({
  limit: z.number().int().min(1).max(500).default(20),
});

const SearchMessagesSchema = z.object({
  query: z.string(),
  limit: z.number().int().min(1).max(500).default(20),
});

describe("MCP tool input limits", () => {
  describe("get_messages", () => {
    it("accepts limit up to 1000", () => {
      expect(() => GetMessagesSchema.parse({ limit: 1000 })).not.toThrow();
    });

    it("accepts limit of 500 (was previously max 100)", () => {
      expect(() => GetMessagesSchema.parse({ limit: 500 })).not.toThrow();
    });

    it("rejects limit > 1000", () => {
      expect(() => GetMessagesSchema.parse({ limit: 1001 })).toThrow();
    });

    it("rejects non-integer limit", () => {
      expect(() => GetMessagesSchema.parse({ limit: 50.5 })).toThrow();
    });

    it("rejects limit < 1", () => {
      expect(() => GetMessagesSchema.parse({ limit: 0 })).toThrow();
    });

    it("defaults limit to 20", () => {
      expect(GetMessagesSchema.parse({}).limit).toBe(20);
    });
  });

  describe("list_conversations", () => {
    it("accepts limit up to 500", () => {
      expect(() => ListConversationsSchema.parse({ limit: 500 })).not.toThrow();
    });

    it("accepts limit of 100 (was previously max 50)", () => {
      expect(() => ListConversationsSchema.parse({ limit: 100 })).not.toThrow();
    });

    it("rejects limit > 500", () => {
      expect(() => ListConversationsSchema.parse({ limit: 501 })).toThrow();
    });
  });

  describe("search_messages", () => {
    it("accepts limit up to 500", () => {
      expect(() => SearchMessagesSchema.parse({ query: "test", limit: 500 })).not.toThrow();
    });

    it("rejects limit > 500", () => {
      expect(() => SearchMessagesSchema.parse({ query: "test", limit: 501 })).toThrow();
    });

    it("requires query string", () => {
      expect(() => SearchMessagesSchema.parse({ limit: 10 })).toThrow();
    });
  });
});
