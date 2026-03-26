// src/db/schema.ts

export const CURRENT_SCHEMA_VERSION = 2;
export const SEARCH_INDEX_VERSION = 2;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cf_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cf_capture_runs (
  id             INTEGER PRIMARY KEY,
  git_sha        TEXT    NOT NULL,
  status         TEXT    NOT NULL,
  mode           TEXT    NOT NULL,
  started_at     INTEGER NOT NULL,
  completed_at   INTEGER,
  changed_files  INTEGER NOT NULL DEFAULT 0,
  indexed_files  INTEGER NOT NULL DEFAULT 0,
  indexed_bytes  INTEGER NOT NULL DEFAULT 0,
  skipped_count  INTEGER NOT NULL DEFAULT 0,
  skipped_summary TEXT,
  error_message  TEXT
);

CREATE TABLE IF NOT EXISTS cf_components (
  id           INTEGER PRIMARY KEY,
  path         TEXT    NOT NULL UNIQUE,
  sha256       TEXT    NOT NULL,
  exports      TEXT,
  file_summary TEXT,                       -- extracted from @fileoverview JSDoc
  outline      TEXT,
  comp_type    TEXT    NOT NULL DEFAULT 'file',
  status       TEXT    NOT NULL DEFAULT 'active',
  tombstoned_at INTEGER,
  skipped_reason TEXT,
  captured_at  INTEGER NOT NULL,
  git_sha      TEXT    NOT NULL,
  token_est    INTEGER NOT NULL DEFAULT 0,
  last_capture_id INTEGER
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

CREATE VIRTUAL TABLE IF NOT EXISTS cf_search_v2 USING fts5(
  path,
  exports,
  file_summary,
  outline,
  tokenize     = 'porter unicode61'
);
`;
