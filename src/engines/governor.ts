// src/engines/governor.ts
// E4 GOVERNOR — Token budget enforcement via greedy selection

import type { RankedComponent, BudgetConfig, BudgetResult } from '../types.js';
import { MODEL_CONTEXT_SIZES } from '../types.js';

function resolveBudgetTokens(config: BudgetConfig): {
  budget_tokens: number;
  model:         string;
  budget_pct:    number;
} {
  if (config.hard_ceiling !== undefined) {
    return {
      budget_tokens: config.hard_ceiling,
      model:         config.model ?? 'manual',
      budget_pct:    0,
    };
  }

  const model      = config.model ?? 'default';
  const budget_pct = config.budget_pct ?? 0.08;

  if (budget_pct < 0.01 || budget_pct > 0.20) {
    throw new RangeError(
      `budget_pct must be between 0.01 and 0.20. Got: ${budget_pct}`
    );
  }

  const modelTokens = MODEL_CONTEXT_SIZES[model] ?? MODEL_CONTEXT_SIZES['default'];
  const budget_tokens = Math.floor(modelTokens * budget_pct);

  return { budget_tokens, model, budget_pct };
}

export function selectWithinBudget(
  ranked: RankedComponent[],
  config: BudgetConfig = {},
): BudgetResult {

  const { budget_tokens, model, budget_pct } = resolveBudgetTokens(config);

  let used_tokens = 0;
  const selected: RankedComponent[] = [];

  for (const component of ranked) {
    if (used_tokens + component.token_est > budget_tokens) {
      break;
    }
    selected.push(component);
    used_tokens += component.token_est;
  }

  return {
    selected,
    used_tokens,
    budget_tokens,
    dropped:    ranked.length - selected.length,
    model,
    budget_pct,
  };
}

export function formatBudgetSummary(result: BudgetResult): string {
  const usedPct = result.budget_tokens > 0
    ? ((result.used_tokens / result.budget_tokens) * 100).toFixed(1)
    : '0.0';

  return (
    `${result.selected.length} components loaded` +
    ` · ${result.used_tokens.toLocaleString()} / ${result.budget_tokens.toLocaleString()} tokens` +
    ` (${usedPct}% of ${(result.budget_pct * 100).toFixed(0)}% budget)` +
    (result.dropped > 0 ? ` · ${result.dropped} components over budget` : '')
  );
}

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  model:      'default',
  budget_pct: 0.08,
} as const;
