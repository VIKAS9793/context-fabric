// src/cache/result-cache.ts

interface CacheEntry<T> {
  value:      T;
  computed_at: number;    // unix ms
  version:    string;     // invalidated when capture identity changes
}

export interface CacheIdentity {
  kind: string;
  capture_id?: number | null;
  query?: string;
  budget_pct?: number;
  model?: string;
  include_drift?: boolean;
}

export function makeCacheKey(identity: CacheIdentity): string {
  return JSON.stringify(identity);
}

export class ResultCache {
  // ANTI-DRIFT NOTE: index.ts requires direct access to store for manual setting.
  public readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly ttl_ms: number;

  constructor(ttl_ms = 30_000) {   // 30-second default TTL
    this.ttl_ms = ttl_ms;
  }

  /**
   * Get a cached value, or compute it if stale/missing.
   * Cache key includes git SHA — automatically invalidates after a commit.
   */
  async getOrCompute<T>(
    key:        string,
    version:    string,
    compute:    () => T | null,
  ): Promise<T | null> {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    const now = Date.now();

    // Cache hit: same git SHA, within TTL
    if (
      entry &&
      entry.version === version &&
      (now - entry.computed_at) < this.ttl_ms
    ) {
      return entry.value;
    }

    // Cache miss or invalidated: recompute
    const value = compute();
    if (value !== null) {
      this.store.set(key, { value, computed_at: now, version });
    }
    return value;
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidateAll(): void {
    this.store.clear();
  }
}

// Singleton — one cache per MCP server process
export const cache = new ResultCache(30_000);
