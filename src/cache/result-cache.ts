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

/**
 * Bounded LRU cache keyed by a version tag.
 *
 * Each entry is invalidated when:
 *   1. Its TTL expires (default 30 seconds), OR
 *   2. Its version tag differs from the current capture version.
 *
 * SECURITY: The cache is process-local but queries flow through it on every
 * MCP `cf_query` call. A client that can issue many distinct queries could
 * otherwise grow the cache without bound. The LRU cap below fixes that:
 * inserting a new key when `store.size >= max_entries` evicts the least
 * recently used entry so memory use is O(1) in attacker-controlled input.
 */
export class ResultCache {
  // ANTI-DRIFT NOTE: index.ts requires direct access to store for manual setting.
  public readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly ttl_ms: number;
  private readonly max_entries: number;

  constructor(ttl_ms = 30_000, max_entries = 1_000) {
    this.ttl_ms = ttl_ms;
    this.max_entries = Math.max(1, max_entries);
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
      // Touch entry for LRU recency: delete-then-set moves it to tail.
      this.store.delete(key);
      this.store.set(key, entry);
      return entry.value;
    }

    // Cache miss or invalidated: recompute
    const value = compute();
    if (value !== null) {
      this.set(key, { value, computed_at: now, version });
    }
    return value;
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidateAll(): void {
    this.store.clear();
  }

  private set(key: string, entry: CacheEntry<unknown>): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    }
    this.store.set(key, entry);
    while (this.store.size > this.max_entries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}

// Singleton — one cache per MCP server process
export const cache = new ResultCache(30_000, 1_000);
