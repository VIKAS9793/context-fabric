// src/db/client.ts
// ANTI-DRIFT NOTE: better-sqlite3 is SYNCHRONOUS. There is no async/await.
// Database.prepare() returns a Statement. Statement.run(), .get(), .all() are sync.
// Do NOT add async/await to any better-sqlite3 call.
// Reference: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT_SCHEMA_VERSION, SCHEMA_SQL, SEARCH_INDEX_VERSION } from './schema.js';
import { rebuildSearchIndex } from './search-index.js';

let _db: Database.Database | null = null;

interface DbRuntimeState {
  projectRoot: string | null;
  dbPath: string | null;
  schemaVersion: number;
  integrity: 'ok' | 'failed';
  degraded: boolean;
  degradedReason: string | null;
  backupPath: string | null;
}

const runtimeState: DbRuntimeState = {
  projectRoot: null,
  dbPath: null,
  schemaVersion: 0,
  integrity: 'ok',
  degraded: false,
  degradedReason: null,
  backupPath: null,
};

function getPragmaNumber(db: Database.Database, name: string): number {
  const value = db.prepare(`PRAGMA ${name}`).pluck().get() as number | bigint | undefined;
  if (typeof value === 'bigint') return Number(value);
  return typeof value === 'number' ? value : 0;
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type IN ('table', 'view', 'virtual table')
      AND name = ?
    LIMIT 1
  `).get(name);
  return Boolean(row);
}

function columnExists(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some(row => row.name === column);
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  sql: string,
): void {
  if (columnExists(db, table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sql}`);
}

function setMeta(
  db: Database.Database,
  key: string,
  value: string,
): void {
  db.prepare(`
    INSERT INTO cf_meta (key, value, updated_at)
    VALUES (@key, @value, @updated_at)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run({
    key,
    value,
    updated_at: Date.now(),
  });
}

function createMigrationBackup(
  db: Database.Database,
  dir: string,
  fromVersion: number,
): string | null {
  const backupPath = join(dir, `cf.db.backup.v${fromVersion}.${Date.now()}.sqlite`);
  const escapedPath = backupPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escapedPath}'`);
  return backupPath;
}

