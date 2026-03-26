// tests/helpers/db.ts
// Creates a fresh in-memory SQLite database with the full CADRE schema applied.
// Used by every test file. Each test gets an independent database.
//
// VERIFIED: new Database(':memory:') is official SQLite API.
//   Source: sqlite.org/inmemorydb.html
//   "No disk file is opened. A new database is created purely in memory.
//    The database ceases to exist as soon as the database connection is closed."
//
// ANTI-DRIFT: better-sqlite3 is SYNCHRONOUS. No async/await on any db call.

import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/db/schema.js';

export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
}

export function seedComponent(
  db:   Database.Database,
  data: {
    path:         string;
    sha256:       string;
    exports?:     string;
    file_summary?: string;
    outline?:     string;
    comp_type?:   string;
    git_sha?:     string;
    token_est?:   number;
    status?:      'active' | 'tombstoned';
    skipped_reason?: string | null;
    last_capture_id?: number | null;
  },
): void {
  db.prepare(`
    INSERT OR REPLACE INTO cf_components
      (path, sha256, exports, file_summary, outline, comp_type, status,
       tombstoned_at, skipped_reason, captured_at, git_sha, token_est, last_capture_id)
    VALUES
      (@path, @sha256, @exports, @file_summary, @outline, @comp_type, @status,
       NULL, @skipped_reason, @captured_at, @git_sha, @token_est, @last_capture_id)
  `).run({
    path:         data.path,
    sha256:       data.sha256,
    exports:      data.exports   ?? null,
    file_summary: data.file_summary ?? null,
    outline:      data.outline ?? null,
    comp_type:    data.comp_type ?? 'file',
    status:       data.status ?? 'active',
    skipped_reason: data.skipped_reason ?? null,
    captured_at:  Date.now(),
    git_sha:      data.git_sha   ?? 'test-sha',
    token_est:    data.token_est ?? 100,
    last_capture_id: data.last_capture_id ?? null,
  });

  const row = db.prepare(`
    SELECT id, path, exports, file_summary, outline, status
    FROM cf_components
    WHERE path = ?
    LIMIT 1
  `).get(data.path) as {
    id: number;
    path: string;
    exports: string | null;
    file_summary: string | null;
    outline: string | null;
    status: 'active' | 'tombstoned';
  } | undefined;

  if (!row) return;

  db.prepare('DELETE FROM cf_search_v2 WHERE rowid = ?').run(row.id);
  if (row.status === 'active') {
    db.prepare(`
      INSERT INTO cf_search_v2 (rowid, path, exports, file_summary, outline)
      VALUES (@rowid, @path, @exports, @file_summary, @outline)
    `).run({
      rowid: row.id,
      path: row.path,
      exports: row.exports,
      file_summary: row.file_summary,
      outline: row.outline,
    });
  }
}
