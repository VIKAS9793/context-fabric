// src/cache/result-cache.ts

interface CacheEntry<T> {
  value:      T;
  computed_at: number;    // unix ms
  git_sha:    string;     // invalidated when git SHA changes
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
    git_sha:    string,
    compute:    () => T | null,
  ): Promise<T | null> {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    const now = Date.now();

    // Cache hit: same git SHA, within TTL
    if (
      entry &&
      entry.git_sha === git_sha &&
      (now - entry.computed_at) < this.ttl_ms
    ) {
      return entry.value;
    }

    // Cache miss or invalidated: recompute
    const value = compute();
    if (value !== null) {
      this.store.set(key, { value, computed_at: now, git_sha });
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
