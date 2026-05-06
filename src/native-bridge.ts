/**
 * Native bridge — tries to load the Rust native module for accelerated
 * SQLite queries and blob parsing. Falls back to the TypeScript implementation
 * if the native module is unavailable.
 */

import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface NativeModule {
  listConversations(
    dbPath: string,
    contactsMainPath: string,
    contactsSourcesDir: string | null,
    slugsDbPath: string,
    limit?: number | null,
  ): Promise<NativeConversation[]>;

  getMessages(
    dbPath: string,
    chatIdentifier: string,
    limit?: number | null,
    includeReactionDetails?: boolean | null,
  ): Promise<NativeMessage[]>;

  parseAttributedBody(blob: Buffer): string | null;

  resolveContacts(
    contactsMainPath: string,
    contactsSourcesDir: string | null,
    handles: string[],
  ): Promise<Record<string, string>>;
}

export interface NativeConversation {
  chatId: string;
  chatIdentifier: string;
  displayName?: string;
  rawIdentifier: string;
  participants: string[];
  lastMessageDate?: number;
  lastMessageSnippet?: string;
  unreadCount: number;
  threadSlug: string;
  isGroupChat: boolean;
  serviceType: string;
}

export interface NativeMessage {
  id: number;
  guid: string;
  text?: string;
  handle: string;
  displayName?: string;
  isFromMe: boolean;
  date: number;
  dateRead?: number;
  dateDelivered?: number;
  isRead: boolean;
  isDelivered: boolean;
  chatId: string;
  service: string;
  isReaction: boolean;
  isReply: boolean;
  replyToText?: string;
  replyToGuid?: string;
  hasAttachments: boolean;
}

let _native: NativeModule | null | undefined;

/**
 * Try to load the native module. Returns null if unavailable.
 * Result is cached after first attempt.
 */
export function tryLoadNative(): NativeModule | null {
  if (_native !== undefined) return _native;

  try {
    const require = createRequire(import.meta.url);
    // Try loading from the native/ directory relative to dist/
    const nativePath = join(__dirname, "..", "native", "index.js");
    _native = require(nativePath) as NativeModule;
    return _native;
  } catch {
    // Native module not available — fall back to TS
    _native = null;
    return null;
  }
}

/**
 * Check if the native module is available.
 */
export function hasNativeModule(): boolean {
  return tryLoadNative() !== null;
}
