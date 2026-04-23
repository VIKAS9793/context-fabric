// src/engines/watcher.ts
// E1 WATCHER — Commit-accurate project state capture.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { extname } from 'node:path';
import type Database from 'better-sqlite3';
import type { CaptureResult, CaptureRun } from '../types.js';
import { PathGuard } from '../security/path-guard.js';
import { sanitiseLabel, sanitiseRepoText } from '../security/injection-guard.js';
import { ensureWritableDb } from '../db/client.js';

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

const INLINE_CAPTURE_MAX_FILES = 500;
const INLINE_CAPTURE_MAX_BYTES = 32 * 1024 * 1024;
const MAX_INDEXABLE_BYTES = 256 * 1024;
const MAX_SUMMARY_SCAN_BYTES = 16 * 1024;
const MAX_OUTLINE_CHARS = 1200;
const MAX_OUTLINE_SIGNATURES = 20;
const BLOB_BATCH_SIZE = 200;

type GitMode = 'full' | 'incremental';
type GitChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

interface GitChange {
  type: GitChangeType;
  path: string;
  previousPath?: string;
}

interface CapturePlan {
  mode: GitMode;
  git_sha: string;
  changes: GitChange[];
}

interface PreparedComponent {
  path: string;
  sha256: string;
  exports: string | null;
  file_summary: string | null;
  outline: string | null;
  comp_type: string;
  token_est: number;
  skipped_reason: string | null;
}

interface PreparationResult {
  components: PreparedComponent[];
  indexed_bytes: number;
  skipped_summary: Record<string, number>;
}

interface BlobRead {
  spec: string;
  size: number;
  buffer: Buffer | null;
}

interface HeadReconcileResult {
  capture_id: number | null;
  warning: string | null;
}

// SECURITY: Never invoke git through a shell — all callers pass hardcoded
// argv arrays. `spawnSync` with `shell: false` (default) means arguments are
// passed directly to execve(2); no metacharacter interpretation is possible.
// Additionally we disable external credential helpers, hooks, and any per-
// repo git aliases so an attacker with repo write access cannot hijack git
// invocations made by the MCP server or post-commit runner.
const GIT_HARDENED_CONFIG: readonly string[] = [
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.alternateRefsCommand=',
  '-c', 'protocol.ext.allow=never',
  '-c', 'protocol.file.allow=never',
  '-c', 'uploadpack.allowFilter=false',
  '-c', 'credential.helper=',
];

function git(args: string[]): string[] {
  return [...GIT_HARDENED_CONFIG, ...args];
}

function runGit(args: string[], cwd: string): string {
  const result = spawnSync('git', git(args), {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || '').trim() || `git ${args.join(' ')} failed`);
  }

  return result.stdout;
}

function runGitBuffer(args: string[], cwd: string, input?: string): Buffer {
  const result = spawnSync('git', git(args), {
    cwd,
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });

  if (result.status !== 0 || !result.stdout) {
    const stderr = result.stderr instanceof Buffer ? result.stderr.toString('utf8') : String(result.stderr ?? '');
    throw new Error(stderr.trim() || `git ${args.join(' ')} failed`);
  }

  return result.stdout as Buffer;
}

function runGitNullSeparated(args: string[], cwd: string): string[] {
  const output = runGit(args, cwd);
  return output
    .split('\0')
    .map(token => token.replace(/\r/g, ''))
    .filter(Boolean);
}

function shouldSkip(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return true;
  const parts = filePath.split('/');
  return parts.some(part => SKIP_DIRS.has(part));
}

function incrementSummary(summary: Record<string, number>, reason: string): void {
  summary[reason] = (summary[reason] ?? 0) + 1;
}

