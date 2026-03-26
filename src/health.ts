// src/health.ts

import { existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { CaptureRun, HealthReport } from './types.js';
import { getDbRuntimeState } from './db/client.js';
import { SEARCH_INDEX_VERSION } from './db/schema.js';
import { getContextFabricPaths } from './project-paths.js';

function safeParseSummary(value: string | null): Record<string, number> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getHealthReport(
  db: Database.Database,
  projectRoot: string,
): HealthReport {
  const runtime = getDbRuntimeState();
  const paths = getContextFabricPaths(projectRoot);

  try {
    const latest = db.prepare(`
      SELECT id, git_sha, completed_at, indexed_files, skipped_count, skipped_summary
      FROM cf_capture_runs
      WHERE status = 'succeeded'
      ORDER BY completed_at DESC, id DESC
      LIMIT 1
    `).get() as (Pick<CaptureRun, 'id' | 'git_sha' | 'completed_at' | 'indexed_files' | 'skipped_count'> & {
      skipped_summary: string | null;
    }) | undefined;

    const pendingCount = (db.prepare(`
      SELECT COUNT(*) AS total
      FROM cf_capture_runs
      WHERE status = 'pending'
    `).get() as { total: number }).total;

    const failedCount = (db.prepare(`
      SELECT COUNT(*) AS total
      FROM cf_capture_runs
      WHERE status = 'failed'
    `).get() as { total: number }).total;

    const indexVersion = (db.prepare(`
      SELECT value
      FROM cf_meta
      WHERE key = 'search_index_version'
      LIMIT 1
    `).get() as { value: string } | undefined)?.value;

    return {
      schema_version: runtime.schemaVersion,
      search_index_version: Number(indexVersion ?? SEARCH_INDEX_VERSION),
      db_integrity: runtime.integrity,
      degraded: runtime.degraded,
      degraded_reason: runtime.degradedReason,
      latest_successful_capture: latest
        ? {
            id: latest.id,
            git_sha: latest.git_sha,
            completed_at: latest.completed_at,
            indexed_files: latest.indexed_files,
            skipped_count: latest.skipped_count,
          }
        : null,
      pending_capture_count: pendingCount,
      failed_capture_count: failedCount,
      latest_skipped_summary: safeParseSummary(latest?.skipped_summary ?? null),
      hook_installed: existsSync(paths.gitHookPath),
      hook_runtime_ready: existsSync(paths.hookWrapperPath) && existsSync(paths.runtimeCliPath),
    };
  } catch (err) {
    return {
      schema_version: runtime.schemaVersion,
      search_index_version: SEARCH_INDEX_VERSION,
      db_integrity: runtime.integrity,
      degraded: true,
      degraded_reason: err instanceof Error ? err.message : String(err),
      latest_successful_capture: null,
      pending_capture_count: 0,
      failed_capture_count: 0,
      latest_skipped_summary: {},
      hook_installed: existsSync(paths.gitHookPath),
      hook_runtime_ready: existsSync(paths.hookWrapperPath) && existsSync(paths.runtimeCliPath),
    };
  }
}

export function formatHealthReport(report: HealthReport): string {
  const lines = [
    `Schema version: ${report.schema_version}`,
    `Search index version: ${report.search_index_version}`,
    `DB integrity: ${report.db_integrity}`,
    `Degraded mode: ${report.degraded ? 'yes' : 'no'}`,
    `Hook installed: ${report.hook_installed ? 'yes' : 'no'}`,
    `Hook runtime ready: ${report.hook_runtime_ready ? 'yes' : 'no'}`,
    `Pending captures: ${report.pending_capture_count}`,
    `Failed captures: ${report.failed_capture_count}`,
  ];

  if (report.degraded_reason) {
    lines.push(`Degraded reason: ${report.degraded_reason}`);
  }

  if (report.latest_successful_capture) {
    lines.push(
      `Latest successful capture: #${report.latest_successful_capture.id} ${report.latest_successful_capture.git_sha.slice(0, 12)}`
    );
    lines.push(`Indexed files: ${report.latest_successful_capture.indexed_files}`);
    lines.push(`Skipped files: ${report.latest_successful_capture.skipped_count}`);
  }

  const skippedEntries = Object.entries(report.latest_skipped_summary);
  if (skippedEntries.length > 0) {
    lines.push(`Latest skipped summary: ${skippedEntries.map(([reason, count]) => `${reason}=${count}`).join(', ')}`);
  }

  return lines.join('\n');
}
