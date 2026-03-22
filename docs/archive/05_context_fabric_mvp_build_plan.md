# Context Fabric — MVP Build Plan

**Product:** Context Fabric  
**Category:** AI Developer Infrastructure  
**Layer:** Workflow Continuity Infrastructure  
**Author:** Vikas Sahani  
**Document Type:** Engineering Build Plan  
**MVP Scope:** E1 Watcher + E2 Anchor + E5 Weaver (minimal)  
**Version:** v1.0  
**Date:** March 2026  

---

*Context Fabric — AI Project Continuity Infrastructure*

---

## CRITICAL: AI Tool Use Protocol

> **This section must be read before using any AI coding tool (Claude Code, Cursor, Windsurf) to build this project.**

This project will be built with AI coding assistance. AI coding tools carry stale training data. They will hallucinate package APIs, invent method signatures, suggest deprecated patterns, and confidently use wrong version-specific syntax. This is not a criticism — it is a structural property of how these tools work.

Every guardrail in this document exists to prevent that drift from entering the codebase.

**The three failure modes to guard against:**

1. **Version drift** — AI suggests API from `@modelcontextprotocol/sdk@0.x` when we are on `1.27.1`. The tool surface changed significantly between versions.
2. **API hallucination** — AI invents a method that does not exist on `better-sqlite3@12.x` or `zod@4.x`. These are real packages with real docs. Check them.
3. **Pattern drift** — AI suggests a pattern from a tutorial written for an older MCP SDK version or an incompatible transport model.

**The rule: when in doubt, fetch the docs. Never trust training memory for versioned APIs.**

---

## Anti-Drift Guardrails for AI Tools

These are hard rules. Paste this block at the top of every AI session working on this codebase.

```
CONTEXT FABRIC BUILD SESSION — ANTI-DRIFT RULES

1. PACKAGE VERSIONS ARE LOCKED. Do not suggest upgrades or downgrades.
   - @modelcontextprotocol/sdk: exactly ^1.27.1
   - better-sqlite3: exactly ^12.8.0
   - zod: exactly ^4.3.6
   - typescript: exactly ^5.5.0
   - node: 22 LTS

2. BEFORE writing any MCP SDK code, fetch the current API docs:
   https://github.com/modelcontextprotocol/typescript-sdk
   Do not rely on training memory. The v1.x API changed from v0.x.

3. BEFORE writing any better-sqlite3 code, confirm the method against:
   https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
   Do not invent methods. .prepare().run(), .prepare().get(), .prepare().all() are real.
   .query() does not exist on better-sqlite3.

4. BEFORE writing any Zod schema, confirm against Zod v4 docs:
   https://zod.dev
   Zod v4 changed several APIs from v3. z.string().nonempty() is deprecated in v4.
   Use z.string().min(1) instead.

5. FTS5 SYNTAX: SQLite FTS5 BM25 returns negative scores (lower = more relevant).
   ORDER BY bm25(...) without DESC is correct. Do not add DESC.

6. TRANSPORT: This project uses stdio transport only in Phase 1.
   Do not suggest SSE, WebSocket, or HTTP transport for MVP.
   The MCP SDK v1.x stdio server is StdioServerTransport from @modelcontextprotocol/sdk/server/stdio.js

7. NO EXTERNAL SERVICES in Phase 1. No API calls at capture time. No embeddings.
   No cloud storage. No authentication. Everything runs locally.

8. ESM ONLY. package.json has "type": "module". All imports use .js extensions.
   import { x } from './module.js' — not './module' or './module.ts'

9. When unsure about any of the above: STOP and search the web for the current docs.
   Do not proceed on assumption.
```

---

## MVP Scope Definition

### What is in scope

```
E1 WATCHER     →  git post-commit hook + SHA256 + SQLite upsert
E2 ANCHOR      →  hash comparison + DriftReport
E5 WEAVER      →  minimal briefing composition (no E3 ranking yet)
                   flat list of all components, most recent first

MCP Tools (4):
  capture_context   →  manual E1 trigger
  check_drift       →  E2 standalone
  query_context     →  E2 + flat component list + E5 minimal briefing
  log_decision      →  ADR capture
```