function extractExports(content: string, filePath: string): string[] {
  const exports: string[] = [];
  const ext = extname(filePath).toLowerCase();
  if (!['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'].includes(ext)) return exports;

  const namedPattern = /^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+(\w+)/gm;
  let match: RegExpExecArray | null;
  while ((match = namedPattern.exec(content)) !== null) {
    exports.push(match[1]);
  }

  const reexportPattern = /^export\s*\{\s*([^}]+)\}/gm;
  while ((match = reexportPattern.exec(content)) !== null) {
    const names = match[1]
      .split(',')
      .map(token => token.split(/\s+as\s+/i)[0]?.trim())
      .filter(Boolean);
    exports.push(...names as string[]);
  }

  const defaultIdent = /^export\s+default\s+(\w+)/m.exec(content);
  if (defaultIdent) exports.push(`default:${defaultIdent[1]}`);

  return [...new Set(exports)];
}

function extractFileSummary(content: string): string | null {
  const single = /\/\*\*\s*@(?:fileoverview|file)\s+([^*]+?)\s*\*\//s.exec(content);
  if (single) return single[1].replace(/\s+/g, ' ').trim().slice(0, 300);

  const multi = /\/\*\*[\s\S]*?@(?:fileoverview|file)\s+([\s\S]*?)(?:\n\s*\*\s*@|\*\/)/.exec(content);
  if (!multi) return null;

  return multi[1]
    .split('\n')
    .map(line => line.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim()
    .slice(0, 300);
}

function normaliseExportSignature(line: string): string | null {
  const trimmed = line.replace(/\/\/.*$/, '').trim();
  if (!trimmed.startsWith('export')) return null;

  let match = /^export\s+(default\s+)?(async\s+)?(function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/.exec(trimmed);
  if (match) {
    const defaultPrefix = match[1] ? 'default ' : '';
    const asyncPrefix = match[2] ? 'async ' : '';
    return `export ${defaultPrefix}${asyncPrefix}${match[3]} ${match[4]}`.trim();
  }

  match = /^export\s+(default\s+)?(const|let|var)\s+([A-Za-z0-9_$]+)/.exec(trimmed);
  if (match) {
    const defaultPrefix = match[1] ? 'default ' : '';
    return `export ${defaultPrefix}${match[2]} ${match[3]}`.trim();
  }

  match = /^export\s*\{\s*([^}]+)\}/.exec(trimmed);
  if (match) {
    return `export { ${match[1].replace(/\s+/g, ' ').trim()} }`;
  }

  match = /^export\s+default\s+([A-Za-z0-9_$]+)/.exec(trimmed);
  if (match) {
    return `export default ${match[1]}`;
  }

  return null;
}

function buildOutline(
  summary: string | null,
  content: string,
): string | null {
  const signatures: string[] = [];

  for (const line of content.split('\n')) {
    const signature = normaliseExportSignature(line);
    if (!signature) continue;
    const sanitised = sanitiseLabel(signature, 140);
    if (!sanitised || signatures.includes(sanitised)) continue;
    signatures.push(sanitised);
    if (signatures.length >= MAX_OUTLINE_SIGNATURES) break;
  }

  const parts: string[] = [];
  if (summary) parts.push(summary);
  if (signatures.length > 0) parts.push(...signatures);
  if (parts.length === 0) return null;

  const outline = sanitiseRepoText(parts.join('\n'), MAX_OUTLINE_CHARS);
  return outline || null;
}

function getTokenEstimate(byteLength: number): number {
  return Math.ceil(byteLength / 3.5);
}

function parseNameStatus(tokens: string[]): GitChange[] {
  const changes: GitChange[] = [];
  let index = 0;

  while (index < tokens.length) {
    const statusToken = tokens[index++];
    if (!statusToken) continue;

    const code = statusToken[0];
    if (code === 'R' || code === 'C') {
      const previousPath = tokens[index++];
      const nextPath = tokens[index++];
      if (previousPath && nextPath) {
        changes.push({ type: 'renamed', path: nextPath, previousPath });
      }
      continue;
    }

    const path = tokens[index++];
    if (!path) continue;

    if (code === 'A') changes.push({ type: 'added', path });
    else if (code === 'D') changes.push({ type: 'deleted', path });
    else changes.push({ type: 'modified', path });
  }

  return changes;
}

function filterSafeChanges(projectRoot: string, changes: GitChange[]): GitChange[] {
  const guard = new PathGuard(projectRoot);
  const safe: GitChange[] = [];

  for (const change of changes) {
    try {
      guard.validate(change.path);
      if (change.previousPath) guard.validate(change.previousPath);
      safe.push(change);
    } catch {
      process.stderr.write(`[CF SECURITY] Change rejected: ${change.previousPath ?? change.path}\n`);
    }
  }

  return safe;
}

// SECURITY: Git refs flow in from `git rev-parse HEAD` and user-facing tool
// calls. We validate that refs are 40- or 64-character lowercase hex before
// passing them as arguments, and additionally prepend `--end-of-options` so
// a ref such as `--upload-pack=...` cannot be interpreted as a git flag.
const SHA_PATTERN = /^[0-9a-f]{4,64}$/;

function assertGitRef(sha: string, label: string): void {
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(`SECURITY: Invalid ${label} ref: "${sha}"`);
  }
}

