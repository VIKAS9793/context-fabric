// tests/router.test.ts
// Tests E3 Router BM25 relevance ranking.
//
// VERIFIED: FTS5 BM25 returns negative scores. More negative = more relevant.
//           ORDER BY bm25(...) without DESC returns best matches first.
//           Source: sqlite.org/fts5.html
//
// ANTI-DRIFT: bm25() ONLY works inside a WHERE ... MATCH clause.

import { describe, it, expect, beforeEach } from 'vitest';
import type Database    from 'better-sqlite3';
import { createTestDb, seedComponent } from './helpers/db.js';
import { routeQuery, defaultRouterQuery } from '../src/engines/router.js';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe('E3 Router — routeQuery', () => {

  it('ranks exact path match above unrelated files', () => {
    seedComponent(db, {
      path:    'src/auth/middleware.ts',
      sha256:  'aaa',
      exports: JSON.stringify(['authenticate', 'authorise']),
    });
    seedComponent(db, {
      path:    'src/utils/format-date.ts',
      sha256:  'bbb',
      exports: JSON.stringify(['formatDate']),
    });
    seedComponent(db, {
      path:    'src/config/database.ts',
      sha256:  'ccc',
      exports: JSON.stringify(['getDb']),
    });

    const result = routeQuery(db, defaultRouterQuery('auth'));

    expect(result.fallback).toBe(false);
    expect(result.ranked[0].path).toBe('src/auth/middleware.ts');
    expect(result.ranked[0].bm25_score).toBeLessThan(0);
  });

  it('falls back to recency sort when no match found', () => {
    seedComponent(db, {
      path:    'src/utils/format-date.ts',
      sha256:  'ddd',
      exports: JSON.stringify(['formatDate']),
    });

    const result = routeQuery(db, defaultRouterQuery('zzz-no-match-xyz'));

    expect(result.fallback).toBe(true);
    expect(result.ranked.length).toBeGreaterThan(0);
  });

  it('handles empty query gracefully with fallback', () => {
    seedComponent(db, { path: 'src/index.ts', sha256: 'eee' });

    const result = routeQuery(db, defaultRouterQuery(''));

    expect(result.fallback).toBe(true);
  });

  it('handles FTS5 special characters without throwing', () => {
    seedComponent(db, { path: 'src/index.ts', sha256: 'fff' });

    const dangerousInputs = [
      'auth + middleware',
      'auth - middleware',
      '"exact phrase"',
      'auth:path',
      'auth*',
      '(auth OR middleware)',
    ];

    for (const input of dangerousInputs) {
      expect(() => routeQuery(db, defaultRouterQuery(input))).not.toThrow();
    }
  });

  it('returns results within the specified limit', () => {
    for (let i = 0; i < 30; i++) {
      seedComponent(db, {
        path:    `src/module${i}.ts`,
        sha256:  `hash${i}`,
        exports: JSON.stringify([`export${i}`]),
      });
    }

    const result = routeQuery(db, { text: 'module', limit: 10 });

    expect(result.ranked.length).toBeLessThanOrEqual(10);
  });

  it('caps oversized raw queries before running the FTS sanitiser', () => {
    seedComponent(db, {
      path:    'src/auth/middleware.ts',
      sha256:  'xxx',
      exports: JSON.stringify(['authenticate']),
    });

    const huge = 'auth '.repeat(5000); // ~25 000 chars
    const start = Date.now();
    const result = routeQuery(db, defaultRouterQuery(huge));
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(result.ranked.length).toBeGreaterThan(0);
  });

  it('assigns 1-based ranks in order', () => {
    seedComponent(db, {
      path:    'src/auth/handler.ts',
      sha256:  'ggg',
      exports: JSON.stringify(['handleAuth']),
    });
    seedComponent(db, {
      path:    'src/auth/validator.ts',
      sha256:  'hhh',
      exports: JSON.stringify(['validateAuth']),
    });

    const result = routeQuery(db, defaultRouterQuery('auth'));

    result.ranked.forEach((comp, i) => {
      expect(comp.rank).toBe(i + 1);
    });
  });

});
