/**
 * SQLite-backed cache for chat_analytics results.
 *
 * Key shape: (type, args_json, max_message_rowid). When chat.db grows past
 * the cached max_message_rowid, the next call falls through to recompute.
 * TTL fallback at 24h catches edge cases (rare hard-delete in chat.db).
 *
 * Path: ~/.imsg-mcp/analytics-cache.db. Standalone from the main DB.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

let dbPath = join(homedir(), ".imsg-mcp", "analytics-cache.db");
let db: Database.Database | null = null;

function open(): Database.Database {
  if (db) return db;
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_cache (
      type TEXT NOT NULL,
      args_hash TEXT NOT NULL,
      max_rowid INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      computed_at INTEGER NOT NULL,
      PRIMARY KEY (type, args_hash)
    );
  `);
  return db;
}

function hashArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, Object.keys(args).sort());
}

/** Override path (tests). */
export function _setCachePathForTests(path: string): void {
  if (db) {
    db.close();
    db = null;
  }
  dbPath = path;
}

export function lookupCache(
  type: string,
  args: Record<string, unknown>,
  maxRowId: number,
): { data: unknown; computedAt: number } | null {
  const conn = open();
  const row = conn
    .prepare(
      `SELECT data_json, max_rowid, computed_at FROM analytics_cache
       WHERE type = ? AND args_hash = ?`,
    )
    .get(type, hashArgs(args)) as
    | { data_json: string; max_rowid: number; computed_at: number }
    | undefined;
  if (!row) return null;
  // Invalidate if the underlying DB has new messages OR the cache is stale.
  if (row.max_rowid !== maxRowId) return null;
  if (Date.now() - row.computed_at > DEFAULT_TTL_MS) return null;
  return { data: JSON.parse(row.data_json), computedAt: row.computed_at };
}

export function storeCache(
  type: string,
  args: Record<string, unknown>,
  maxRowId: number,
  data: unknown,
): void {
  const conn = open();
  conn
    .prepare(
      `INSERT INTO analytics_cache (type, args_hash, max_rowid, data_json, computed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(type, args_hash) DO UPDATE SET
         max_rowid = excluded.max_rowid,
         data_json = excluded.data_json,
         computed_at = excluded.computed_at`,
    )
    .run(type, hashArgs(args), maxRowId, JSON.stringify(data), Date.now());
}

export function closeCache(): void {
  if (db) {
    db.close();
    db = null;
  }
}
