# Context Fabric — Architecture Document

**Product:** Context Fabric  
**Category:** AI Developer Infrastructure  
**Layer:** Workflow Continuity Infrastructure  
**Author:** Vikas Sahani  
**Role:** Product Research — AI Developer Tooling  
**Document Type:** Architecture  
**Internal Engine Name:** CADRE (Context-Aware Drift Resolution Engine)  
**Research Period:** March 2026  
**Version:** v1.0  

---

*Context Fabric — AI Project Continuity Infrastructure*

---

> **Why PRIMA was replaced:** PRIMA was designed around the assumption that the problem was session amnesia — the AI forgetting context when a session ends. Research across 34 signals corrected this. The problem is not forgetting. It is drift — stored context becoming incorrect after commits, with no mechanism to detect or correct that incorrectness. PRIMA was built for the wrong problem. CADRE is built for the right one.

---

## Architecture Summary

CADRE is the internal engine of Context Fabric. It is a five-engine system that:

1. Automatically captures project state on every git commit (no developer action required)
2. Detects drift between stored context and current codebase reality using SHA256 fingerprinting
3. Ranks context modules by relevance to the active query using SQLite FTS5 BM25
4. Enforces a token budget ceiling using greedy selection
5. Composes a structured, AI-readable briefing with explicit drift warnings when context is stale

CADRE does not ask the developer to do anything. It fires on git commit. It responds to queries. Everything in between is automated.

---

## Research Grounding

Every engine in CADRE solves a documented failure mode from the research. There are no speculative features.

| Signal / Entry | Observed Failure | Engine Required |
|---|---|---|
| F-001, F-005, W-01 | Markdown snapshots go stale after commits. Developer relies on discipline that breaks under pressure. | E2 Anchor — hash-based drift detection, zero discipline required |
| F-003, W-03 | 5-step end-of-session ritual. Breaks on abrupt session end. Entirely manual. | E1 Watcher — auto-capture on git commit, zero steps |
| F-008, F-009, W-06 | 4-source documentation system with periodic manual alignment review | E1 Watcher + log_decision — replaces 4-source system with 1 persistent store |
| F-012, Signal 028 | Token cost is an active workflow decision variable — developers manage what to load based on cost | E4 Governor — greedy token budget selection with configurable ceiling |
| F-016, Signal 032 | Knowledge decomposed into many modules. Manual decision required for which modules to load per query. | E3 Router — BM25/FTS5 ranks modules by relevance automatically |
| F-017, Signal 033 | Developer asks AI to interview them to extract project knowledge — exists because auto-capture does not | E1 Watcher — eliminates interview workflow by capturing on every commit |
| F-004, F-014, Signal 030 | Multiple agents need shared context. Single-agent memory insufficient. Cross-platform confirmed. | Shared SQLite WAL — all agents read from same persistent layer |
| F-015, Signal 031 | AGENTS.md adopted across r/ClaudeAI, r/cursor, r/OpenAI. ETH Zurich proved it degrades AI performance. | E2 Anchor + E5 Weaver — replaces AGENTS.md with staleness-aware auto-updated context |

---

## Data Flow

Every context delivery passes through all five engines in sequence.

```
git commit
    ↓
E1 WATCHER  →  SHA256 fingerprint  →  SQLite upsert  →  FTS5 index update
                                                          ↓
query_context(query, budget_pct?)
    ↓
E2 ANCHOR   →  drift check  →  DriftReport { severity: LOW | MED | HIGH }
    ↓
E3 ROUTER   →  FTS5 BM25 query  →  ranked module list
    ↓
E4 GOVERNOR →  greedy selection  →  token-budgeted context set
    ↓
E5 WEAVER   →  structured briefing  →  MCP tool response
```

---

## Engine 1 — WATCHER

**Replaces:** M1 Signal Detector  
**Problem solved:** Every workaround in the dataset (W-01 through W-09) requires the developer to manually trigger context capture. All break when the developer forgets or is interrupted. Watcher fires automatically on every git commit. No action required.