function ensureSupportingIndexes(db: Database.Database): void {
  if (columnExists(db, 'cf_components', 'status')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cf_components_status_path
        ON cf_components(status, path);
    `);
  }

  if (columnExists(db, 'cf_components', 'last_capture_id') && columnExists(db, 'cf_components', 'status')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cf_components_capture
        ON cf_components(last_capture_id, status);
    `);
  }

  if (tableExists(db, 'cf_capture_runs')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cf_capture_runs_status_started
        ON cf_capture_runs(status, started_at DESC);
    `);
  }
}

function createSyntheticCaptureRun(db: Database.Database): number | null {
  const latest = db.prepare(`
    SELECT git_sha
    FROM cf_snapshots
    ORDER BY captured_at DESC
    LIMIT 1
  `).get() as { git_sha: string } | undefined;

  const gitSha = latest?.git_sha
    ?? (db.prepare(`
      SELECT git_sha
      FROM cf_components
      ORDER BY captured_at DESC
      LIMIT 1
    `).get() as { git_sha: string } | undefined)?.git_sha
    ?? 'unknown';

  if (!tableExists(db, 'cf_capture_runs')) return null;

  const now = Date.now();
  const stats = db.prepare(`
    SELECT COUNT(*) AS total
    FROM cf_components
    WHERE status = 'active'
  `).get() as { total: number };

  const result = db.prepare(`
    INSERT INTO cf_capture_runs (
      git_sha, status, mode, started_at, completed_at,
      changed_files, indexed_files, indexed_bytes,
      skipped_count, skipped_summary, error_message
    ) VALUES (
      @git_sha, 'succeeded', 'migrated', @started_at, @completed_at,
      @changed_files, @indexed_files, 0,
      0, '{}', NULL
    )
  `).run({
    git_sha: gitSha,
    started_at: now,
    completed_at: now,
    changed_files: stats.total,
    indexed_files: stats.total,
  });

  const captureId = Number(result.lastInsertRowid);
  db.prepare(`
    UPDATE cf_components
    SET status = 'active',
        tombstoned_at = NULL,
        last_capture_id = COALESCE(last_capture_id, @capture_id)
  `).run({ capture_id: captureId });

  return captureId;
}

function migrateLegacySchema(
  db: Database.Database,
  fromVersion: number,
): void {
  if (fromVersion >= CURRENT_SCHEMA_VERSION) return;

  addColumnIfMissing(db, 'cf_components', 'file_summary', 'TEXT');
  addColumnIfMissing(db, 'cf_components', 'outline', 'TEXT');
  addColumnIfMissing(db, 'cf_components', 'status', `TEXT NOT NULL DEFAULT 'active'`);
  addColumnIfMissing(db, 'cf_components', 'tombstoned_at', 'INTEGER');
  addColumnIfMissing(db, 'cf_components', 'skipped_reason', 'TEXT');
  addColumnIfMissing(db, 'cf_components', 'last_capture_id', 'INTEGER');

  db.exec(`
    UPDATE cf_components
    SET status = COALESCE(NULLIF(status, ''), 'active')
  `);

  const hasCaptureRuns = (db.prepare('SELECT COUNT(*) AS n FROM cf_capture_runs').get() as { n: number }).n > 0;
  if (!hasCaptureRuns) {
    createSyntheticCaptureRun(db);
  }

  rebuildSearchIndex(db);
  ensureSupportingIndexes(db);
  db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
}

function seedMetaState(db: Database.Database): void {
  setMeta(db, 'schema_version', String(CURRENT_SCHEMA_VERSION));
  setMeta(db, 'search_index_version', String(SEARCH_INDEX_VERSION));
}

function runIntegrityCheck(db: Database.Database): void {
  const result = db.prepare('PRAGMA integrity_check').pluck().get() as string | undefined;
  if (result !== 'ok') {
    runtimeState.integrity = 'failed';
    runtimeState.degraded = true;
    runtimeState.degradedReason = `SQLite integrity_check failed: ${result ?? 'unknown'}`;
  }
}

export function getDb(projectRoot: string): Database.Database {
  if (_db) return _db;

  const dir = join(projectRoot, '.context-fabric');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const dbPath = join(dir, 'cf.db');
  const existingDb = existsSync(dbPath);
  _db = new Database(dbPath);
  runtimeState.projectRoot = projectRoot;
  runtimeState.dbPath = dbPath;

  try {
    runIntegrityCheck(_db);
    const hadLegacyComponents = existingDb && tableExists(_db, 'cf_components');
    _db.exec(SCHEMA_SQL);

    const currentVersion = getPragmaNumber(_db, 'user_version');

    if (!runtimeState.degraded && currentVersion < CURRENT_SCHEMA_VERSION && hadLegacyComponents) {
      runtimeState.backupPath = createMigrationBackup(_db, dir, currentVersion);
      migrateLegacySchema(_db, currentVersion);
    } else if (!runtimeState.degraded && currentVersion < CURRENT_SCHEMA_VERSION) {
      _db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
      rebuildSearchIndex(_db);
      ensureSupportingIndexes(_db);
    }

    if (!runtimeState.degraded) {
      ensureSupportingIndexes(_db);
      seedMetaState(_db);
      runtimeState.schemaVersion = CURRENT_SCHEMA_VERSION;
    }
  } catch (err) {
    runtimeState.integrity = 'failed';
    runtimeState.degraded = true;
    runtimeState.degradedReason = err instanceof Error ? err.message : String(err);
  }

  return _db;
}

export function ensureWritableDb(): void {
  if (runtimeState.degraded) {
    throw new Error(
      runtimeState.degradedReason
        ? `Context Fabric database is in degraded mode: ${runtimeState.degradedReason}`
        : 'Context Fabric database is in degraded mode'
    );
  }
}

export function getDbRuntimeState(): DbRuntimeState {
  return { ...runtimeState };
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  runtimeState.projectRoot = null;
  runtimeState.dbPath = null;
  runtimeState.schemaVersion = 0;
  runtimeState.integrity = 'ok';
  runtimeState.degraded = false;
  runtimeState.degradedReason = null;
  runtimeState.backupPath = null;
}
