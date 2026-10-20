/**
 * SQLite-backed local state: source response cache, OMDb daily budget,
 * and per-item sync records (what we wrote, and Plex's original for restore).
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export type ItemStatus = 'synced' | 'user-owned';

export interface ItemRecord {
  ratingKey: string;
  sectionKey: string;
  type: string;
  title: string;
  /** Plex's GUID when we wrote; a change means the item was rematched. */
  plexGuid: string;
  /** External ID the summary was looked up by, e.g. "tmdb://105". */
  externalId: string;
  source: string;
  writtenSummary: string;
  writtenAt: string;
  /** Plex's summary before our first write, for restore. */
  originalSummary: string;
  originalLocked: boolean;
  status: ItemStatus;
}

interface ItemRow {
  rating_key: string;
  section_key: string;
  type: string;
  title: string;
  plex_guid: string;
  external_id: string;
  source: string;
  written_summary: string;
  written_at: string;
  original_summary: string;
  original_locked: number;
  status: ItemStatus;
}

export class Store {
  private db: Database.Database;

  /** Opens (or creates) the database. Pass ":memory:" for tests. */
  constructor(file: string, private readonly now: () => number = Date.now) {
    if (file !== ':memory:') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS budget (
        source TEXT NOT NULL,
        day TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (source, day)
      );
      CREATE TABLE IF NOT EXISTS items (
        rating_key TEXT PRIMARY KEY,
        section_key TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        plex_guid TEXT NOT NULL,
        external_id TEXT NOT NULL,
        source TEXT NOT NULL,
        written_summary TEXT NOT NULL,
        written_at TEXT NOT NULL,
        original_summary TEXT NOT NULL,
        original_locked INTEGER NOT NULL,
        status TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  // --- cache ---

  /** Returns the cached value, or undefined on a miss or expiry. A cached null means "known not found". */
  cacheGet<T>(key: string): { value: T } | undefined {
    const row = this.db.prepare('SELECT value, expires_at FROM cache WHERE key = ?').get(key) as
      | { value: string; expires_at: number }
      | undefined;
    if (!row || row.expires_at <= this.now()) return undefined;
    return { value: JSON.parse(row.value) as T };
  }

  cacheSet<T>(key: string, value: T, ttlMs: number): void {
    this.db
      .prepare('INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)')
      .run(key, JSON.stringify(value), this.now() + ttlMs);
  }

  cacheSize(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM cache').get() as { n: number }).n;
  }

  // --- daily budget (UTC days) ---

  budgetUsed(source: string): number {
    const row = this.db.prepare('SELECT count FROM budget WHERE source = ? AND day = ?').get(source, this.utcDay()) as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  }

  budgetSpend(source: string): void {
    this.db
      .prepare(
        `INSERT INTO budget (source, day, count) VALUES (?, ?, 1)
         ON CONFLICT (source, day) DO UPDATE SET count = count + 1`
      )
      .run(source, this.utcDay());
  }

  private utcDay(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  // --- item records ---

  getItem(ratingKey: string): ItemRecord | undefined {
    const row = this.db.prepare('SELECT * FROM items WHERE rating_key = ?').get(ratingKey) as ItemRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  allItems(): ItemRecord[] {
    return (this.db.prepare('SELECT * FROM items ORDER BY title').all() as ItemRow[]).map(fromRow);
  }

  saveItem(record: ItemRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO items
          (rating_key, section_key, type, title, plex_guid, external_id, source,
           written_summary, written_at, original_summary, original_locked, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.ratingKey,
        record.sectionKey,
        record.type,
        record.title,
        record.plexGuid,
        record.externalId,
        record.source,
        record.writtenSummary,
        record.writtenAt,
        record.originalSummary,
        record.originalLocked ? 1 : 0,
        record.status
      );
  }

  deleteItem(ratingKey: string): void {
    this.db.prepare('DELETE FROM items WHERE rating_key = ?').run(ratingKey);
  }
}

function fromRow(row: ItemRow): ItemRecord {
  return {
    ratingKey: row.rating_key,
    sectionKey: row.section_key,
    type: row.type,
    title: row.title,
    plexGuid: row.plex_guid,
    externalId: row.external_id,
    source: row.source,
    writtenSummary: row.written_summary,
    writtenAt: row.written_at,
    originalSummary: row.original_summary,
    originalLocked: row.original_locked === 1,
    status: row.status,
  };
}
