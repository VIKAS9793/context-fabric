// src/engines/anchor.ts
// E2 ANCHOR — Hash-based drift detection
// Compares stored SHA256 against current file state.

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { DriftReport, StaleEntry } from '../types.js';
import { PathGuard } from '../security/path-guard.js';

// Hard cap on the per-file size we will read into memory for drift hashing.
// Prevents a pathological multi-gigabyte file from OOMing the drift check.
// Matches the effective upper bound the Watcher already treats as "too big
// to index" plus generous headroom for text files that still pass indexing.
const MAX_DRIFT_BYTES = 64 * 1024 * 1024; // 64 MiB

export function computeDrift(db: Database.Database, projectRoot: string): DriftReport {
  const guard = new PathGuard(projectRoot);
  const rows = db.prepare(`
    SELECT path, sha256
    FROM cf_components
    WHERE status = 'active'
  `).all() as
    { path: string; sha256: string }[];

  const stale: StaleEntry[] = [];
  const fresh: { path: string }[] = [];

  for (const row of rows) {
    const { path: relPath, sha256: storedHash } = row;

    let absPath: string;
    try {
      // SECURITY: Validate path before read. resolveSymlinks prevents a
      // symlink placed under the project root from redirecting the read
      // outside the project root.
      absPath = guard.validate(relPath, { resolveSymlinks: true });
    } catch {
      stale.push({ path: relPath, stored_sha: storedHash, current_sha: 'TRAVERSAL_REJECTED' });
      continue;
    }

    let size: number;
    try {
      const stats = statSync(absPath);
      if (!stats.isFile()) {
        stale.push({ path: relPath, stored_sha: storedHash, current_sha: 'DELETED' });
        continue;
      }
      size = stats.size;
    } catch {
      stale.push({ path: relPath, stored_sha: storedHash, current_sha: 'DELETED' });
      continue;
    }

    if (size > MAX_DRIFT_BYTES) {
      stale.push({ path: relPath, stored_sha: storedHash, current_sha: 'OVERSIZE' });
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = readFileSync(absPath);
    } catch {
      stale.push({ path: relPath, stored_sha: storedHash, current_sha: 'UNREADABLE' });
      continue;
    }

    // Hash the raw bytes — the Watcher hashes the raw git blob buffer, so
    // Anchor must do the same. Hashing a utf-8 decoded string would
    // mis-report drift for any content that isn't pure ASCII (BOM-prefixed
    // files, CRLF-normalised checkouts, non-utf-8 encodings, binaries).
    const currentHash = createHash('sha256').update(buffer).digest('hex');

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
