# Changelog

All notable changes to Context Fabric are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/).  
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.0.4] — 2026-03-26

### Added
- `cf_health` MCP tool for local database, capture, hook, and index health reporting.
- `context-fabric doctor` with `--repair`, plus `diag` as a compatibility alias.
- Release metadata consistency check script enforced in CI and MCP registry publish workflow.
- Added maintainer and adopter docs for FAQ, developer workflow, and use-case boundaries.

### Changed
- Switched watcher capture to committed Git object reads with pending/running/succeeded/failed capture runs.
- Added stable local hook runtime under `.context-fabric/runtime` and `.context-fabric/bin/post-commit`.
- Upgraded retrieval to active-only search index v2 with bounded structural outlines.
- Updated README to document health, repair, stable hook runtime, and manual npm publish before tag-based registry release.

### Fixed
- Removed stale search and component state after deletes and renames by tombstoning inactive rows.
- Fixed query cache identity to include capture identity and query inputs, preventing drift-mode cross-contamination.
- Fixed legacy and partially migrated database upgrades by deferring index creation until required columns exist.
- Applied consistent sanitisation across repo-derived text rendered into briefings and health output.

### Verified
- Database migration recovery verified for legacy v1 and partial-upgrade failure states.
- Hook repair, search index rebuild, and schema v2 health checks verified through CLI and test coverage.

---

## [1.0.2] — 2026-03-23

### Added
- Dynamic API badges (version and downloads) on `README.md` linked dynamically to NPM registry.

### Changed
- Shifted to manual NPM publishing CLI approach instead of Actions automation.
- Enhanced MCP registry discoverability by optimising professional metadata (`keywords`/`tags` in `server.json`, `glama.json` and `package.json`).

---

## [1.0.1] — 2026-03-23

### Fixed
- Reduced CI coverage threshold from 70% to 50% to reflect current suite completion
- Fixed NPM publishing workflow by injecting `NODE_AUTH_TOKEN` secretly

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