### What is explicitly out of scope for MVP

```
E3 ROUTER      →  FTS5 BM25 relevance ranking — Phase 2
E4 GOVERNOR    →  Token budget greedy selection — Phase 2
get_snapshot   →  Session snapshot retrieval — Phase 2
list_components →  Inspection tool — Phase 2
get_decisions  →  ADR query — Phase 2

No VS Code Extension — Phase 2
No StreamableHTTP transport — Phase 2
No team sync — Phase 2
No vector embeddings — never in Phase 1
```

### MVP success condition

A developer installs Context Fabric, makes two commits, changes a file without updating documentation, runs `query_context`, and receives a DriftReport showing the file as stale with severity HIGH.

That moment is the product. Everything else is refinement.

---

## Project Structure

```
context-fabric/
├── src/
│   ├── index.ts              ← MCP server entry point
│   ├── db/
│   │   ├── schema.ts         ← SQL DDL + init function
│   │   └── client.ts         ← better-sqlite3 singleton
│   ├── engines/
│   │   ├── watcher.ts        ← E1: capture, hash, upsert
│   │   ├── anchor.ts         ← E2: drift detection
│   │   └── weaver.ts         ← E5: briefing composition (minimal)
│   ├── tools/
│   │   ├── capture-context.ts
│   │   ├── check-drift.ts
│   │   ├── query-context.ts
│   │   └── log-decision.ts
│   ├── types.ts              ← shared interfaces
│   └── cli.ts                ← `context-fabric init` CLI entry
├── scripts/
│   └── install-hook.sh       ← git hook installer
├── package.json
├── tsconfig.json
└── .context-fabric/          ← created at runtime, gitignored
    └── cf.db                 ← SQLite store
```

---

## Phase 1 — Project Initialisation

### 1.1 package.json

Do not invent fields. Use exactly this:

```json
{
  "name": "context-fabric",
  "version": "0.1.0",
  "description": "AI project continuity infrastructure — context drift detection for AI coding tools",
  "type": "module",
  "bin": {
    "context-fabric": "dist/cli.js"
  },
  "main": "dist/index.js",
  "files": ["dist", "scripts"],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.1",
    "better-sqlite3": "^12.8.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22",
    "typescript": "^5.5.0"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

### 1.2 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**AI tool guardrail:** `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` are required for ESM + Node 22. Do not change to `"module": "ESNext"` — that breaks the .js import extension resolution. If an AI tool suggests changing this, reject it.

---

## Phase 2 — Shared Types

File: `src/types.ts`

Define these interfaces once. Every engine and tool imports from here. No interface duplication.

```typescript
// src/types.ts

export interface Component {
  id:           number;
  path:         string;
  sha256:       string;
  exports:      string | null;   // JSON array string
  comp_type:    string;
  captured_at:  number;          // unix ms
  git_sha:      string;
  token_est:    number;
}

export interface Decision {
  id:           number;
  title:        string;
  rationale:    string;
  status:       'active' | 'superseded' | 'rejected';
  captured_at:  number;
  tags:         string | null;   // JSON array string
}

export interface Snapshot {
  id:           number;
  git_sha:      string;
  summary:      string;
  captured_at:  number;
  token_est:    number;
}

export interface StaleEntry {
  path:         string;
  stored_sha:   string;
  current_sha:  string;          // 'DELETED' if file no longer exists
}

export interface DriftReport {
  drift_score:  number;          // 0–100
  severity:     'LOW' | 'MED' | 'HIGH';
  stale:        StaleEntry[];
  fresh:        { path: string }[];
  checked_at:   number;          // unix ms
  total_components: number;
}

