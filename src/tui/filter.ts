/**
 * Shared conversation-filter predicate. Used by Sidebar (rendering) and
 * App.tsx (Enter-to-jump-to-first-match handler).
 */
import type { Conversation } from "../types.js";

export function matchesConversationFilter(c: Conversation, queryLower: string): boolean {
  return (
    (c.displayName?.toLowerCase().includes(queryLower) ?? false) ||
    c.chatIdentifier.toLowerCase().includes(queryLower) ||
    c.threadSlug.toLowerCase().includes(queryLower)
  );
}

/**
 * Return the index of the first conversation matching `query` in the full
 * conversations array, or null if no match. Index is a position into the
 * ORIGINAL conversations array — not the filtered view — so it can be passed
 * to a SELECT action directly.
 */
export function firstFilterMatchIndex(conversations: Conversation[], query: string): number | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const q = trimmed.toLowerCase();
  for (let i = 0; i < conversations.length; i++) {
    if (matchesConversationFilter(conversations[i]!, q)) return i;
  }
  return null;
}
