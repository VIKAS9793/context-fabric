// src/engines/watcher.ts
// E1 WATCHER — Automated project state capture
// Fires on git post-commit hook. No developer action required.
//
// VERIFIED: git ls-files always outputs forward slashes on all platforms.
// VERIFIED: Windows with core.autocrlf=true produces \r\n line endings.
//           Strip \r from every line — failure silently breaks existsSync.
// Source: github.com/isaacs/node-glob/issues/419
//         git-scm.com line ending documentation

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, extname } from 'node:path';
import type Database from 'better-sqlite3';
import type { CaptureResult } from '../types.js';
import { PathGuard } from '../security/path-guard.js';

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.zip', '.tar', '.gz',
  '.lock',
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
  if (!['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'].includes(ext)) return exports;

  const namedPattern = /^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+(\w+)/gm;
  let match: RegExpExecArray | null;
  while ((match = namedPattern.exec(content)) !== null) {
    exports.push(match[1]);
  }

  const defaultIdent = /^export\s+default\s+(\w+)/m.exec(content);
  if (defaultIdent) exports.push(`default:${defaultIdent[1]}`);

  return [...new Set(exports)];
}

function getTokenEstimate(content: string): number {
  return Math.ceil(content.length / 3.5);
}

// ─── JSDOC FILE SUMMARY EXTRACTION ────────────────────────────────────────
// Extracts the first @fileoverview JSDoc comment from file content.
// No AST. No dependencies. Regex on raw content.
// Verified: @fileoverview is standard JSDoc.
// Source: tsdoc.org, jsdoc.app/tags-file

function extractFileSummary(content: string): string | null {
  // Single-line: /** @fileoverview text */
  const single = /\/\*\*\s*@(?:fileoverview|file)\s+([^*]+?)\s*\*\//s
    .exec(content);
  if (single) return single[1].replace(/\s+/g, ' ').trim().slice(0, 300);

  // Multi-line: /** ... @fileoverview text ... */
  const multi = /\/\*\*[\s\S]*?@(?:fileoverview|file)\s+([\s\S]*?)(?:\n\s*\*\s*@|\*\/)/
    .exec(content);
  if (multi) {
    return multi[1]
      .split('\n')
      .map(l => l.replace(/^\s*\*\s?/, '').trim())
      .filter(Boolean)
      .join(' ')
      .trim()
      .slice(0, 300);
  }

  return null;
}

// ─── GIT OPERATIONS ───────────────────────────────────────────────────────
// spawnSync — not execSync — never passes args through a shell.
// execSync with string args is vulnerable to injection if args are ever
// derived from user input. spawnSync passes args directly to the process.

type GitMode = 'full' | 'incremental';

function runGit(args: string[], cwd: string): string[] {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio:    ['pipe', 'pipe', 'pipe'],
  });

  if (result.status !== 0 || !result.stdout) return [];

  return result.stdout
    .split('\n')
    .map(line => line.replace(/\r/g, ''))   // strip \r — Windows CRLF safety
    .filter(Boolean);
}

export function getChangedFiles(projectRoot: string, mode: GitMode): string[] {
  if (mode === 'full') {
    // Initial capture: walk the entire tracked tree.
    // git ls-files lists every file tracked by the index.
    // This is the correct command for a first-time full scan.
    return runGit(['ls-files'], projectRoot);
  }

  // Incremental: files changed in the most recent commit.
  const incremental = runGit(['diff', '--name-only', 'HEAD~1', 'HEAD'], projectRoot);
  if (incremental.length > 0) return incremental;

  // Fallback for the first commit: HEAD~1 does not exist.
  // git show --name-only --format="" HEAD lists files in the first commit.
  const firstCommit = runGit(['show', '--name-only', '--format=', 'HEAD'], projectRoot);
  return firstCommit;
}

export function getGitSha(projectRoot: string): string {
  const result = runGit(['rev-parse', 'HEAD'], projectRoot);
  return result.length > 0 ? result[0] : 'unknown';
}

export function runWatcher(db: Database.Database, projectRoot: string): CaptureResult {
  const guard = new PathGuard(projectRoot);
  const gitSha = getGitSha(projectRoot);

  // Determine capture mode: full if database is empty, incremental otherwise.
  // The database itself is the state — no flag files, no special markers.
  const hasExistingData = (db
    .prepare('SELECT COUNT(*) as n FROM cf_components')
    .get() as { n: number }).n > 0;

  const mode: GitMode = hasExistingData ? 'incremental' : 'full';
  const allChangedFiles = getChangedFiles(projectRoot, mode);
  
  // SECURITY (Doc 06 Part 3.1): Run validateBatch before reading
  const changedFiles = guard.validateBatch(allChangedFiles);
  
  const now = Date.now();
  let captured = 0;

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO cf_components
      (path, sha256, exports, file_summary, comp_type, captured_at, git_sha, token_est)
    VALUES
      (@path, @sha256, @exports, @file_summary, @comp_type, @captured_at, @git_sha, @token_est)
  `);

  const batchUpsert = db.transaction((files: string[]) => {
    for (const relPath of files) {
      if (shouldSkip(relPath)) continue;

      // Duplicate check: already validated by validateBatch, but resolve safely
      const absPath = resolve(projectRoot, relPath);
      if (!existsSync(absPath)) continue;

      let content: string;
      try {
        content = readFileSync(absPath, 'utf8');
      } catch { continue; }

      const sha256 = createHash('sha256').update(content).digest('hex');
      const exports = extractExports(content, relPath);
      const tokenEst = getTokenEstimate(content);

      upsert.run({
        path:         relPath,
        sha256,
        exports:      exports.length > 0 ? JSON.stringify(exports) : null,
        file_summary: extractFileSummary(content),
        comp_type:    'file',
        captured_at:  now,
        git_sha:      gitSha,
        token_est:    tokenEst,
      });
      captured++;
    }
  });

  batchUpsert(changedFiles);

  const gitSummary = (() => {
    const lines = runGit(['log', '-1', '--oneline'], projectRoot);
    return lines.length > 0 ? lines[0] : gitSha;
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
