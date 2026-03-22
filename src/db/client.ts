// src/db/client.ts
// ANTI-DRIFT NOTE: better-sqlite3 is SYNCHRONOUS. There is no async/await.
// Database.prepare() returns a Statement. Statement.run(), .get(), .all() are sync.
// Do NOT add async/await to any better-sqlite3 call.
// Reference: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_SQL } from './schema.js';

let _db: Database.Database | null = null;

export function getDb(projectRoot: string): Database.Database {
  if (_db) return _db;

  const dir = join(projectRoot, '.context-fabric');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const dbPath = join(dir, 'cf.db');
  _db = new Database(dbPath);

  // Execute schema — idempotent due to IF NOT EXISTS
  _db.exec(SCHEMA_SQL);

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
