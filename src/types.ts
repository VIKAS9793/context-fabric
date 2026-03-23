// src/types.ts
// SINGLE SOURCE OF TRUTH for all shared interfaces.
// Every engine and tool imports from here. No duplication.

// ─── STORAGE TYPES ─────────────────────────────────────────────────────────

export interface Component {
  id:           number;
  path:         string;
  sha256:       string;
  exports:      string | null;    // JSON array string — parse with JSON.parse()
  file_summary: string | null;    // extracted from @fileoverview JSDoc
  comp_type:    string;
  captured_at:  number;           // unix ms
  git_sha:      string;
  token_est:    number;           // pre-calculated: Math.ceil(content.length / 3.5)
}

export interface Decision {
  id:           number;
  title:        string;
  rationale:    string;
  status:       'active' | 'superseded' | 'rejected';
  captured_at:  number;
  tags:         string | null;    // JSON array string
}

export interface Snapshot {
  id:           number;
  git_sha:      string;
  summary:      string;
  captured_at:  number;
  token_est:    number;
}

// ─── E1 WATCHER ────────────────────────────────────────────────────────────

export interface CaptureResult {
  captured:     number;           // count of files processed
  git_sha:      string;
  timestamp:    number;           // unix ms
}

// ─── E2 ANCHOR ─────────────────────────────────────────────────────────────

export interface StaleEntry {
  path:         string;
  stored_sha:   string;
  current_sha:  string;           // 'DELETED' | 'UNREADABLE' | hex sha256
}

export interface DriftReport {
  drift_score:      number;       // 0–100 (rounded to 1 decimal)
  severity:         'LOW' | 'MED' | 'HIGH';
  stale:            StaleEntry[];
  fresh:            { path: string }[];
  checked_at:       number;       // unix ms
  total_components: number;
}

// ─── E3 ROUTER ─────────────────────────────────────────────────────────────

export interface RouterQuery {
  text:         string;           // raw query from caller — sanitised internally
  limit:        number;           // max results to return — default 25
}

export interface RankedComponent {
  id:           number;
  path:         string;
  exports:      string | null;
  file_summary: string | null;
  comp_type:    string;
  token_est:    number;
  bm25_score:   number;           // negative — more negative = more relevant
  rank:         number;           // 1-based rank in result set
}

export interface RouterResult {
  ranked:       RankedComponent[];
  query_text:   string;           // sanitised query actually sent to MATCH
  fallback:     boolean;          // true if query matched 0 results → fell back to recency
  total_ranked: number;
}

// ─── E4 GOVERNOR ───────────────────────────────────────────────────────────

// Verified Model Context Sizes — Updated 22 March 2026
export const MODEL_CONTEXT_SIZES: Record<string, number> = {
  // Anthropic
  'claude-opus-4-6':            200_000,
  'claude-sonnet-4-6':          200_000,   // 1M in beta, using 200K safe default
  'claude-sonnet-4-5':          200_000,
  'claude-haiku-4-5-20251001':  200_000,
  
  // OpenAI
  'gpt-5.4':                  1_050_000,
  'gpt-5.4-mini':             1_050_000,
  'gpt-5.4-nano':             1_050_000,
  'gpt-5.4-pro':              1_050_000,
  'gpt-4o':                     128_000,
  
  // Google
  'gemini-3.1-pro-preview':   1_000_000,
  'gemini-3-flash':           1_000_000,
  'gemini-2.5-pro':           1_000_000,
  'gemini-2.5-flash':         1_000_000,
  'gemini-2.5-flash-lite':    1_000_000,
  
  'default':                    200_000,   // safe default
} as const;

export interface BudgetConfig {
  model?:         string;         // key into MODEL_CONTEXT_SIZES — default 'default'
  budget_pct?:    number;         // 0.01–0.20 — default 0.08 (8%)
  hard_ceiling?:  number;         // override: absolute token ceiling (ignores model+pct)
}

export interface BudgetResult {
  selected:       RankedComponent[];    // subset of RouterResult.ranked that fit budget
  used_tokens:    number;               // sum of token_est for selected components
  budget_tokens:  number;               // ceiling that was applied
  dropped:        number;               // count of ranked components that did not fit
  model:          string;               // model used for budget calculation
  budget_pct:     number;               // fraction used
}

// ─── E5 WEAVER ─────────────────────────────────────────────────────────────

export interface WeaverInput {
  drift:    DriftReport;
  budget:   BudgetResult;
  decisions: Pick<Decision, 'title' | 'rationale' | 'status'>[];
  snapshot: Pick<Snapshot, 'git_sha' | 'summary'> | undefined;
  projectName: string;
}

export interface WeaverOutput {
  briefing:     string;           // markdown string — ready for AI agent injection
  used_tokens:  number;           // from BudgetResult
  budget_tokens:number;           // from BudgetResult
  drift_score:  number;           // from DriftReport
  severity:     string;           // from DriftReport
}
