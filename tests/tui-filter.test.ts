/**
 * Filter predicate + first-match index — used by Sidebar (rendering) and
 * App.tsx (Enter-to-navigate). Locks in the Enter-commits-cursor-to-first-match
 * fix surfaced by live TUI audit.
 */
import { describe, expect, it } from "vitest";
import { firstFilterMatchIndex, matchesConversationFilter } from "../src/tui/filter.js";
import type { Conversation } from "../src/types.js";

function conv(overrides: Partial<Conversation>): Conversation {
  return {
    chatIdentifier: "+15555550100",
    displayName: null,
    threadSlug: "abc~imsg~1234",
    lastMessageDate: new Date(0),
    lastMessageSnippet: null,
    unreadCount: 0,
    service: "iMessage",
    isGroup: false,
    chatGuid: "guid1",
    ...overrides,
  };
}

describe("matchesConversationFilter", () => {
  it("matches on displayName (case-insensitive)", () => {
    const c = conv({ displayName: "Brian Osborne" });
    expect(matchesConversationFilter(c, "brian")).toBe(true);
    expect(matchesConversationFilter(c, "BRIAN")).toBe(false); // input must already be lowercased
    expect(matchesConversationFilter(c, "osborne")).toBe(true);
    expect(matchesConversationFilter(c, "nope")).toBe(false);
  });

  it("matches on chatIdentifier substring", () => {
    const c = conv({ chatIdentifier: "+61451544440" });
    expect(matchesConversationFilter(c, "44440")).toBe(true);
    expect(matchesConversationFilter(c, "+61")).toBe(true);
  });

  it("matches on threadSlug substring", () => {
    const c = conv({ threadSlug: "weekend-crew~imsg~d4e5" });
    expect(matchesConversationFilter(c, "weekend")).toBe(true);
    expect(matchesConversationFilter(c, "d4e5")).toBe(true);
  });

  it("returns false when displayName is null and other fields don't match", () => {
    const c = conv({ displayName: null, chatIdentifier: "+15555550100", threadSlug: "foo~bar" });
    expect(matchesConversationFilter(c, "missing")).toBe(false);
  });
});

describe("firstFilterMatchIndex", () => {
  const convs = [
    conv({ displayName: "Aisha", threadSlug: "aisha~imsg~7804" }),
    conv({ displayName: "Brian Osborne", threadSlug: "brian-osborne~imsg~9944" }),
    conv({ displayName: "Mal", threadSlug: "mal~imsg~b03b" }),
  ];

  it("returns the first match index in the ORIGINAL array", () => {
    expect(firstFilterMatchIndex(convs, "brian")).toBe(1);
    expect(firstFilterMatchIndex(convs, "mal")).toBe(2);
  });

  it("returns null when no match", () => {
    expect(firstFilterMatchIndex(convs, "xyz")).toBeNull();
  });

  it("returns null for empty/whitespace query (does not over-match)", () => {
    expect(firstFilterMatchIndex(convs, "")).toBeNull();
    expect(firstFilterMatchIndex(convs, "   ")).toBeNull();
  });

  it("is case-insensitive (trims and lowercases query)", () => {
    expect(firstFilterMatchIndex(convs, "  BRIAN  ")).toBe(1);
  });
});