function getLastCommitChanges(projectRoot: string, gitSha: string): GitChange[] {
  assertGitRef(gitSha, 'commit');
  const tokens = runGitNullSeparated(
    ['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', '--root', '--find-renames', '--end-of-options', gitSha],
    projectRoot,
  );
  return filterSafeChanges(projectRoot, parseNameStatus(tokens));
}

function getDiffChanges(projectRoot: string, baseSha: string, targetSha: string): GitChange[] {
  assertGitRef(baseSha, 'base');
  assertGitRef(targetSha, 'target');
  const tokens = runGitNullSeparated(
    ['diff', '--name-status', '-r', '-z', '--find-renames', '--end-of-options', baseSha, targetSha],
    projectRoot,
  );
  return filterSafeChanges(projectRoot, parseNameStatus(tokens));
}

function getFullCaptureChanges(projectRoot: string): GitChange[] {
  const files = runGitNullSeparated(['ls-files', '-z'], projectRoot);
  const guard = new PathGuard(projectRoot);
  return guard.validateBatch(files).map(path => ({ type: 'added' as const, path }));
}

export function getGitSha(projectRoot: string): string {
  try {
    const sha = runGit(['rev-parse', '--verify', '--end-of-options', 'HEAD'], projectRoot).trim();
    return SHA_PATTERN.test(sha) ? sha : 'unknown';
  } catch {
    return 'unknown';
  }
}

function readBatchSizes(
  projectRoot: string,
  specs: string[],
): number[] {
  if (specs.length === 0) return [];
  const raw = runGitBuffer(['cat-file', '--batch-check'], projectRoot, `${specs.join('\n')}\n`)
    .toString('utf8')
    .trimEnd()
    .split('\n');

  return raw.map(line => {
    const match = /^(?:[0-9a-f]+)\s+\w+\s+(\d+)$/.exec(line.trim());
    return match ? Number(match[1]) : 0;
  });
}

function readBlobs(
  projectRoot: string,
  specs: string[],
): BlobRead[] {
  if (specs.length === 0) return [];
  const output = runGitBuffer(['cat-file', '--batch'], projectRoot, `${specs.join('\n')}\n`);
  const reads: BlobRead[] = [];
  let offset = 0;

  for (const spec of specs) {
    const lineEnd = output.indexOf(0x0a, offset);
    if (lineEnd === -1) throw new Error('Malformed git cat-file --batch response');
    const header = output.subarray(offset, lineEnd).toString('utf8').replace(/\r/g, '');
    offset = lineEnd + 1;

    if (header.endsWith(' missing')) {
      reads.push({ spec, size: 0, buffer: null });
      continue;
    }

    const match = /^([0-9a-f]+)\s+\w+\s+(\d+)$/.exec(header);
    if (!match) {
      throw new Error(`Malformed git batch header: ${header}`);
    }

    const size = Number(match[2]);
    const buffer = output.subarray(offset, offset + size);
    offset += size;
    if (output[offset] === 0x0a) offset += 1;
    reads.push({ spec, size, buffer });
  }

  return reads;
}

function getLatestSuccessfulCapture(
  db: Database.Database,
): Pick<CaptureRun, 'id' | 'git_sha' | 'completed_at'> | undefined {
  return db.prepare(`
    SELECT id, git_sha, completed_at
    FROM cf_capture_runs
    WHERE status = 'succeeded'
    ORDER BY completed_at DESC, id DESC
    LIMIT 1
  `).get() as Pick<CaptureRun, 'id' | 'git_sha' | 'completed_at'> | undefined;
}

