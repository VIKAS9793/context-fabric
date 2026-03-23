// src/db/schema.ts
// ANTI-DRIFT NOTE: This SQL is verified against SQLite FTS5 documentation.
// DO NOT modify the FTS5 trigger syntax. The content= and content_rowid=
// parameters are required for external-content FTS5 tables.
// Reference: https://www.sqlite.org/fts5.html#external_content_tables

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cf_components (
  id           INTEGER PRIMARY KEY,
  path         TEXT    NOT NULL UNIQUE,
  sha256       TEXT    NOT NULL,
  exports      TEXT,
  file_summary TEXT,                       -- extracted from @fileoverview JSDoc
  comp_type    TEXT    NOT NULL DEFAULT 'file',
  captured_at  INTEGER NOT NULL,
  git_sha      TEXT    NOT NULL,
  token_est    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cf_decisions (
  id           INTEGER PRIMARY KEY,
  title        TEXT    NOT NULL,
  rationale    TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'active',
  captured_at  INTEGER NOT NULL,
  tags         TEXT
);

CREATE TABLE IF NOT EXISTS cf_snapshots (
  id           INTEGER PRIMARY KEY,
  git_sha      TEXT    NOT NULL UNIQUE,
  summary      TEXT    NOT NULL,
  captured_at  INTEGER NOT NULL,
  token_est    INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS cf_search USING fts5(
  path,
  exports,
  content      = 'cf_components',
  content_rowid = 'id',
  tokenize     = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS cf_ai AFTER INSERT ON cf_components BEGIN
  INSERT INTO cf_search(rowid, path, exports)
  VALUES (new.id, new.path, new.exports);
END;

CREATE TRIGGER IF NOT EXISTS cf_au AFTER UPDATE ON cf_components BEGIN
  INSERT INTO cf_search(cf_search, rowid, path, exports)
  VALUES ('delete', old.id, old.path, old.exports);
  INSERT INTO cf_search(rowid, path, exports)
  VALUES (new.id, new.path, new.exports);
END;

CREATE TRIGGER IF NOT EXISTS cf_ad AFTER DELETE ON cf_components BEGIN
  INSERT INTO cf_search(cf_search, rowid, path, exports)
  VALUES ('delete', old.id, old.path, old.exports);
END;
`;