### Trigger

```sh
# .git/hooks/post-commit — installed by Context Fabric on setup
#!/bin/sh
npx context-fabric capture --silent
```

### Algorithm

1. Resolve changed files via `git diff --name-only HEAD~1 HEAD`
2. For each changed file: read content, compute SHA256 using `crypto.createHash('sha256')`
3. Extract component metadata: exports (TypeScript/JS AST regex), `comp_type` classification
4. Upsert into `cf_components` using `INSERT OR REPLACE` — preserves history on path conflict
5. FTS5 triggers auto-update `cf_search` index — no manual index maintenance
6. Write snapshot: `git log -1 --oneline` summary + timestamp + `git_sha` into `cf_snapshots`
7. Pre-calculate token estimate: `Math.ceil(content.length / 3.5)` — stored at capture time to avoid recalculation at query time

### Research basis

- W-01 (markdown per commit) — exists because Watcher does not
- W-03 (5-step ritual) — exists because Watcher does not
- W-09 (AI interview workflow) — exists because Watcher does not
- F-017 (knowledge extraction workaround) — target knowledge is architectural, not just file contents. Watcher captures both.

---

## Engine 2 — ANCHOR

**Replaces:** M2 Staleness Oracle  
**Problem solved:** Stored context becomes incorrect after commits. No mechanism detects this. AI agents proceed with stale context confidently, producing incorrect output. Anchor makes drift visible and measurable.

### Drift Detection Algorithm

```typescript
interface DriftReport {
  drift_score:  number;                  // 0–100
  severity:     'LOW' | 'MED' | 'HIGH';
  stale:        { path: string; stored_sha: string; current_sha: string }[];
  fresh:        { path: string }[];
  checked_at:   number;                  // unix timestamp ms
}

function computeDrift(db: Database): DriftReport {
  const components = db.prepare('SELECT path, sha256 FROM cf_components').all();
  const stale: StaleEntry[] = [];
  const fresh: { path: string }[] = [];

  for (const row of components) {
    if (!fs.existsSync(row.path)) {
      stale.push({ ...row, current_sha: 'DELETED' });
      continue;
    }
    const current = crypto.createHash('sha256')
      .update(fs.readFileSync(row.path))
      .digest('hex');
    (current === row.sha256 ? fresh : stale)
      .push({ path: row.path, stored_sha: row.sha256, current_sha: current });
  }

  const score = (stale.length / components.length) * 100;
  const severity = score < 10 ? 'LOW' : score < 30 ? 'MED' : 'HIGH';
  return { drift_score: score, severity, stale, fresh, checked_at: Date.now() };
}
```

### Severity Thresholds

| Drift Score | Severity | Meaning | E5 Action |
|---|---|---|---|
| < 10% | LOW | Context is substantially current | No warning injected |
| 10–30% | MED | Meaningful drift — some modules stale | Warning section added to briefing |
| > 30% | HIGH | Critical drift — AI context unreliable | Prominent warning + stale file list injected |

### Research basis

- F-005: Developer claims perfect discipline — "every commit updates the markdown." This is the assumption Anchor invalidates. It runs on every query, not every commit, requiring zero developer discipline.
- F-015, Signal 031: AGENTS.md confirmed across three platforms. ETH Zurich (arXiv:2602.11988) proved it degrades AI performance because of undetected drift. Anchor solves precisely this.
- F-007: User perceives Cursor's indexing as sufficient — it is not. Cursor indexes file contents. Anchor detects whether stored architectural context has drifted from current file state.

---

## Engine 3 — ROUTER

**Replaces:** M3 Relevance Ranker  
**Problem solved:** When context is decomposed into modules (Signal 032, F-016), a selection decision is required at every query. Which modules are relevant to this task? Developers are currently making this decision manually. Router automates it using BM25.

### BM25 Implementation (FTS5 Native)