function getPendingCaptureForSha(
  db: Database.Database,
  gitSha: string,
): Pick<CaptureRun, 'id'> | undefined {
  return db.prepare(`
    SELECT id
    FROM cf_capture_runs
    WHERE git_sha = ?
      AND status = 'pending'
    ORDER BY id DESC
    LIMIT 1
  `).get(gitSha) as Pick<CaptureRun, 'id'> | undefined;
}

function isAncestor(projectRoot: string, ancestorSha: string, descendantSha: string): boolean {
  if (!SHA_PATTERN.test(ancestorSha) || !SHA_PATTERN.test(descendantSha)) {
    return false;
  }
  const result = spawnSync(
    'git',
    git(['merge-base', '--is-ancestor', '--end-of-options', ancestorSha, descendantSha]),
    {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    },
  );
  return result.status === 0;
}

function createPlanFromLatestCapture(
  db: Database.Database,
  projectRoot: string,
  targetSha: string,
): CapturePlan {
  const latest = getLatestSuccessfulCapture(db);
  if (!latest || latest.git_sha === 'unknown') {
    return {
      mode: 'full',
      git_sha: targetSha,
      changes: getFullCaptureChanges(projectRoot),
    };
  }

  if (latest.git_sha === targetSha) {
    return {
      mode: 'incremental',
      git_sha: targetSha,
      changes: [],
    };
  }

  if (!isAncestor(projectRoot, latest.git_sha, targetSha)) {
    return {
      mode: 'full',
      git_sha: targetSha,
      changes: getFullCaptureChanges(projectRoot),
    };
  }

  return {
    mode: 'incremental',
    git_sha: targetSha,
    changes: getDiffChanges(projectRoot, latest.git_sha, targetSha),
  };
}

function readCommitSummary(projectRoot: string, gitSha: string): string {
  if (!SHA_PATTERN.test(gitSha)) {
    return sanitiseLabel(gitSha, 200);
  }
  const summary = runGit(
    ['log', '-1', '--format=%h %s', '--end-of-options', gitSha],
    projectRoot,
  ).trim();
  return sanitiseLabel(summary || gitSha, 200);
}

function createPendingCaptureRun(
  db: Database.Database,
  gitSha: string,
  changedFiles: number,
): number {
  const existing = getPendingCaptureForSha(db, gitSha);
  if (existing) return existing.id;

  const result = db.prepare(`
    INSERT INTO cf_capture_runs (
      git_sha, status, mode, started_at, completed_at,
      changed_files, indexed_files, indexed_bytes,
      skipped_count, skipped_summary, error_message
    ) VALUES (
      @git_sha, 'pending', 'hook-deferred', @started_at, NULL,
      @changed_files, 0, 0,
      0, '{}', NULL
    )
  `).run({
    git_sha: gitSha,
    started_at: Date.now(),
    changed_files: changedFiles,
  });

  return Number(result.lastInsertRowid);
}

function beginCaptureRun(
  db: Database.Database,
  gitSha: string,
  mode: GitMode,
  changedFiles: number,
): number {
  const pending = getPendingCaptureForSha(db, gitSha);
  if (pending) {
    db.prepare(`
      UPDATE cf_capture_runs
      SET status = 'running',
          mode = @mode,
          started_at = @started_at,
          completed_at = NULL,
          changed_files = @changed_files,
          error_message = NULL
      WHERE id = @id
    `).run({
      id: pending.id,
      mode,
      started_at: Date.now(),
      changed_files: changedFiles,
    });
    return pending.id;
  }

  const result = db.prepare(`
    INSERT INTO cf_capture_runs (
      git_sha, status, mode, started_at, completed_at,
      changed_files, indexed_files, indexed_bytes,
      skipped_count, skipped_summary, error_message
    ) VALUES (
      @git_sha, 'running', @mode, @started_at, NULL,
      @changed_files, 0, 0,
      0, '{}', NULL
    )
  `).run({
    git_sha: gitSha,
    mode,
    started_at: Date.now(),
    changed_files: changedFiles,
  });

  return Number(result.lastInsertRowid);
}