export interface CaptureResult {
  captured:     number;          // files processed
  git_sha:      string;
  timestamp:    number;
}
```

---

## Phase 3 — Database Layer

### 3.1 Schema

File: `src/db/schema.ts`

```typescript
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
```

### 3.2 Database Client

File: `src/db/client.ts`

```typescript
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
```

---

## Phase 4 — E1 Watcher Engine

File: `src/engines/watcher.ts`

```typescript
// src/engines/watcher.ts
// E1 WATCHER — Automated project state capture
// Fires on git post-commit hook. No developer action required.
//
// ANTI-DRIFT NOTE: execSync is used here, not exec. Sync is intentional —
// this runs in a git hook context where async would not complete before
// the hook exits. Do not convert to async.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, extname } from 'node:path';
import type Database from 'better-sqlite3';
import type { CaptureResult } from '../types.js';

// Files to skip — never store binary or generated files
const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.zip', '.tar', '.gz',
  '.lock',  // package-lock.json, yarn.lock — too large, low signal
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next',
  '.turbo', 'coverage', '.nyc_output',
]);

function shouldSkip(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return true;
  const parts = filePath.split('/');
  return parts.some(part => SKIP_DIRS.has(part));
}

function extractExports(content: string, filePath: string): string[] {
  const exports: string[] = [];
  const ext = extname(filePath);

  if (!['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'].includes(ext)) {
    return exports;
  }

  // Named exports: export function foo, export const foo, export class Foo
  const namedPattern = /^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+(\w+)/gm;
  let match: RegExpExecArray | null;
  while ((match = namedPattern.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // Default export identifier: export default MyComponent
  const defaultIdent = /^export\s+default\s+(\w+)/m.exec(content);
  if (defaultIdent) exports.push(`default:${defaultIdent[1]}`);

  return [...new Set(exports)]; // deduplicate
}

function getTokenEstimate(content: string): number {
  // Industry-standard approximation: 1 token ≈ 3.5 characters for English/code mixed
  return Math.ceil(content.length / 3.5);
}

function getChangedFiles(projectRoot: string): string[] {
  try {
    const result = execSync('git diff --name-only HEAD~1 HEAD', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim().split('\n').filter(Boolean);
  } catch {
    // First commit — HEAD~1 does not exist. Get all tracked files instead.
    try {
      const result = execSync('git diff --name-only --cached', {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
}

function getGitSha(projectRoot: string): string {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function runWatcher(db: Database.Database, projectRoot: string): CaptureResult {
  const gitSha = getGitSha(projectRoot);
  const changedFiles = getChangedFiles(projectRoot);
  const now = Date.now();
  let captured = 0;

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO cf_components
      (path, sha256, exports, comp_type, captured_at, git_sha, token_est)
    VALUES
      (@path, @sha256, @exports, @comp_type, @captured_at, @git_sha, @token_est)
  `);

  // Wrap in transaction for atomic batch upsert
  const batchUpsert = db.transaction((files: string[]) => {
    for (const relPath of files) {
      if (shouldSkip(relPath)) continue;

      const absPath = resolve(projectRoot, relPath);
      if (!existsSync(absPath)) continue;

      let content: string;
      try {
        content = readFileSync(absPath, 'utf8');
      } catch {
        continue; // Binary file or permission issue
      }

      const sha256 = createHash('sha256').update(content).digest('hex');
      const exports = extractExports(content, relPath);
      const tokenEst = getTokenEstimate(content);

      upsert.run({
        path:        relPath,
        sha256,
        exports:     exports.length > 0 ? JSON.stringify(exports) : null,
        comp_type:   'file',
        captured_at: now,
        git_sha:     gitSha,
        token_est:   tokenEst,
      });
      captured++;
    }
  });

  batchUpsert(changedFiles);

  // Write session snapshot
  const gitSummary = (() => {
    try {
      return execSync('git log -1 --oneline', {
        cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch { return gitSha; }
  })();

  db.prepare(`
    INSERT OR REPLACE INTO cf_snapshots (git_sha, summary, captured_at, token_est)
    VALUES (@git_sha, @summary, @captured_at, @token_est)
  `).run({
    git_sha:     gitSha,
    summary:     gitSummary,
    captured_at: now,
    token_est:   getTokenEstimate(gitSummary),
  });

  return { captured, git_sha: gitSha, timestamp: now };
}
```

---

## Phase 5 — E2 Anchor Engine

File: `src/engines/anchor.ts`

```typescript
// src/engines/anchor.ts
// E2 ANCHOR — Hash-based drift detection
// Core innovation of Context Fabric.
// Compares stored SHA256 against current file state.
// No AI inference. No heuristics. Pure measurement.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { DriftReport, StaleEntry } from '../types.js';

export function computeDrift(db: Database.Database, projectRoot: string): DriftReport {
  // ANTI-DRIFT NOTE: .prepare().all() returns unknown[] in better-sqlite3 v12.
  // Cast explicitly. Do not use .query() — it does not exist.
  const rows = db.prepare('SELECT path, sha256 FROM cf_components').all() as
    { path: string; sha256: string }[];

  const stale: StaleEntry[] = [];
  const fresh: { path: string }[] = [];

  for (const row of rows) {
    const { path: relPath, sha256: storedHash } = row;

    // Handle deleted files
    const { resolve } = await import('node:path'); // static import at top in real file
    const absPath = `${projectRoot}/${relPath}`; // use path.resolve in actual impl

    if (!existsSync(absPath)) {
      stale.push({ path: relPath, stored_sha: storedHash, current_sha: 'DELETED' });
      continue;
    }

    let content: string;
    try {
      content = readFileSync(absPath, 'utf8');
    } catch {
      // Unreadable file — treat as stale
      stale.push({ path: relPath, stored_sha: storedHash, current_sha: 'UNREADABLE' });
      continue;
    }

    const currentHash = createHash('sha256').update(content).digest('hex');

    if (currentHash === storedHash) {
      fresh.push({ path: relPath });
    } else {
      stale.push({ path: relPath, stored_sha: storedHash, current_sha: currentHash });
    }
  }

  const total = rows.length;
  const driftScore = total === 0 ? 0 : (stale.length / total) * 100;
  const severity: DriftReport['severity'] =
    driftScore < 10 ? 'LOW' : driftScore < 30 ? 'MED' : 'HIGH';

  return {
    drift_score: Math.round(driftScore * 10) / 10,
    severity,
    stale,
    fresh,
    checked_at: Date.now(),
    total_components: total,
  };
}
```

**Note:** The async import in the middle of the function above is a documentation artifact. In the actual file, resolve is imported at the top as a static ESM import. Use `import { resolve } from 'node:path'` at file top.

---

## Phase 6 — E5 Weaver (Minimal MVP)

File: `src/engines/weaver.ts`

For MVP, Weaver skips E3 and E4 entirely. It returns all components ordered by most recently captured, up to a flat limit. E3 BM25 routing and E4 token budgeting are Phase 2.

```typescript
// src/engines/weaver.ts
// E5 WEAVER — Structured briefing composition
// MVP version: flat component list, no BM25 ranking, no token budget.
// Phase 2 adds E3 Router and E4 Governor.

import type Database from 'better-sqlite3';
import type { Component, Decision, DriftReport } from '../types.js';

const MVP_COMPONENT_LIMIT = 30; // Flat limit for MVP — replace with E4 in Phase 2

export function composeBriefing(
  db:          Database.Database,
  driftReport: DriftReport,
  projectRoot: string,
): string {
  const now = new Date().toISOString();

  // Latest snapshot
  const snapshot = db.prepare(
    'SELECT summary, git_sha FROM cf_snapshots ORDER BY captured_at DESC LIMIT 1'
  ).get() as { summary: string; git_sha: string } | undefined;

  // Components — most recent first, flat limit
  const components = db.prepare(`
    SELECT path, exports, comp_type, token_est
    FROM cf_components
    ORDER BY captured_at DESC
    LIMIT ?
  `).all(MVP_COMPONENT_LIMIT) as Pick<Component, 'path' | 'exports' | 'comp_type' | 'token_est'>[];

  // Active decisions
  const decisions = db.prepare(
    "SELECT title, rationale, status FROM cf_decisions WHERE status = 'active' ORDER BY captured_at DESC"
  ).all() as Pick<Decision, 'title' | 'rationale' | 'status'>[];

  const lines: string[] = [];

  // Header
  lines.push('# Context Fabric Briefing');
  lines.push(`*Generated: ${now} | Project: ${projectRoot.split('/').pop()}*`);
  lines.push('');

  // Drift warning — injected before everything else when severity is MED or HIGH
  if (driftReport.severity !== 'LOW') {
    lines.push(`## ⚠ Drift Warning — Severity: ${driftReport.severity}`);
    lines.push('');
    lines.push(
      `**${driftReport.stale.length} of ${driftReport.total_components} stored components ` +
      `have drifted from current file state (${driftReport.drift_score.toFixed(1)}% drift score).**`
    );
    lines.push('');
    lines.push('The following files have changed since context was captured:');
    lines.push('');
    for (const entry of driftReport.stale) {
      const status = entry.current_sha === 'DELETED' ? '(deleted)' : '(modified)';
      lines.push(`- \`${entry.path}\` ${status}`);
    }
    lines.push('');
    lines.push('*AI responses about these files may be inaccurate. Recommend running `capture_context` to update.*');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Project context
  lines.push('## Project Context');
  lines.push('');
  if (snapshot) {
    lines.push(`**Latest commit:** ${snapshot.summary}`);
    lines.push(`**Git SHA:** \`${snapshot.git_sha}\``);
  }
  lines.push(`**Drift status:** ${driftReport.severity} (${driftReport.drift_score.toFixed(1)}%)`);
  lines.push(`**Components tracked:** ${driftReport.total_components}`);
  lines.push('');

  // Architecture
  if (components.length > 0) {
    lines.push('## Architecture');
    lines.push('');
    lines.push('*Note: MVP shows most recent files. Phase 2 adds BM25 relevance ranking.*');
    lines.push('');
    for (const comp of components) {
      const exportsArr: string[] = comp.exports ? JSON.parse(comp.exports) : [];
      const exportStr = exportsArr.length > 0 ? ` — exports: ${exportsArr.join(', ')}` : '';
      lines.push(`- \`${comp.path}\`${exportStr}`);
    }
    lines.push('');
  }

  // Decisions
  if (decisions.length > 0) {
    lines.push('## Decisions');
    lines.push('');
    for (const d of decisions) {
      lines.push(`### ${d.title}`);
      lines.push(d.rationale);
      lines.push('');
    }
  }

  // Budget summary — minimal for MVP
  lines.push('## Context Summary');
  lines.push('');
  lines.push(`- Components loaded: ${components.length} (of ${driftReport.total_components} stored)`);
  lines.push(`- Active decisions: ${decisions.length}`);
  lines.push('');

  return lines.join('\n');
}
```

---

## Phase 7 — MCP Tool Definitions

### 7.1 MCP Server Entry Point

File: `src/index.ts`

```typescript
// src/index.ts
// ANTI-DRIFT NOTE: MCP SDK v1.27.1 server API.
// Import paths changed from v0.x. Use these exact paths.
// Reference: https://github.com/modelcontextprotocol/typescript-sdk
//
// Server class:       @modelcontextprotocol/sdk/server/mcp.js
// Stdio transport:    @modelcontextprotocol/sdk/server/stdio.js
// DO NOT use the v0.x import paths — they no longer exist.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'node:path';
import { getDb } from './db/client.js';
import { runWatcher } from './engines/watcher.js';
import { computeDrift } from './engines/anchor.js';
import { composeBriefing } from './engines/weaver.js';

// Project root = where the MCP server is invoked from
const PROJECT_ROOT = process.cwd();
const db = getDb(PROJECT_ROOT);

const server = new McpServer({
  name: 'context-fabric',
  version: '0.1.0',
});

// ─── TOOL: capture_context ────────────────────────────────────────────────────
server.tool(
  'capture_context',
  'Manually capture current project state. Scans changed files, computes SHA256 fingerprints, and updates the context store. Runs automatically on git commit — use this for manual refresh.',
  {},   // no input required
  async () => {
    const result = runWatcher(db, PROJECT_ROOT);
    return {
      content: [{
        type: 'text' as const,
        text: [
          `Captured ${result.captured} files.`,
          `Git SHA: ${result.git_sha}`,
          `Timestamp: ${new Date(result.timestamp).toISOString()}`,
        ].join('\n'),
      }],
    };
  },
);

// ─── TOOL: check_drift ────────────────────────────────────────────────────────
server.tool(
  'check_drift',
  'Check how much stored context has drifted from current codebase state. Returns severity (LOW/MED/HIGH), drift score (0–100), and list of stale files.',
  {},
  async () => {
    const report = computeDrift(db, PROJECT_ROOT);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(report, null, 2),
      }],
    };
  },
);

// ─── TOOL: query_context ─────────────────────────────────────────────────────
server.tool(
  'query_context',
  'Retrieve project context as a structured briefing for AI agent consumption. Includes drift warnings if context has become stale. Primary tool for session start.',
  {
    query: z.string().min(1).describe('What you need context about. Can be a task description, component name, or question.'),
    include_drift_check: z.boolean().optional().default(true).describe('Check for drift and inject warnings. Default: true.'),
  },
  async ({ query, include_drift_check = true }) => {
    const driftReport = include_drift_check
      ? computeDrift(db, PROJECT_ROOT)
      : { drift_score: 0, severity: 'LOW' as const, stale: [], fresh: [], checked_at: Date.now(), total_components: 0 };

    const briefing = composeBriefing(db, driftReport, PROJECT_ROOT);

    return {
      content: [{
        type: 'text' as const,
        text: briefing,
      }],
    };
  },
);

// ─── TOOL: log_decision ───────────────────────────────────────────────────────
server.tool(
  'log_decision',
  'Record an Architecture Decision Record (ADR). Captures the decision title, rationale, and optional tags. Persisted across sessions. Loaded into every context briefing.',
  {
    title:     z.string().min(1).describe('Short name for the decision. Example: "Use SQLite over PostgreSQL"'),
    rationale: z.string().min(1).describe('Why this decision was made. Be specific.'),
    tags:      z.array(z.string()).optional().describe('Optional tags for categorisation.'),
  },
  async ({ title, rationale, tags }) => {
    db.prepare(`
      INSERT INTO cf_decisions (title, rationale, status, captured_at, tags)
      VALUES (@title, @rationale, 'active', @captured_at, @tags)
    `).run({
      title,
      rationale,
      captured_at: Date.now(),
      tags: tags && tags.length > 0 ? JSON.stringify(tags) : null,
    });

    return {
      content: [{
        type: 'text' as const,
        text: `Decision logged: "${title}"`,
      }],
    };
  },
);

// ─── START ────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until process exits — stdio transport keeps it alive
}

main().catch((err) => {
  console.error('Context Fabric MCP server error:', err);
  process.exit(1);
});
```

---

## Phase 8 — CLI Entry Point

File: `src/cli.ts`

The CLI handles `npx context-fabric init` and `npx context-fabric capture`.

```typescript
// src/cli.ts

import { existsSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { getDb } from './db/client.js';
import { runWatcher } from './engines/watcher.js';

const [,, command, ...args] = process.argv;
const PROJECT_ROOT = process.cwd();

switch (command) {

  case 'init': {
    console.log('Initialising Context Fabric...');

    // 1. Init database
    const db = getDb(PROJECT_ROOT);
    console.log('  ✓ Database initialised: .context-fabric/cf.db');

    // 2. Install git post-commit hook
    const gitDir = join(PROJECT_ROOT, '.git');
    if (!existsSync(gitDir)) {
      console.error('  ✗ No .git directory found. Run from the root of a git repository.');
      process.exit(1);
    }

    const hookPath = join(gitDir, 'hooks', 'post-commit');
    const hookContent = `#!/bin/sh\nnpx context-fabric capture --silent\n`;

    if (existsSync(hookPath)) {
      console.log('  ⚠ post-commit hook already exists. Skipping. Add manually:');
      console.log('    npx context-fabric capture --silent');
    } else {
      writeFileSync(hookPath, hookContent, 'utf8');
      chmodSync(hookPath, '755');
      console.log('  ✓ git post-commit hook installed');
    }

    // 3. Add .context-fabric to .gitignore
    const gitignorePath = join(PROJECT_ROOT, '.gitignore');
    const entry = '\n# Context Fabric\n.context-fabric/\n';
    if (existsSync(gitignorePath)) {
      const existing = require('node:fs').readFileSync(gitignorePath, 'utf8');
      if (!existing.includes('.context-fabric')) {
        require('node:fs').appendFileSync(gitignorePath, entry);
        console.log('  ✓ .context-fabric/ added to .gitignore');
      }
    } else {
      writeFileSync(gitignorePath, entry);
      console.log('  ✓ .gitignore created with .context-fabric/ entry');
    }

    // 4. Initial capture
    const result = runWatcher(db, PROJECT_ROOT);
    console.log(`  ✓ Initial capture: ${result.captured} files`);

    console.log('\nContext Fabric is ready.');
    console.log('MCP server config for Claude Code / Cursor / Windsurf:');
    console.log('');
    console.log('  {');
    console.log('    "mcpServers": {');
    console.log('      "context-fabric": {');
    console.log('        "command": "npx",');
    console.log('        "args": ["context-fabric"]');
    console.log('      }');
    console.log('    }');
    console.log('  }');
    console.log('');
    break;
  }

  case 'capture': {
    const silent = args.includes('--silent');
    const db = getDb(PROJECT_ROOT);
    const result = runWatcher(db, PROJECT_ROOT);
    if (!silent) {
      console.log(`Captured ${result.captured} files. SHA: ${result.git_sha}`);
    }
    break;
  }

  default: {
    console.log('Context Fabric — AI Project Continuity Infrastructure');
    console.log('');
    console.log('Commands:');
    console.log('  npx context-fabric init       Initialise in current git repo');
    console.log('  npx context-fabric capture    Manual context capture');
    break;
  }
}
```

---

## Phase 9 — MCP Configuration for AI Tools

This is what the developer adds to their AI coding tool config after `init`.

### Claude Code

File: `.claude/settings.json` (project-level) or `~/.claude/settings.json` (global)

```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "npx",
      "args": ["context-fabric"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

### Cursor

File: `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "npx",
      "args": ["context-fabric"]
    }
  }
}
```

### Windsurf

File: `~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "npx",
      "args": ["context-fabric"]
    }
  }
}
```

**AI tool guardrail:** These config paths change between IDE versions. Before writing any config file, verify the current path against the tool's official documentation. Do not use training memory for config file locations.

---

## Build Sequence

Execute in this exact order. Do not skip steps.

```
Step 1   npm init (use package.json above exactly)
Step 2   npm install
Step 3   Write src/types.ts
Step 4   Write src/db/schema.ts
Step 5   Write src/db/client.ts
Step 6   npm run build — verify TypeScript compiles with zero errors
Step 7   Write src/engines/watcher.ts
Step 8   npm run build — verify
Step 9   Write src/engines/anchor.ts
Step 10  npm run build — verify
Step 11  Write src/engines/weaver.ts
Step 12  npm run build — verify
Step 13  Write src/tools/* (all four tools)
Step 14  Write src/index.ts (MCP server)
Step 15  npm run build — verify
Step 16  Write src/cli.ts
Step 17  npm run build — final clean build
Step 18  node dist/cli.js init (test on a real repo)
Step 19  Make a commit — verify hook fires silently
Step 20  Modify a file without committing — run check_drift
         Expect: severity HIGH, modified file in stale list
Step 21  Run query_context
         Expect: briefing with drift warning section at top
```

---

## Verification Checklist

Run after every `npm run build` succeeds.

```
□  TypeScript strict mode — zero errors, zero warnings
□  No any types that are not explicitly cast
□  All imports use .js extensions (ESM requirement)
□  No async/await on better-sqlite3 calls
□  DriftReport.severity is 'LOW' | 'MED' | 'HIGH' — not lowercase
□  SHA256 computed with createHash('sha256') from 'node:crypto' — not a library
□  FTS5 trigger SQL uses 'delete' string (lowercase) for delete operations
□  Token estimate uses Math.ceil(content.length / 3.5) — not hardcoded per-model
□  post-commit hook has chmod 755 — otherwise git will not execute it
□  .context-fabric/ is in .gitignore — database must not be committed
□  MCP server uses StdioServerTransport — not SSEServerTransport
□  McpServer imported from /server/mcp.js — not from /index.js
```

---

## What to Do When an AI Tool Suggests Something Different

If an AI coding tool suggests any of the following, reject it and ask the tool to verify against the current documentation:

| AI suggestion | Why to reject | Correct approach |
|---|---|---|
| `import { Server } from '@modelcontextprotocol/sdk'` | Old v0.x import path | `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'` |
| `new Server({ name, version }, { capabilities })` | v0.x constructor signature | `new McpServer({ name, version })` |
| `server.setRequestHandler(...)` | v0.x API | `server.tool(name, description, schema, handler)` |
| `db.query(...)` | Does not exist in better-sqlite3 | `db.prepare(sql).all()` |
| `await db.prepare(...).run()` | better-sqlite3 is synchronous | `db.prepare(...).run()` (no await) |
| `z.string().nonempty()` | Deprecated in Zod v4 | `z.string().min(1)` |
| `SSEServerTransport` | Phase 2 only, not MVP | `StdioServerTransport` |
| `ORDER BY bm25(...) DESC` | FTS5 BM25 returns negative scores — lower is more relevant | `ORDER BY bm25(...)` (no DESC) |
| Any vector / embedding API | Out of scope for Phase 1 entirely | FTS5 BM25 only |

---

## Post-MVP: Phase 2 Additions

Do not build these in MVP. Document them here so the architecture does not close off the path.

```
E3 Router       →  Replace flat component list in Weaver with FTS5 BM25 ranked query
                   Add query parameter to SELECT with MATCH clause
                   Add column weights: bm25(cf_search, 2.0, 1.0)

E4 Governor     →  Add greedy token budget selection on E3 output
                   Default ceiling: Math.floor(modelContextTokens * 0.08)
                   Report used_tokens and budget_tokens in briefing

list_components →  Add MCP tool to inspect stored components
get_decisions   →  Add MCP tool to query ADR history
get_snapshot    →  Add MCP tool to retrieve session snapshots

StreamableHTTP  →  Replace stdio transport for team/remote use cases
VS Code Ext.    →  UI wrapper around CLI init + drift status indicator
```

---

*Author: Vikas Sahani — North Star Hunter*  
*Document Type: Engineering Build Plan*  
*Product: Context Fabric — AI Project Continuity Infrastructure*  
*MVP Scope: E1 Watcher + E2 Anchor + E5 Weaver (minimal)*  
*Stack: TypeScript 5.5 + MCP SDK 1.27.1 + better-sqlite3 12.8.0 + Zod 4.3.6 + Node.js 22 LTS*  
*March 2026*  