```sql
-- SQLite FTS5 BM25 with column weights
-- path weighted 2.0x: path-level matches carry structural meaning
-- exports weighted 1.0x: symbol matches provide semantic signal
SELECT
  c.id,
  c.path,
  c.exports,
  c.sha256,
  c.token_est,
  bm25(cf_search, 2.0, 1.0) AS relevance_score
FROM cf_search
JOIN cf_components c ON cf_search.rowid = c.id
WHERE cf_search MATCH ?
ORDER BY relevance_score       -- FTS5 BM25: lower score = more relevant
LIMIT 20;
```

### Why BM25 Over Embeddings

Signal 027 (F-011) provides the answer directly: a developer who had tried RAG and vector embeddings explicitly switched back to structured documentation because it provided more reliable recall. BM25 on structured component metadata is more precise for codebase queries than semantic embeddings on raw file content.

Additional reasons:

- Zero external service dependency — runs synchronously inside SQLite
- Deterministic — same query always returns the same ranked result
- Fast — SQLite FTS5 BM25 operates on pre-built inverted index, sub-millisecond
- No API cost — no embedding model calls at query time

### Column Weight Rationale

**path (2.0):** A query for "auth middleware" matching `src/middleware/auth.ts` is a stronger signal than matching "auth" in an exports list. Path matches carry structural codebase meaning.

**exports (1.0):** Exported function and class names provide semantic relevance but are less precise than path-level matching.

### Tokenizer

`porter unicode61` — porter stemming handles code identifiers (e.g., "authenticate" matches "auth"), unicode61 handles non-ASCII identifiers.

### Research basis

- F-016, Signal 032: First live user signal for this engine. Knowledge decomposition into modules creates the selection problem that Router solves.
- Signal 027, F-011: Developers who tried RAG chose structured docs. Router is structured retrieval, not semantic retrieval.

---

## Engine 4 — GOVERNOR

**Replaces:** M4 Token Budget Governor  
**Problem solved:** Loading all stored context into every query is not practical — it overwhelms the context window and incurs token cost. Signal 028 (F-012) is the first live organic signal confirming that token cost is an active workflow decision variable for real developers. Governor automates this decision.

### Greedy Selection Algorithm

```typescript
interface GovernorConfig {
  model_context_tokens: number;   // e.g. 200_000 for Claude Sonnet
  budget_pct:           number;   // default: 0.08 (8% of context window)
}

function selectWithinBudget(
  ranked: Component[],             // from E3 Router, ordered by relevance
  config: GovernorConfig
): { selected: Component[]; used_tokens: number; budget_tokens: number } {

  const budget = Math.floor(config.model_context_tokens * config.budget_pct);
  let used = 0;
  const selected: Component[] = [];

  for (const component of ranked) {
    if (used + component.token_est > budget) break;  // hard ceiling
    selected.push(component);
    used += component.token_est;
  }

  return { selected, used_tokens: used, budget_tokens: budget };
}
```

### Budget Ceiling Rationale

8% of the model context window is chosen to leave 92% available for the conversation, code, and agent output. On Claude Sonnet (200,000 token context), this yields a 16,000-token context budget. The ceiling is configurable per deployment.

Token estimation: `Math.ceil(text.length / 3.5)` — industry-standard approximation for English and code mixed content. Pre-calculated at capture time (E1) to avoid recalculation at query time.

### Research basis

- F-012, Signal 028: First live organic user signal. A developer is actively managing what to load based on token cost. Governor operationalises this decision automatically.
- F-013, W-08: Context Maximiser workaround — developer never closes sessions to avoid resets. Governor makes session restarts costless, eliminating the need for this pattern.

---

## Engine 5 — WEAVER

**Replaces:** M5 Plain Language Emitter  
**Problem solved:** F-017 (Signal 033) shows a developer asking AI to interview them to produce structured project documentation. This workaround exists because no mechanism generates a structured architectural briefing automatically. Weaver composes this from E3 and E4 output, without developer involvement.

### Output Structure

