// tests/cache.test.ts
// Tests the bounded LRU and TTL behaviour of ResultCache.

import { describe, it, expect } from 'vitest';
import { ResultCache } from '../src/cache/result-cache.js';

describe('ResultCache — TTL', () => {
  it('returns cached value within TTL', async () => {
    const cache = new ResultCache(30_000, 1_000);
    let calls = 0;
    const compute = () => { calls += 1; return 'value'; };

    await cache.getOrCompute('k', 'v1', compute);
    await cache.getOrCompute('k', 'v1', compute);

    expect(calls).toBe(1);
  });

  it('recomputes when version changes', async () => {
    const cache = new ResultCache(30_000, 1_000);
    let calls = 0;
    const compute = () => { calls += 1; return 'value'; };

    await cache.getOrCompute('k', 'v1', compute);
    await cache.getOrCompute('k', 'v2', compute);

    expect(calls).toBe(2);
  });
});

describe('ResultCache — bounded LRU', () => {
  it('evicts least recently used entry when exceeding max_entries', async () => {
    const cache = new ResultCache(30_000, 3);

    await cache.getOrCompute('a', 'v', () => 'A');
    await cache.getOrCompute('b', 'v', () => 'B');
    await cache.getOrCompute('c', 'v', () => 'C');
    expect(cache.store.size).toBe(3);

    // Touch 'a' so it becomes most recent; 'b' is now the LRU entry.
    await cache.getOrCompute('a', 'v', () => 'A');

    await cache.getOrCompute('d', 'v', () => 'D');

    expect(cache.store.size).toBe(3);
    expect(cache.store.has('b')).toBe(false);
    expect(cache.store.has('a')).toBe(true);
    expect(cache.store.has('c')).toBe(true);
    expect(cache.store.has('d')).toBe(true);
  });

  it('holds at or below max_entries under sustained inserts', async () => {
    const cache = new ResultCache(30_000, 10);
    for (let i = 0; i < 1000; i++) {
      await cache.getOrCompute(`k${i}`, 'v', () => i);
    }
    expect(cache.store.size).toBeLessThanOrEqual(10);
  });

  it('invalidateAll clears every entry', async () => {
    const cache = new ResultCache(30_000, 100);
    await cache.getOrCompute('a', 'v', () => 'A');
    cache.invalidateAll();
    expect(cache.store.size).toBe(0);
  });
});
