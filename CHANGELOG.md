# Changelog

All notable changes to Context Fabric are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Fixed
- CF-BU-01: Missing `await` on `loadSnapshot` and `loadDecisions` in `cf_query` handler (`index.ts`).
- CF-BU-02: FTS5 `ORDER BY` alias failure on Windows — replaced `bm25_score` alias with direct `bm25()` call (`router.ts`).
- CF-BU-03: Type mismatch on `RouterResult.ranked` access in CLI (`cli.ts`).

### Verified
- Full CADRE lifecycle verified on Windows 11 / Node 22 LTS.
- Security audit passed: path traversal, injection redaction, budget enforcement, weaver robustness.
- Cache invalidation confirmed across git commit boundary.
- BM25 relevance ranking confirmed: correct component ranked first on matching query.

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

---

## [0.1.0] — unreleased

Initial release scope.