```markdown
# Context Fabric Briefing
## Project Context
[Project name, git_sha, captured_at, drift_severity]

## Architecture
[Ranked components from E3+E4: path, exports, token_est per module]

## Recent Changes
[Files changed in last 3 commits with diff summary]

## Decisions
[Active ADRs from cf_decisions, most recent first]

## Drift Warning         ← injected only when E2 severity is MED or HIGH
[List of stale files: path, stored_sha, current_sha, drift_score]

## Budget Summary
[used_tokens / budget_tokens, components_loaded / components_available]
```

### Drift Warning Injection

When E2 Anchor returns MED or HIGH severity, a Drift Warning section is prepended. This is the direct replacement for the AGENTS.md failure mode: the AI proceeding with stale context without being informed it is stale. Weaver ensures the AI is always informed of the reliability of the context it receives.

### Why Markdown Output

Every AI coding tool in the research dataset — Claude Code, Cursor, Windsurf, OpenAI Codex — natively processes markdown. The output format requires zero transformation. It can be consumed directly as a context injection by any agent.

### Research basis

- F-017, Signal 033: AI interview workflow exists because Weaver does not. When Weaver produces a structural briefing automatically, the interview workaround becomes unnecessary.
- F-015, Signal 031: AGENTS.md is a static briefing that never updates. Weaver produces a dynamic briefing — always reflecting current state, always including drift status.

---

## Database Schema

Context Fabric uses a single SQLite file per project: `.context-fabric/cf.db`  
WAL mode is enabled on initialisation for concurrent read access by multiple agents.

```sql
-- Initialisation pragmas
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Component fingerprint table
-- One row per file. sha256 is the drift anchor (E2 reads this column).
CREATE TABLE IF NOT EXISTS cf_components (
  id           INTEGER PRIMARY KEY,
  path         TEXT    NOT NULL UNIQUE,
  sha256       TEXT    NOT NULL,            -- drift anchor — E2 Anchor compares this
  exports      TEXT,                        -- extracted symbols (JSON array)
  comp_type    TEXT    NOT NULL DEFAULT 'file',
  captured_at  INTEGER NOT NULL,            -- unix ms
  git_sha      TEXT    NOT NULL,            -- commit at capture time
  token_est    INTEGER NOT NULL DEFAULT 0   -- pre-calculated at E1 capture time
);

-- Architecture Decision Records
-- Validated by F-008 (4-source system) and F-009 (Wix Design Log Methodology)
CREATE TABLE IF NOT EXISTS cf_decisions (
  id           INTEGER PRIMARY KEY,
  title        TEXT    NOT NULL,
  rationale    TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'active',  -- active | superseded | rejected
  captured_at  INTEGER NOT NULL,
  tags         TEXT                                -- JSON array
);

-- Session snapshots
-- Replaces end-of-session summary ritual (W-03, F-003)
CREATE TABLE IF NOT EXISTS cf_snapshots (
  id           INTEGER PRIMARY KEY,
  git_sha      TEXT    NOT NULL UNIQUE,
  summary      TEXT    NOT NULL,
  captured_at  INTEGER NOT NULL,
  token_est    INTEGER NOT NULL DEFAULT 0
);

-- FTS5 full-text search index for E3 Router BM25 ranking
-- External-content table: reads from cf_components, no storage duplication
CREATE VIRTUAL TABLE IF NOT EXISTS cf_search USING fts5(
  path,
  exports,
  content      = 'cf_components',
  content_rowid = 'id',
  tokenize     = 'porter unicode61'
);

-- Auto-sync triggers: FTS5 index stays current automatically
CREATE TRIGGER IF NOT EXISTS cf_ai AFTER INSERT ON cf_components BEGIN
  INSERT INTO cf_search(rowid, path, exports)
  VALUES (new.id, new.path, new.exports);
END;
CREATE TRIGGER IF NOT EXISTS cf_au AFTER UPDATE ON cf_components BEGIN
  INSERT INTO cf_search(cf_search, rowid, path, exports)
  VALUES ('delete', old.id, old.path, old.exports);
  INSERT INTO cf_search(rowid, path, exports)
  VALUES (new.id, new.path, new.exports);
END;
CREATE TRIGGER IF NOT EXISTS cf_ad AFTER DELETE ON cf_components BEGIN
  INSERT INTO cf_search(cf_search, rowid, path, exports)
  VALUES ('delete', old.id, old.path, old.exports);
END;
```

