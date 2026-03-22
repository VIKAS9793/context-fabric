// src/engines/watcher.ts
// E1 WATCHER — Automated project state capture
// Fires on git post-commit hook. No developer action required.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
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

function getChangedFiles(projectRoot: string): string[] {
  try {
    const result = execSync('git diff --name-only HEAD~1 HEAD', {
      cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim().split('\n').filter(Boolean);
  } catch {
    try {
      const result = execSync('git diff --name-only --cached', {
        cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result.trim().split('\n').filter(Boolean);
    } catch { return []; }
  }
}

export function getGitSha(projectRoot: string): string {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch { return 'unknown'; }
}

export function runWatcher(db: Database.Database, projectRoot: string): CaptureResult {
  const guard = new PathGuard(projectRoot);
  const gitSha = getGitSha(projectRoot);
  const allChangedFiles = getChangedFiles(projectRoot);
  
  // SECURITY (Doc 06 Part 3.1): Run validateBatch before reading
  const changedFiles = guard.validateBatch(allChangedFiles);
  
  const now = Date.now();
  let captured = 0;

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO cf_components
      (path, sha256, exports, comp_type, captured_at, git_sha, token_est)
    VALUES
      (@path, @sha256, @exports, @comp_type, @captured_at, @git_sha, @token_est)
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
