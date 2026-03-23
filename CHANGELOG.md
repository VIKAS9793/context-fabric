# Changelog

All notable changes to Context Fabric are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2026-03-23

### Added
- E1 Watcher: automated project state capture on git post-commit hook
- E2 Anchor: SHA256-based drift detection with severity classification
- E3 Router: SQLite FTS5 BM25 relevance ranking with query sanitisation
- E4 Governor: greedy token budget selection with configurable ceiling
- E5 Weaver: structured markdown briefing composition with drift warnings
- `cf_capture` MCP tool: manual context capture
- `cf_drift` MCP tool: standalone drift check
- `cf_query` MCP tool: full CADRE pipeline with cache
- `cf_log_decision` MCP tool: architecture decision record persistence
- PathGuard: path traversal prevention on all file operations
- InjectionGuard: prompt injection sanitisation for file content in briefings
- ResultCache: git SHA-keyed in-process cache — zero redundant file reads
- `npx context-fabric init` CLI: one-command setup with git hook installation
- Full-tree capture on first init (`git ls-files` in full mode)
- `@fileoverview` JSDoc summary extraction for file-level knowledge
- Schema migration guard for `file_summary` column
- FTS5 sanitiser strips reserved boolean operators (OR, AND, NOT)
- Vitest test suite: 23 tests across 4 engine files (`pool: 'forks'`)
- CI workflow: automated test execution with 70% coverage threshold

### Fixed
- CF-BU-01: Missing `await` on `loadSnapshot` and `loadDecisions` in `cf_query` handler
- CF-BU-02: FTS5 `ORDER BY` alias failure on Windows — replaced alias with direct `bm25()` call
- CF-BU-03: Type mismatch on `RouterResult.ranked` access in CLI
- CF-BU-04: Init only captured incremental diff, not full project tree
- CF-BU-05: CLI query path spread `defaultRouterQuery` as object instead of calling as function

### Verified
- Full CADRE lifecycle verified on Windows 11 / Node 22 LTS
- Security audit passed: path traversal, injection redaction, budget enforcement, weaver robustness
- Cache invalidation confirmed across git commit boundary
- BM25 relevance ranking confirmed: correct component ranked first on matching query