function finishCaptureRunSuccess(
  db: Database.Database,
  runId: number,
  stats: {
    changed_files: number;
    indexed_files: number;
    indexed_bytes: number;
    skipped_summary: Record<string, number>;
  },
): void {
  const skippedCount = Object.values(stats.skipped_summary)
    .reduce((sum, count) => sum + count, 0);

  db.prepare(`
    UPDATE cf_capture_runs
    SET status = 'succeeded',
        completed_at = @completed_at,
        changed_files = @changed_files,
        indexed_files = @indexed_files,
        indexed_bytes = @indexed_bytes,
        skipped_count = @skipped_count,
        skipped_summary = @skipped_summary,
        error_message = NULL
    WHERE id = @id
  `).run({
    id: runId,
    completed_at: Date.now(),
    changed_files: stats.changed_files,
    indexed_files: stats.indexed_files,
    indexed_bytes: stats.indexed_bytes,
    skipped_count: skippedCount,
    skipped_summary: JSON.stringify(stats.skipped_summary),
  });
}

function finishCaptureRunFailure(
  db: Database.Database,
  runId: number,
  error: unknown,
): void {
  const message = sanitiseLabel(
    error instanceof Error ? error.message : String(error),
    300,
  );
  db.prepare(`
    UPDATE cf_capture_runs
    SET status = 'failed',
        completed_at = @completed_at,
        error_message = @error_message
    WHERE id = @id
  `).run({
    id: runId,
    completed_at: Date.now(),
    error_message: message,
  });
}

function prepareComponents(
  projectRoot: string,
  gitSha: string,
  paths: string[],
): PreparationResult {
  const components: PreparedComponent[] = [];
  const skippedSummary: Record<string, number> = {};
  let indexedBytes = 0;

  for (let offset = 0; offset < paths.length; offset += BLOB_BATCH_SIZE) {
    const chunk = paths.slice(offset, offset + BLOB_BATCH_SIZE);
    const eligible = chunk.filter(path => {
      if (shouldSkip(path)) {
        incrementSummary(skippedSummary, 'unsupported-path');
        return false;
      }
      return true;
    });

    const specs = eligible.map(path => `${gitSha}:${path}`);
    const reads = readBlobs(projectRoot, specs);

    for (let index = 0; index < eligible.length; index++) {
      const path = eligible[index];
      const read = reads[index];
      if (!read || !read.buffer) {
        incrementSummary(skippedSummary, 'missing-blob');
        continue;
      }

      if (read.buffer.includes(0)) {
        incrementSummary(skippedSummary, 'binary');
        continue;
      }

      const sha256 = createHash('sha256').update(read.buffer).digest('hex');
      const token_est = getTokenEstimate(read.size);
      const isLarge = read.size > MAX_INDEXABLE_BYTES;
      const preview = read.buffer.subarray(0, Math.min(read.buffer.length, MAX_SUMMARY_SCAN_BYTES)).toString('utf8');
      const fileSummary = (() => {
        const extracted = extractFileSummary(isLarge ? preview : read.buffer.toString('utf8'));
        if (!extracted) return null;
        const safe = sanitiseLabel(extracted, 300);
        return safe || null;
      })();

      let exports: string[] = [];
      let outline: string | null = null;
      let skipped_reason: string | null = null;

      if (isLarge) {
        skipped_reason = 'outline-too-large';
        incrementSummary(skippedSummary, skipped_reason);
      } else {
        const text = read.buffer.toString('utf8');
        exports = extractExports(text, path);
        outline = buildOutline(fileSummary, text);
        indexedBytes += read.size;
      }

      components.push({
        path,
        sha256,
        exports: exports.length > 0 ? JSON.stringify(exports) : null,
        file_summary: fileSummary,
        outline,
        comp_type: 'file',
        token_est,
        skipped_reason,
      });
    }
  }

  return {
    components,
    indexed_bytes: indexedBytes,
    skipped_summary: skippedSummary,
  };
}

