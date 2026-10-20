/**
 * SQLite-backed local state: source response cache and the OMDb daily budget.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

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
}
