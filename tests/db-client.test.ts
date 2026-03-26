import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDb, getDb, getDbRuntimeState } from '../src/db/client.js';

const LEGACY_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cf_components (
  id           INTEGER PRIMARY KEY,
  path         TEXT    NOT NULL UNIQUE,
  sha256       TEXT    NOT NULL,
  exports      TEXT,
  file_summary TEXT,
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
`;

let projectRoot: string | null = null;

function createProjectRoot(name: string): string {
  const root = join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(root, '.context-fabric'), { recursive: true });
  return root;
}

function createLegacyDb(root: string): void {
  const db = new Database(join(root, '.context-fabric', 'cf.db'));
  db.exec(LEGACY_SCHEMA_SQL);
  db.prepare(`
    INSERT INTO cf_components (
      path, sha256, exports, file_summary, comp_type, captured_at, git_sha, token_est
    ) VALUES (
      'src/auth.ts', 'abc123', '["auth"]', 'Authentication entrypoint',
      'file', @captured_at, 'legacy-sha', 100
    )
  `).run({ captured_at: Date.now() });
  db.prepare(`
    INSERT INTO cf_snapshots (git_sha, summary, captured_at, token_est)
    VALUES ('legacy-sha', 'legacy commit', @captured_at, 20)
  `).run({ captured_at: Date.now() });
  db.close();
}

function createPartiallyUpgradedDb(root: string): void {
  const db = new Database(join(root, '.context-fabric', 'cf.db'));
  db.exec(LEGACY_SCHEMA_SQL);
  db.exec(`
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

    CREATE VIRTUAL TABLE IF NOT EXISTS cf_search_v2 USING fts5(
      path,
      exports,
      file_summary,
      outline,
      tokenize = 'porter unicode61'
    );
  `);
  db.prepare(`
    INSERT INTO cf_components (
      path, sha256, exports, file_summary, comp_type, captured_at, git_sha, token_est
    ) VALUES (
      'src/index.ts', 'def456', '["main"]', 'Main module',
      'file', @captured_at, 'partial-sha', 120
    )
  `).run({ captured_at: Date.now() });
  db.close();
}

afterEach(() => {
  closeDb();
  if (projectRoot && existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
  projectRoot = null;
});

describe('db client migrations', () => {
  it('migrates a legacy v1 database without degrading and creates a backup', () => {
    projectRoot = createProjectRoot('cf-legacy-db');
    createLegacyDb(projectRoot);

    const db = getDb(projectRoot);
    const runtime = getDbRuntimeState();

    expect(runtime.degraded).toBe(false);
    expect(runtime.schemaVersion).toBe(2);
    expect(runtime.backupPath).not.toBeNull();
    expect(existsSync(runtime.backupPath!)).toBe(true);

    const columns = db.prepare(`PRAGMA table_info(cf_components)`).all() as { name: string }[];
    expect(columns.map(column => column.name)).toContain('status');
    expect(columns.map(column => column.name)).toContain('outline');
    expect(columns.map(column => column.name)).toContain('last_capture_id');

    const row = db.prepare(`
      SELECT status, last_capture_id
      FROM cf_components
      WHERE path = 'src/auth.ts'
    `).get() as { status: string; last_capture_id: number | null } | undefined;
    expect(row?.status).toBe('active');
    expect(row?.last_capture_id).not.toBeNull();

    const searchRows = db.prepare(`SELECT COUNT(*) AS total FROM cf_search_v2`).get() as { total: number };
    expect(searchRows.total).toBe(1);
  });

  it('recovers a partially upgraded database that already has new tables but missing new component columns', () => {
    projectRoot = createProjectRoot('cf-partial-db');
    createPartiallyUpgradedDb(projectRoot);

    const db = getDb(projectRoot);
    const runtime = getDbRuntimeState();

    expect(runtime.degraded).toBe(false);
    expect(runtime.schemaVersion).toBe(2);

    const columns = db.prepare(`PRAGMA table_info(cf_components)`).all() as { name: string }[];
    expect(columns.map(column => column.name)).toContain('status');
    expect(columns.map(column => column.name)).toContain('skipped_reason');

    const runs = db.prepare(`
      SELECT COUNT(*) AS total
      FROM cf_capture_runs
      WHERE status = 'succeeded'
    `).get() as { total: number };
    expect(runs.total).toBeGreaterThanOrEqual(1);
  });
});
