// tests/anchor.test.ts
// Tests E2 Anchor drift detection.
// Strategy: insert components with known hashes, then test against
//           real files on disk (temp files) and verify DriftReport.
//
// No mocking. Real filesystem. Real SHA256. Real SQLite.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { join }          from 'node:path';
import { createHash }    from 'node:crypto';
import { tmpdir }        from 'node:os';
import type Database     from 'better-sqlite3';
import { createTestDb, seedComponent } from './helpers/db.js';
import { computeDrift }  from '../src/engines/anchor.js';

let testRoot: string;
let db: Database.Database;

beforeEach(() => {
  testRoot = join(tmpdir(), `cf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testRoot, { recursive: true });
  db = createTestDb();
});

afterEach(() => {
  db.close();
  if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
});

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('E2 Anchor — computeDrift', () => {

  it('returns LOW severity when all files match stored hashes', () => {
    const content = 'export const x = 1;';
    writeFileSync(join(testRoot, 'a.ts'), content);

    seedComponent(db, {
      path:   'a.ts',
      sha256: sha256(content),
    });

    const report = computeDrift(db, testRoot);

    expect(report.severity).toBe('LOW');
    expect(report.drift_score).toBe(0);
    expect(report.stale).toHaveLength(0);
    expect(report.fresh).toHaveLength(1);
  });

  it('returns HIGH severity when all stored files have changed', () => {
    const original = 'export const x = 1;';
    const modified = 'export const x = 99;';

    writeFileSync(join(testRoot, 'b.ts'), modified);

    seedComponent(db, {
      path:   'b.ts',
      sha256: sha256(original),
    });

    const report = computeDrift(db, testRoot);

    expect(report.severity).toBe('HIGH');
    expect(report.drift_score).toBe(100);
    expect(report.stale).toHaveLength(1);
    expect(report.stale[0].path).toBe('b.ts');
    expect(report.stale[0].current_sha).toBe(sha256(modified));
    expect(report.stale[0].stored_sha).toBe(sha256(original));
  });

  it('marks deleted files as stale with current_sha DELETED', () => {
    seedComponent(db, {
      path:   'ghost.ts',
      sha256: sha256('some content'),
    });

    const report = computeDrift(db, testRoot);

    const ghostEntry = report.stale.find(s => s.path === 'ghost.ts');
    expect(ghostEntry).toBeDefined();
    expect(ghostEntry?.current_sha).toBe('DELETED');
  });

  it('returns MED severity at 20% drift', () => {
    const content = 'const a = 1;';
    for (let i = 0; i < 4; i++) {
      writeFileSync(join(testRoot, `fresh${i}.ts`), content);
      seedComponent(db, { path: `fresh${i}.ts`, sha256: sha256(content) });
    }
    writeFileSync(join(testRoot, 'stale.ts'), 'const modified = true;');
    seedComponent(db, { path: 'stale.ts', sha256: sha256('const original = true;') });

    const report = computeDrift(db, testRoot);

    expect(report.severity).toBe('MED');
    expect(report.drift_score).toBeGreaterThanOrEqual(10);
    expect(report.drift_score).toBeLessThan(30);
  });

  it('returns zero drift when no components are stored', () => {
    const report = computeDrift(db, testRoot);

    expect(report.drift_score).toBe(0);
    expect(report.severity).toBe('LOW');
    expect(report.total_components).toBe(0);
  });

  it('matches Watcher-style raw-Buffer SHA256 for UTF-8-with-BOM files', () => {
    // Watcher hashes the raw git blob (bytes including BOM).
    // Anchor must hash the raw bytes too — not a utf-8-decoded string.
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.from('export const x = 1;\n', 'utf8');
    const buffer = Buffer.concat([bom, body]);
    writeFileSync(join(testRoot, 'bom.ts'), buffer);

    const expected = createHash('sha256').update(buffer).digest('hex');
    seedComponent(db, { path: 'bom.ts', sha256: expected });

    const report = computeDrift(db, testRoot);
    expect(report.severity).toBe('LOW');
    expect(report.stale).toHaveLength(0);
  });

  it('rejects symlinks that escape the project root', () => {
    const outsideDir = join(tmpdir(), `cf-anchor-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(outsideDir, { recursive: true });
    try {
      const outsideFile = join(outsideDir, 'secret.txt');
      writeFileSync(outsideFile, 'secret');
      const linkPath = join(testRoot, 'escape.ts');
      symlinkSync(outsideFile, linkPath);

      seedComponent(db, { path: 'escape.ts', sha256: 'whatever' });
      const report = computeDrift(db, testRoot);

      const entry = report.stale.find(s => s.path === 'escape.ts');
      expect(entry).toBeDefined();
      expect(entry?.current_sha).toBe('TRAVERSAL_REJECTED');
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

});
