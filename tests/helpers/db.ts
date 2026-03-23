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
    comp_type?:   string;
    git_sha?:     string;
    token_est?:   number;
  },
): void {
  db.prepare(`
    INSERT OR REPLACE INTO cf_components
      (path, sha256, exports, file_summary, comp_type, captured_at, git_sha, token_est)
    VALUES
      (@path, @sha256, @exports, @file_summary, @comp_type, @captured_at, @git_sha, @token_est)
  `).run({
    path:         data.path,
    sha256:       data.sha256,
    exports:      data.exports   ?? null,
    file_summary: data.file_summary ?? null,
    comp_type:    data.comp_type ?? 'file',
    captured_at:  Date.now(),
    git_sha:      data.git_sha   ?? 'test-sha',
    token_est:    data.token_est ?? 100,
  });
}
