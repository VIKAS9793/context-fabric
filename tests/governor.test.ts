// tests/governor.test.ts
// Tests E4 Governor greedy token budget enforcement.
//
// Governor operates on RankedComponent[] arrays — zero database calls.

import { describe, it, expect } from 'vitest';
import { selectWithinBudget }   from '../src/engines/governor.js';
import type { RankedComponent } from '../src/types.js';

function makeComponent(
  id: number,
  tokenEst: number,
  bm25Score: number = -(10 - id),
): RankedComponent {
  return {
    id,
    path:         `src/module${id}.ts`,
    exports:      null,
    file_summary: null,
    comp_type:    'file',
    token_est:    tokenEst,
    bm25_score:   bm25Score,
    rank:         id,
  };
}

describe('E4 Governor — selectWithinBudget', () => {

  it('selects components that fit within budget ceiling', () => {
    const ranked = [
      makeComponent(1, 1000),
      makeComponent(2, 1000),
      makeComponent(3, 1000),
    ];

    const result = selectWithinBudget(ranked, { hard_ceiling: 2500 });

    expect(result.selected).toHaveLength(2);
    expect(result.used_tokens).toBe(2000);
    expect(result.dropped).toBe(1);
  });

  it('skips oversize components and continues filling budget with later entries', () => {
    const ranked = [
      makeComponent(1, 200),
      makeComponent(2, 5000),
      makeComponent(3, 200),
    ];

    const result = selectWithinBudget(ranked, { hard_ceiling: 500 });

    expect(result.selected).toHaveLength(2);
    expect(result.selected[0].id).toBe(1);
    expect(result.selected[1].id).toBe(3);
    expect(result.dropped).toBe(1);
  });

  it('uses Math.floor for budget calculation — never exceeds ceiling', () => {
    const ranked = [makeComponent(1, 16_001)];

    const result = selectWithinBudget(ranked, {
      model:      'default',
      budget_pct: 0.08,
    });

    expect(result.selected).toHaveLength(0);
    expect(result.budget_tokens).toBe(16_000);
    expect(result.dropped).toBe(1);
  });

  it('throws RangeError for budget_pct outside 0.01–0.20', () => {
    const ranked = [makeComponent(1, 100)];

    expect(() => selectWithinBudget(ranked, { budget_pct: 0 }))
      .toThrow(RangeError);
    expect(() => selectWithinBudget(ranked, { budget_pct: 0.21 }))
      .toThrow(RangeError);
    expect(() => selectWithinBudget(ranked, { budget_pct: 0.01 }))
      .not.toThrow();
    expect(() => selectWithinBudget(ranked, { budget_pct: 0.20 }))
      .not.toThrow();
  });

  it('selects everything when all components fit within budget', () => {
    const ranked = [
      makeComponent(1, 100),
      makeComponent(2, 100),
      makeComponent(3, 100),
    ];

    const result = selectWithinBudget(ranked, { hard_ceiling: 10_000 });

    expect(result.selected).toHaveLength(3);
    expect(result.used_tokens).toBe(300);
    expect(result.dropped).toBe(0);
  });

  it('handles empty ranked array without error', () => {
    const result = selectWithinBudget([], { hard_ceiling: 5000 });

    expect(result.selected).toHaveLength(0);
    expect(result.used_tokens).toBe(0);
    expect(result.dropped).toBe(0);
  });

});
