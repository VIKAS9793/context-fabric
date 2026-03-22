// src/engines/anchor.ts
// E2 ANCHOR — Hash-based drift detection
// Compares stored SHA256 against current file state.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { DriftReport, StaleEntry } from '../types.js';
import { PathGuard } from '../security/path-guard.js';

export function computeDrift(db: Database.Database, projectRoot: string): DriftReport {
  const guard = new PathGuard(projectRoot);
  const rows = db.prepare('SELECT path, sha256 FROM cf_components').all() as
    { path: string; sha256: string }[];

  const stale: StaleEntry[] = [];
  const fresh: { path: string }[] = [];

  for (const row of rows) {
    const { path: relPath, sha256: storedHash } = row;

    let absPath: string;
    try {
      // SECURITY (Doc 06 Part 8): Validate path before read
      absPath = guard.validate(relPath);
    } catch {
      stale.push({ path: relPath, stored_sha: storedHash, current_sha: 'TRAVERSAL_REJECTED' });
      continue;
    }

    if (!existsSync(absPath)) {
      stale.push({ path: relPath, stored_sha: storedHash, current_sha: 'DELETED' });
      continue;
    }

    let content: string;
    try {
      content = readFileSync(absPath, 'utf8');
    } catch {
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