**WAL mode and multi-agent reads:** SQLite WAL allows multiple concurrent readers with one writer. This is the technical basis for the multi-agent use case (F-004, F-014, Signal 030) — all agents read from the same `.context-fabric/cf.db` with no locking conflicts.

---

## MCP Tool Surface

Seven tools. Every tool has a single job derived from a documented user need.

| Tool | Engine(s) | What it does | Signal basis |
|---|---|---|---|
| `capture_context` | E1 Watcher | Manual trigger of E1. Captures full project state from current working tree. | W-01 through W-09 — all manual workarounds |
| `check_drift` | E2 Anchor | Runs drift detection. Returns DriftReport with severity, stale list, drift score. | F-001, F-005, F-007, F-015 |
| `query_context` | E3 + E4 + E5 | Primary retrieval. Accepts query string and optional budget_pct. Returns E5 briefing. | F-003, F-012, F-016, F-017 |
| `log_decision` | cf_decisions | Captures an Architecture Decision Record: title, rationale, optional tags. | F-008, F-009 (Wix Design Log) |
| `get_snapshot` | cf_snapshots | Retrieves most recent session snapshot. Replaces end-of-session ritual. | F-003, W-03 |
| `list_components` | cf_components | Lists stored components with sha256, comp_type, token_est. Inspection tool. | F-008 |
| `get_decisions` | cf_decisions | Returns all ADRs filtered by status. Most recent first. | F-008, F-009 |

### Primary Tool Contract: query_context

```typescript
// Input schema (Zod v4.3.6)
const QueryContextInput = z.object({
  query: z.string()
    .describe('Natural language or keyword query about the project'),
  budget_pct: z.number().min(0.01).max(0.20)
    .optional().default(0.08)
    .describe('Fraction of model context window to use. Default: 0.08 (8%)'),
  include_drift_check: z.boolean()
    .optional().default(true)
    .describe('Run E2 drift check and inject warnings if severity >= MED'),
});

// Output
interface QueryContextOutput {
  briefing:      string;       // E5 Weaver markdown — ready for AI agent injection
  drift_report:  DriftReport;  // E2 Anchor result
  used_tokens:   number;       // E4 Governor: tokens consumed
  budget_tokens: number;       // E4 Governor: ceiling applied
}
```

---

## Verified Tech Stack

Versions verified as of 16 March 2026.

| Layer | Package | Version | Justification |
|---|---|---|---|
| MCP Protocol | @modelcontextprotocol/sdk | 1.27.1 | v1.x is production-recommended. v2 is in beta, not yet stable. |
| Storage | better-sqlite3 | 12.8.0 | Fastest synchronous SQLite binding for Node.js. WAL + FTS5 built-in. |
| Validation | zod | 4.3.6 | v4 is 6.5x faster than v3. Required by MCP SDK for tool schemas. |
| Language | TypeScript | 5.5+ | Strict mode enforced. ES2020 module target. |
| Runtime | Node.js | 22 LTS | Current LTS. better-sqlite3 prebuilt binaries available. |
| Transport (Phase 1) | stdio | MCP SDK built-in | Zero-config for Claude Code, Cursor, Windsurf. No port management. |
| Transport (Phase 2) | StreamableHTTP | MCP SDK built-in | Multi-agent and team sync. Phase 2 scope. |
| Search | FTS5 BM25 | SQLite built-in | Native, zero external dependency. porter+unicode61 tokenizer. |
| Distribution | npm + VS Code Marketplace | current | npx one-liner install. Extension ID: vikas9793.context-fabric-vscode. |

