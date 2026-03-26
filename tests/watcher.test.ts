// tests/watcher.test.ts
// Tests E1 Watcher capture logic.
//
// These tests create a real temporary git repository and run
// actual git commands. No mocking of git. No mocking of filesystem.
//
// VERIFIED: spawnSync used for all git operations — no shell injection risk.
// VERIFIED: \r stripped from all git output lines.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join }      from 'node:path';
import { tmpdir }    from 'node:os';
import { spawnSync } from 'node:child_process';
import type Database from 'better-sqlite3';
import { createTestDb } from './helpers/db.js';
import { runWatcher }   from '../src/engines/watcher.js';

let testRoot: string;
let db: Database.Database;

function git(args: string[]): void {
  const result = spawnSync('git', args, {
    cwd:      testRoot,
    encoding: 'utf8',
    stdio:    ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

beforeEach(() => {
  testRoot = join(
    tmpdir(),
    `cf-watcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(testRoot, { recursive: true });
  db = createTestDb();

  // Initialise a real git repo
  git(['init']);
  git(['config', 'user.email', 'test@cf.test']);
  git(['config', 'user.name', 'CF Test']);
});

afterEach(() => {
  db.close();
  if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
});

describe('E1 Watcher — runWatcher', () => {

  it('captures all files on first run (full mode)', () => {
    writeFileSync(join(testRoot, 'a.ts'), 'export const a = 1;');
    writeFileSync(join(testRoot, 'b.ts'), 'export const b = 2;');
    git(['add', '.']);
    git(['commit', '-m', 'initial commit']);

    const result = runWatcher(db, testRoot);

    expect(result.captured).toBe(2);

    const stored = db
      .prepare('SELECT path FROM cf_components ORDER BY path')
      .all() as { path: string }[];
    expect(stored.map(r => r.path)).toContain('a.ts');
    expect(stored.map(r => r.path)).toContain('b.ts');
  });

  it('captures only changed files on incremental run', () => {
    writeFileSync(join(testRoot, 'a.ts'), 'export const a = 1;');
    writeFileSync(join(testRoot, 'b.ts'), 'export const b = 2;');
    git(['add', '.']);
    git(['commit', '-m', 'initial commit']);
    runWatcher(db, testRoot);  // full mode — captures 2 files

    writeFileSync(join(testRoot, 'a.ts'), 'export const a = 99;');
    git(['add', 'a.ts']);
    git(['commit', '-m', 'update a']);

    const result = runWatcher(db, testRoot);  // incremental mode

    expect(result.captured).toBe(1);
  });

  it('tombstones renamed paths and activates the new path', () => {
    writeFileSync(join(testRoot, 'old-name.ts'), 'export const renamed = true;');
    git(['add', '.']);
    git(['commit', '-m', 'initial commit']);
    runWatcher(db, testRoot);

    git(['mv', 'old-name.ts', 'new-name.ts']);
    git(['commit', '-m', 'rename file']);

    const result = runWatcher(db, testRoot);
    expect(result.captured).toBe(1);

    const rows = db.prepare(`
      SELECT path, status
      FROM cf_components
      ORDER BY path
    `).all() as { path: string; status: string }[];

    expect(rows).toContainEqual({ path: 'new-name.ts', status: 'active' });
    expect(rows).toContainEqual({ path: 'old-name.ts', status: 'tombstoned' });
  });

  it('tombstones deleted paths instead of leaving stale active rows', () => {
    writeFileSync(join(testRoot, 'delete-me.ts'), 'export const keep = false;');
    git(['add', '.']);
    git(['commit', '-m', 'initial commit']);
    runWatcher(db, testRoot);

    git(['rm', 'delete-me.ts']);
    git(['commit', '-m', 'delete file']);

    const result = runWatcher(db, testRoot);
    expect(result.captured).toBe(0);

    const row = db.prepare(`
      SELECT status
      FROM cf_components
      WHERE path = ?
    `).get('delete-me.ts') as { status: string } | undefined;

    expect(row?.status).toBe('tombstoned');
  });

  it('stores pre-calculated token_est at capture time', () => {
    const content = 'export const value = "hello world";';
    writeFileSync(join(testRoot, 'tok.ts'), content);
    git(['add', '.']);
    git(['commit', '-m', 'add tok.ts']);

    runWatcher(db, testRoot);

    const row = db
      .prepare('SELECT token_est FROM cf_components WHERE path = ?')
      .get('tok.ts') as { token_est: number } | undefined;

    expect(row).toBeDefined();
    expect(row!.token_est).toBe(Math.ceil(content.length / 3.5));
  });

  it('writes a session snapshot on every capture', () => {
    writeFileSync(join(testRoot, 'snap.ts'), 'const s = 1;');
    git(['add', '.']);
    git(['commit', '-m', 'snapshot test']);

    runWatcher(db, testRoot);

    const snapshot = db
      .prepare('SELECT git_sha, summary FROM cf_snapshots ORDER BY captured_at DESC LIMIT 1')
      .get() as { git_sha: string; summary: string } | undefined;

    expect(snapshot).toBeDefined();
    expect(snapshot!.git_sha).toMatch(/^[a-f0-9]{40}$/);
    expect(snapshot!.summary).toContain('snapshot test');
  });

  it('skips binary and generated files', () => {
    writeFileSync(join(testRoot, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(testRoot, 'real.ts'), 'export const x = 1;');
    git(['add', '.']);
    git(['commit', '-m', 'mixed files']);

    runWatcher(db, testRoot);

    const paths = (db
      .prepare('SELECT path FROM cf_components')
      .all() as { path: string }[])
      .map(r => r.path);

    expect(paths).toContain('real.ts');
    expect(paths).not.toContain('image.png');
  });

  it('extracts @fileoverview summary when present', () => {
    const content = '/** @fileoverview Authentication middleware for JWT validation */\nexport function auth() {}';
    writeFileSync(join(testRoot, 'auth.ts'), content);
    git(['add', '.']);
    git(['commit', '-m', 'add auth']);

    runWatcher(db, testRoot);

    const row = db
      .prepare('SELECT file_summary FROM cf_components WHERE path = ?')
      .get('auth.ts') as { file_summary: string | null } | undefined;

    expect(row).toBeDefined();
    expect(row!.file_summary).toContain('Authentication middleware');
  });

});
