// src/db/search-index.ts

import type Database from 'better-sqlite3';
import { SEARCH_INDEX_VERSION } from './schema.js';

interface SearchDocument {
  id: number;
  path: string;
  exports: string | null;
  file_summary: string | null;
  outline: string | null;
  status: 'active' | 'tombstoned';
}

function setIndexVersion(db: Database.Database): void {
  db.prepare(`
    INSERT INTO cf_meta (key, value, updated_at)
    VALUES ('search_index_version', @value, @updated_at)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run({
    value: String(SEARCH_INDEX_VERSION),
    updated_at: Date.now(),
  });
}

export function rebuildSearchIndex(db: Database.Database): void {
  const rows = db.prepare(`
    SELECT id, path, exports, file_summary, outline, status
    FROM cf_components
    WHERE status = 'active'
    ORDER BY id ASC
  `).all() as SearchDocument[];

  const reset = db.prepare('DELETE FROM cf_search_v2');
  const insert = db.prepare(`
    INSERT INTO cf_search_v2 (rowid, path, exports, file_summary, outline)
    VALUES (@id, @path, @exports, @file_summary, @outline)
  `);

  db.transaction(() => {
    reset.run();
    for (const row of rows) {
      insert.run({
        id: row.id,
        path: row.path,
        exports: row.exports,
        file_summary: row.file_summary,
        outline: row.outline,
      });
    }
    setIndexVersion(db);
  })();
}

export function syncSearchDocument(
  db: Database.Database,
  doc: SearchDocument,
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM cf_search_v2 WHERE rowid = ?').run(doc.id);
    if (doc.status === 'active') {
      db.prepare(`
        INSERT INTO cf_search_v2 (rowid, path, exports, file_summary, outline)
        VALUES (@id, @path, @exports, @file_summary, @outline)
      `).run({
        id: doc.id,
        path: doc.path,
        exports: doc.exports,
        file_summary: doc.file_summary,
        outline: doc.outline,
      });
    }
    setIndexVersion(db);
  })();
}

export function removeSearchDocument(
  db: Database.Database,
  id: number,
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM cf_search_v2 WHERE rowid = ?').run(id);
    setIndexVersion(db);
  })();
}