```json
{
  "name": "context-fabric",
  "version": "1.0.0",
  "type": "module",
  "bin": { "context-fabric": "dist/index.js" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.1",
    "better-sqlite3":           "^12.8.0",
    "zod":                      "^4.3.6"
  },
  "devDependencies": {
    "@types/better-sqlite3":    "^7.6.13",
    "@types/node":              "^22",
    "typescript":               "^5.5.0"
  }
}
```

---

## PRIMA to CADRE Transition

| PRIMA | Renamed | Reason |
|---|---|---|
| M1: Signal Detector | E1: WATCHER | "Signal Detector" implied reactive. Watcher is proactive and continuous — watching the git event stream. |
| M2: Staleness Oracle | E2: ANCHOR | "Oracle" implied inference. Anchor is deterministic — it binds context to a specific SHA256 state. |
| M3: Relevance Ranker | E3: ROUTER | "Ranker" described the algorithm. Router describes the function: deciding which context modules to route to the query. |
| M4: Token Budget Governor | E4: GOVERNOR | Name retained. Greedy selection algorithm made explicit. 8% ceiling documented with justification. |
| M5: Plain Language Emitter | E5: WEAVER | "Emitter" described output. Weaver describes the composition function: weaving E3+E4 output into a structured fabric. |

---

## Design Principles

These five principles are derived from research signals, not from general engineering preference.

### Principle 1 — Zero Discipline Required

All workarounds in the dataset require sustained manual discipline. Every engine fires automatically. E1 on git commit. E2 on every query. E3, E4, E5 on every query_context call. The developer does not need to remember to do anything.

*Basis: Insight 2 from the ledger — "The real differentiator is zero discipline required."*

### Principle 2 — Ground Truth Over Description

E1 captures SHA256 fingerprints of actual file state. E2 compares measured hashes. The stored context is anchored to file reality, not an AI interpretation of file reality. Context Fabric does not describe code. It measures code.

*Basis: F-010 insight — "PRIMA doesn't describe your code — it measures it."*

### Principle 3 — Explicit Drift Over Silent Staleness

Context Fabric never delivers stale context silently. E2 detects drift. E5 injects explicit warnings when severity is MED or HIGH. The AI is always informed of the reliability of the context it receives.

*Basis: ETH Zurich (arXiv:2602.11988) — AGENTS.md degrades AI performance because the AI proceeds with stale context without knowing it is stale.*

### Principle 4 — Cost-Aware by Default

E4 Governor enforces a budget ceiling on every query. Budget usage is reported in every E5 briefing. The developer always knows what the context delivery costs.

*Basis: Signal 028, F-012 — token cost is a real workflow decision variable.*

### Principle 5 — Infrastructure, Not Feature

CADRE decides what to surface (E3), at what cost (E4), with what freshness guarantee (E2), in what format (E5). It is an infrastructure layer. Developers use it by doing git commit.

*Basis: Insight 13 from the ledger — "The product is not memory. It is context orchestration."*

---

## What CADRE Does Not Do

| Out of scope | Reason | Alternative |
|---|---|---|
| RAG / vector embeddings (Phase 1) | Signal 027: developers who tried RAG switched back to structured docs for reliability. FTS5 BM25 is more predictable. Embeddings require external service. | E3 Router: FTS5 BM25 native to SQLite |
| Cloud storage | Local tool eliminates auth, privacy, and latency problems. Validated by zero-config approach. | Local `.context-fabric/cf.db` |
| AI-generated documentation | F-010: agent-generated docs are AI interpretations, not ground truth. | E1 Watcher: measures files, does not describe them |
| Chat history / conversation memory | Different problem. Handled by native context continuity features. | Out of scope |
| Semantic code understanding | Requires LLM inference at capture time. Adds latency and non-determinism. | E3 Router handles discovery. No inference at capture. |

---

*Author: Vikas Sahani — North Star Hunter*  
*Architecture: CADRE v1.0 — Context-Aware Drift Resolution Engine*  
*Derived from 34 validated signals across r/ClaudeAI, r/cursor, r/OpenAI, and Discord*  
*Problem definition: context drift — not memory loss*  
*March 2026*  