function applyCapturePlan(
  db: Database.Database,
  projectRoot: string,
  plan: CapturePlan,
): CaptureResult {
  ensureWritableDb();

  const runId = beginCaptureRun(db, plan.git_sha, plan.mode, plan.changes.length);
  const now = Date.now();
  const candidatePaths = [...new Set(plan.changes
    .filter(change => change.type !== 'deleted')
    .map(change => change.path))];

  try {
    const prepared = prepareComponents(projectRoot, plan.git_sha, candidatePaths);
    const desiredActivePaths = new Set(prepared.components.map(component => component.path));
    const explicitTombstones = new Set<string>();

    for (const change of plan.changes) {
      if (change.type === 'deleted') explicitTombstones.add(change.path);
      if (change.type === 'renamed' && change.previousPath) explicitTombstones.add(change.previousPath);
    }

    for (const path of candidatePaths) {
      if (!desiredActivePaths.has(path)) {
        explicitTombstones.add(path);
      }
    }

    const upsertComponent = db.prepare(`
      INSERT INTO cf_components (
        path, sha256, exports, file_summary, outline, comp_type,
        status, tombstoned_at, skipped_reason, captured_at,
        git_sha, token_est, last_capture_id
      ) VALUES (
        @path, @sha256, @exports, @file_summary, @outline, @comp_type,
        'active', NULL, @skipped_reason, @captured_at,
        @git_sha, @token_est, @last_capture_id
      )
      ON CONFLICT(path) DO UPDATE SET
        sha256 = excluded.sha256,
        exports = excluded.exports,
        file_summary = excluded.file_summary,
        outline = excluded.outline,
        comp_type = excluded.comp_type,
        status = 'active',
        tombstoned_at = NULL,
        skipped_reason = excluded.skipped_reason,
        captured_at = excluded.captured_at,
        git_sha = excluded.git_sha,
        token_est = excluded.token_est,
        last_capture_id = excluded.last_capture_id
    `);
    const lookupComponent = db.prepare(`
      SELECT id
      FROM cf_components
      WHERE path = ?
      LIMIT 1
    `);
    const activeRows = db.prepare(`
      SELECT id, path
      FROM cf_components
      WHERE status = 'active'
    `).all() as { id: number; path: string }[];
    const tombstoneComponent = db.prepare(`
      UPDATE cf_components
      SET status = 'tombstoned',
          tombstoned_at = @tombstoned_at,
          captured_at = @captured_at,
          git_sha = @git_sha,
          last_capture_id = @last_capture_id
      WHERE path = @path
        AND status = 'active'
    `);
    const deleteSearch = db.prepare('DELETE FROM cf_search_v2 WHERE rowid = ?');
    const insertSearch = db.prepare(`
      INSERT INTO cf_search_v2 (rowid, path, exports, file_summary, outline)
      VALUES (@rowid, @path, @exports, @file_summary, @outline)
    `);
    const upsertSnapshot = db.prepare(`
      INSERT INTO cf_snapshots (git_sha, summary, captured_at, token_est)
      VALUES (@git_sha, @summary, @captured_at, @token_est)
      ON CONFLICT(git_sha) DO UPDATE SET
        summary = excluded.summary,
        captured_at = excluded.captured_at,
        token_est = excluded.token_est
    `);

    db.transaction(() => {
      if (plan.mode === 'full') {
        for (const row of activeRows) {
          if (!desiredActivePaths.has(row.path)) {
            tombstoneComponent.run({
              path: row.path,
              tombstoned_at: now,
              captured_at: now,
              git_sha: plan.git_sha,
              last_capture_id: runId,
            });
            deleteSearch.run(row.id);
          }
        }
      } else {
        for (const path of explicitTombstones) {
          const row = lookupComponent.get(path) as { id: number } | undefined;
          if (!row) continue;
          tombstoneComponent.run({
            path,
            tombstoned_at: now,
            captured_at: now,
            git_sha: plan.git_sha,
            last_capture_id: runId,
          });
          deleteSearch.run(row.id);
        }
      }

      for (const component of prepared.components) {
        upsertComponent.run({
          ...component,
          captured_at: now,
          git_sha: plan.git_sha,
          last_capture_id: runId,
        });
        const row = lookupComponent.get(component.path) as { id: number } | undefined;
        if (!row) continue;
        deleteSearch.run(row.id);
        insertSearch.run({
          rowid: row.id,
          path: component.path,
          exports: component.exports,
          file_summary: component.file_summary,
          outline: component.outline,
        });
      }

      const summary = readCommitSummary(projectRoot, plan.git_sha);
      upsertSnapshot.run({
        git_sha: plan.git_sha,
        summary,
        captured_at: now,
        token_est: getTokenEstimate(Buffer.byteLength(summary, 'utf8')),
      });
    })();

    finishCaptureRunSuccess(db, runId, {
      changed_files: plan.changes.length,
      indexed_files: prepared.components.length,
      indexed_bytes: prepared.indexed_bytes,
      skipped_summary: prepared.skipped_summary,
    });

    return {
      captured: prepared.components.length,
      git_sha: plan.git_sha,
      timestamp: now,
      capture_id: runId,
      deferred: false,
    };
  } catch (err) {
    finishCaptureRunFailure(db, runId, err);
    throw err;
  }
}

