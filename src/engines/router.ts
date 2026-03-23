// src/engines/router.ts
// E3 ROUTER — BM25-weighted relevance ranking across context modules
//
// RESEARCH BASIS:
//   Signal 032 (F-016): User decomposes project into many documentation modules.
//   Without a ranking mechanism, all modules must be loaded — expensive and unfocused.
//   Router solves: which modules are relevant to THIS query, right now.
//
//   Signal 027 (F-011): User who tried RAG/embeddings switched back to structured
//   docs for reliability. BM25 on structured metadata is more deterministic than
//   semantic embeddings for codebase queries.
//
// ANTI-DRIFT NOTES:
//   1. FTS5 BM25 returns NEGATIVE scores. More negative = more relevant.
//      ORDER BY bm25(...) without DESC = best matches first. This is correct.
//      Do NOT add DESC. Verified: https://www.sqlite.org/fts5.html
//
//   2. User input MUST be sanitised before passing to MATCH.
//      FTS5 MATCH has its own query language. Special characters cause syntax errors.
//      Characters to strip: + - * ^ ( ) " : .
//      This is not optional — raw user queries WILL break MATCH.
//
//   3. Column weights in bm25(cf_search, w0, w1):
//      w0 = weight for 'path' column (defined first in CREATE VIRTUAL TABLE)
//      w1 = weight for 'exports' column (defined second)
//      path gets 2.0x: path matches carry structural codebase meaning
//      exports gets 1.0x: symbol matches are semantic but less precise
//
//   4. External-content FTS5 table: cf_search has content='cf_components'
//      This means cf_search stores the index but NOT the data.
//      JOIN cf_components on cf_search.rowid = c.id to get actual column values.
//      Do NOT try to SELECT path FROM cf_search directly — it may be stale without triggers.
//
//   5. FTS5 MATCH operator uses the table name as column reference:
//      WHERE cf_search MATCH ?     -- searches all indexed columns
//      WHERE cf_search MATCH 'path:auth'  -- searches only path column
//
//   Reference: https://www.sqlite.org/fts5.html

import type Database from 'better-sqlite3';
import type { RouterQuery, RouterResult, RankedComponent } from '../types.js';

// ─── FTS5 QUERY SANITISER ─────────────────────────────────────────────────

// FTS5 boolean operators — must be stripped, not treated as search terms
const FTS5_RESERVED = new Set(['OR', 'AND', 'NOT']);

function sanitiseFtsQuery(raw: string): string {
  // Step 1: strip FTS5 special characters
  const stripped = raw
    .replace(/[+\-*^()":.]/g, ' ')     // remove all FTS5 operators
    .replace(/\s+/g, ' ')              // collapse whitespace
    .trim();

  if (!stripped) return '';

  // Step 2: split into tokens, filter empties, enforce min length,
  //         and strip FTS5 reserved boolean words (OR, AND, NOT)
  return stripped
    .split(' ')
    .map(t => t.trim())
    .filter(t => t.length >= 2)        // FTS5 skips tokens < 2 chars anyway
    .filter(t => !FTS5_RESERVED.has(t.toUpperCase()))  // strip OR, AND, NOT
    .slice(0, 10)
    .map(t => `${t}*`)
    .join(' ');
}

// ─── FALLBACK: RECENCY SORT ──────────────────────────────────────────────

function fetchByRecency(
  db:    Database.Database,
  limit: number,
): RankedComponent[] {
  const rows = db.prepare(`
    SELECT id, path, exports, file_summary, comp_type, token_est,
           captured_at
    FROM cf_components
    ORDER BY captured_at DESC
    LIMIT ?
  `).all(limit) as {
    id: number; path: string; exports: string | null;
    file_summary: string | null;
    comp_type: string; token_est: number; captured_at: number;
  }[];

  return rows.map((row, i) => ({
    id:           row.id,
    path:         row.path,
    exports:      row.exports,
    file_summary: row.file_summary,
    comp_type:    row.comp_type,
    token_est:    row.token_est,
    bm25_score:   0,      // no BM25 score in fallback
    rank:         i + 1,
  }));
}

// ─── MAIN: BM25 RANKED QUERY ─────────────────────────────────────────────

export function routeQuery(
  db:    Database.Database,
  query: RouterQuery,
): RouterResult {
  const { text, limit } = query;

  const sanitised = sanitiseFtsQuery(text);

  if (!sanitised) {
    return {
      ranked:       fetchByRecency(db, limit),
      query_text:   '',
      fallback:     true,
      total_ranked: 0,
    };
  }

  let rows: {
    id: number; path: string; exports: string | null;
    file_summary: string | null;
    comp_type: string; token_est: number; bm25_score: number;
  }[];

  try {
    rows = db.prepare(`
      SELECT
        c.id,
        c.path,
        c.exports,
        c.file_summary,
        c.comp_type,
        c.token_est,
        bm25(cf_search, 2.0, 1.0) AS bm25_score
      FROM cf_search
      JOIN cf_components c ON cf_search.rowid = c.id
      WHERE cf_search MATCH ?
      ORDER BY bm25(cf_search, 2.0, 1.0)
      LIMIT ?
    `).all(sanitised, limit) as {
      id: number; path: string; exports: string | null;
      file_summary: string | null;
      comp_type: string; token_est: number; bm25_score: number;
    }[];
  } catch (err) {
    process.stderr.write(
      `[CF ROUTER] FTS5 MATCH error on sanitised query "${sanitised}": ${err}\n`
    );
    return {
      ranked:       fetchByRecency(db, limit),
      query_text:   sanitised,
      fallback:     true,
      total_ranked: 0,
    };
  }

  if (rows.length === 0) {
    return {
      ranked:       fetchByRecency(db, limit),
      query_text:   sanitised,
      fallback:     true,
      total_ranked: 0,
    };
  }

  const ranked: RankedComponent[] = rows.map((row, i) => ({
    id:           row.id,
    path:         row.path,
    exports:      row.exports,
    file_summary: row.file_summary,
    comp_type:    row.comp_type,
    token_est:    row.token_est,
    bm25_score:   row.bm25_score,
    rank:         i + 1,
  }));

  return {
    ranked,
    query_text:   sanitised,
    fallback:     false,
    total_ranked: ranked.length,
  };
}

export function defaultRouterQuery(text: string): RouterQuery {
  return {
    text,
    limit: 25,
  };
}
