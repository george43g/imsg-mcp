/**
 * Persistent SQLite store for conversation thread slugs.
 * Stores slug-to-chat mappings at ~/.imsg-mcp/slugs.db so they survive
 * MCP server restarts and can be referenced by agents/scripts.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

export interface SlugRecord {
  slug: string;
  chatGuid: string;
  chatIdentifier: string;
  displayName: string | null;
  service: string;
  isGroup: boolean;
  participants: string;
  updatedAt: number;
}

const DEFAULT_DIR = join(homedir(), '.imsg-mcp');
const DEFAULT_DB = join(DEFAULT_DIR, 'slugs.db');

export class SlugStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? DEFAULT_DB;
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_slugs (
        slug            TEXT PRIMARY KEY,
        chat_guid       TEXT UNIQUE NOT NULL,
        chat_identifier TEXT NOT NULL,
        display_name    TEXT,
        service         TEXT NOT NULL DEFAULT 'iMessage',
        is_group        INTEGER NOT NULL DEFAULT 0,
        participants    TEXT NOT NULL DEFAULT '',
        updated_at      INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  upsert(record: SlugRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO thread_slugs (slug, chat_guid, chat_identifier, display_name, service, is_group, participants, updated_at)
      VALUES (@slug, @chatGuid, @chatIdentifier, @displayName, @service, @isGroup, @participants, @updatedAt)
      ON CONFLICT(slug) DO UPDATE SET
        chat_guid = excluded.chat_guid,
        chat_identifier = excluded.chat_identifier,
        display_name = excluded.display_name,
        service = excluded.service,
        is_group = excluded.is_group,
        participants = excluded.participants,
        updated_at = excluded.updated_at
    `);
    stmt.run({
      slug: record.slug,
      chatGuid: record.chatGuid,
      chatIdentifier: record.chatIdentifier,
      displayName: record.displayName,
      service: record.service,
      isGroup: record.isGroup ? 1 : 0,
      participants: record.participants,
      updatedAt: record.updatedAt,
    });
  }

  upsertMany(records: SlugRecord[]): void {
    const tx = this.db.transaction((recs: SlugRecord[]) => {
      for (const r of recs) this.upsert(r);
    });
    tx(records);
  }

  lookupBySlug(slug: string): SlugRecord | null {
    const row = this.db.prepare('SELECT * FROM thread_slugs WHERE slug = ?').get(slug) as any;
    return row ? this.rowToRecord(row) : null;
  }

  lookupByGuid(chatGuid: string): SlugRecord | null {
    const row = this.db.prepare('SELECT * FROM thread_slugs WHERE chat_guid = ?').get(chatGuid) as any;
    return row ? this.rowToRecord(row) : null;
  }

  lookupByChatIdentifier(chatIdentifier: string): SlugRecord | null {
    const row = this.db.prepare('SELECT * FROM thread_slugs WHERE chat_identifier = ?').get(chatIdentifier) as any;
    return row ? this.rowToRecord(row) : null;
  }

  all(): SlugRecord[] {
    const rows = this.db.prepare('SELECT * FROM thread_slugs ORDER BY updated_at DESC').all() as any[];
    return rows.map(r => this.rowToRecord(r));
  }

  /** Remove slugs whose chat_guid is not in the given set of valid guids. */
  prune(validGuids: Set<string>): number {
    const all = this.db.prepare('SELECT slug, chat_guid FROM thread_slugs').all() as { slug: string; chat_guid: string }[];
    const toDelete = all.filter(r => !validGuids.has(r.chat_guid));
    if (toDelete.length === 0) return 0;
    const del = this.db.prepare('DELETE FROM thread_slugs WHERE slug = ?');
    const tx = this.db.transaction((slugs: string[]) => {
      for (const s of slugs) del.run(s);
    });
    tx(toDelete.map(r => r.slug));
    return toDelete.length;
  }

  close(): void {
    this.db.close();
  }

  private rowToRecord(row: any): SlugRecord {
    return {
      slug: row.slug,
      chatGuid: row.chat_guid,
      chatIdentifier: row.chat_identifier,
      displayName: row.display_name,
      service: row.service,
      isGroup: Boolean(row.is_group),
      participants: row.participants,
      updatedAt: row.updated_at,
    };
  }
}
