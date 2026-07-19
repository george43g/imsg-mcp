/**
 * Filter predicate + first-match index — used by Sidebar (rendering) and
 * App.tsx (Enter-to-navigate). Locks in the Enter-commits-cursor-to-first-match
 * fix surfaced by live TUI audit.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

describe("App.tsx filter-commit loads the matched thread", () => {
  // Regression (found via live TUI audit): committing the filter with Enter
  // dispatched SELECT (moving the cursor → updating the header + chatIdentifier)
  // but never called loadMessages, so the message pane kept showing the
  // PREVIOUSLY-loaded conversation's messages under the newly-selected header —
  // i.e. the wrong thread. Every other selection path loads its thread; this
  // one didn't. Locked structurally (mirrors tui-compose-new-input-guard.test).
  const SRC = readFileSync(resolve(__dirname, "../src/tui/App.tsx"), "utf8");

  it("the Enter/commit branch both selects AND loads the matched conversation", () => {
    const start = SRC.indexOf("firstFilterMatchIndex(state.conversations, state.filterQuery)");
    expect(start, "filter-commit block not found in App.tsx").toBeGreaterThan(-1);
    const end = SRC.indexOf("EXIT_FILTER", start);
    const block = SRC.slice(start, end);
    expect(block, "filter-commit must move the cursor").toMatch(/type:\s*"SELECT"/);
    expect(block, "filter-commit must load the matched thread's messages").toMatch(
      /loadMessages\(\s*matchIdx/,
    );
  });
});
