# CONTEXT FABRIC BUILD SESSION — ANTI-DRIFT RULES

> **READ THIS BEFORE WRITING A SINGLE LINE OF CODE.**
> **This protocol is strictly enforced to prevent AI hallucination, version drift, and API invention.**

## 1. PACKAGE VERSIONS ARE LOCKED
Do not suggest upgrades or downgrades. These versions are verified and pinned:
- `@modelcontextprotocol/sdk`: exactly `1.27.1` (v2 is unstable, v1.x has security fixes)
- `better-sqlite3`: exactly `12.8.0` (Requires Node 20.x, 22.x, 23.x, 24.x)
- `zod`: exactly `^4.3.6` (Use v4 natively)
- `typescript`: exactly `^5.5.0`
- `node`: `22 LTS` (Node 25 is explicitly forbidden)

## 2. API DOCS VERIFICATION RULES
- **MCP SDK**: Fetch current docs first `https://github.com/modelcontextprotocol/typescript-sdk`. Do not rely on training memory. The v1.x API changed from v0.x. Stdio server is `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`.
- **better-sqlite3**: Confirm method against `https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md`. `.query()` does NOT exist. It's strictly synchronous (`.run()`, `.get()`, `.all()`).
- **Zod v4**: Confirm against `https://zod.dev`. `z.string().nonempty()` is deprecated; use `.min(1)`.

## 3. SQLite FTS5 SYNTAX MUST BE STRICT
- SQLite FTS5 BM25 returns negative scores (lower = more relevant). `ORDER BY bm25(...)` without `DESC` is correct.

## 4. TRANSPORT IN MVP
- **Phase 1 MVP ONLY local `stdio` transport**. Do not suggest SSE, WebSockets, or HTTP transport.
- No external APIs, no vector embeddings, no cloud storage.

## 5. ESM STRICTNESS
- `package.json` must have `"type": "module"`. All module imports MUST use `.js` extension (e.g., `import { x } from './module.js'`).
- `tsconfig.json` requires `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`.

## 6. SECURITY OVERRIDES (MANDATORY FILE-BY-FILE RULES)
- **Path Traversal Guard**: Every path must pass through `PathGuard` before any `fs` operation. Never store absolute paths in SQLite.
- **Injection Guard**: All repository file content passed into the E5 Weaver briefing MUST be wrapped via `wrapAsData()` and sanitized for prompt injection using `sanitiseFileContent()`.
- **Tool Shadowing**: All MCP tools must use the `cf_` namespace (`cf_capture`, `cf_drift`, `cf_query`, `cf_log_decision`). Tool descriptions are limited to <= 15 words to save token cost.
- **SQL Injection Guard**: Parameterized queries only. No template strings in `db.prepare()`.
- **Command Injection Guard**: All `execSync` parameters strictly hardcoded. No user inputs reach the shell.
- **Token Efficiency**: Wrap `cf_query` handlers in the `ResultCache` using `git_sha` as key to prevent redundant file scans.

---
## ACTIVE ANTIGRAVITY CONTEXT (DO NOT OVERWRITE)
**Last Brain Location**: `C:\Users\vikas\.gemini\antigravity\brain\dbf1d4f4-1244-4cd3-80d9-cd23eab8fc26\`

*Any new agent tab opened must parse this file (`AGENTS.md`), load the `implementation_plan.md` artifact from the brain location above, and resume entirely adhering to these protocols.*