function estimatePlanBytes(
  projectRoot: string,
  gitSha: string,
  changes: GitChange[],
): number {
  const paths = [...new Set(changes
    .filter(change => change.type !== 'deleted' && !shouldSkip(change.path))
    .map(change => change.path))];
  const specs = paths.map(path => `${gitSha}:${path}`);
  const sizes = readBatchSizes(projectRoot, specs);
  return sizes.reduce((sum, size) => sum + size, 0);
}

export function runHookCapture(
  db: Database.Database,
  projectRoot: string,
): CaptureResult {
  ensureWritableDb();

  const gitSha = getGitSha(projectRoot);
  const plan = {
    mode: 'incremental' as const,
    git_sha: gitSha,
    changes: getLastCommitChanges(projectRoot, gitSha),
  };
  const totalBytes = estimatePlanBytes(projectRoot, gitSha, plan.changes);

  if (plan.changes.length > INLINE_CAPTURE_MAX_FILES || totalBytes > INLINE_CAPTURE_MAX_BYTES) {
    const captureId = createPendingCaptureRun(db, gitSha, plan.changes.length);
    return {
      captured: 0,
      git_sha: gitSha,
      timestamp: Date.now(),
      capture_id: captureId,
      deferred: true,
    };
  }

  return applyCapturePlan(db, projectRoot, plan);
}

export function runWatcher(
  db: Database.Database,
  projectRoot: string,
): CaptureResult {
  const gitSha = getGitSha(projectRoot);
  const plan = createPlanFromLatestCapture(db, projectRoot, gitSha);
  const latest = getLatestSuccessfulCapture(db);

  if (plan.changes.length === 0 && latest) {
    return {
      captured: 0,
      git_sha: gitSha,
      timestamp: Date.now(),
      capture_id: latest.id,
      deferred: false,
    };
  }

  return applyCapturePlan(db, projectRoot, plan);
}

export function ensureHeadCaptured(
  db: Database.Database,
  projectRoot: string,
): HeadReconcileResult {
  const gitSha = getGitSha(projectRoot);
  const latest = getLatestSuccessfulCapture(db);
  const pending = getPendingCaptureForSha(db, gitSha);

  if (latest?.git_sha === gitSha && !pending) {
    return { capture_id: latest.id, warning: null };
  }

  try {
    const result = runWatcher(db, projectRoot);
    return {
      capture_id: result.capture_id ?? latest?.id ?? null,
      warning: null,
    };
  } catch (err) {
    const message = sanitiseLabel(
      err instanceof Error ? err.message : String(err),
      220,
    );
    return {
      capture_id: latest?.id ?? null,
      warning: `Context Fabric could not reconcile HEAD ${gitSha.slice(0, 12)} before query: ${message}`,
    };
  }
}

export function getLatestSuccessfulCaptureId(
  db: Database.Database,
): number | null {
  return getLatestSuccessfulCapture(db)?.id ?? null;
}
