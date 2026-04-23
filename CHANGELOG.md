# Changelog

All notable changes to Context Fabric are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/).  
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.0.7] — 2026-04-23

### Fixed
- **Release Fix:** Corrected a broken publish in `1.0.6` where the `dist/` directory was not included in the npm tarball. All binaries and entry points are now properly bundled.


### Security
- **CF-SEC-01:** Bumped transitive `brace-expansion` to `>= 1.1.13` to close [GHSA-f886-m6hf-6m8v](https://github.com/advisories/GHSA-f886-m6hf-6m8v) (moderate, CWE-400 / ReDoS). Fixed via `npm audit fix`; no production dependency changes.
- **CF-SEC-02:** E2 Anchor now hashes the raw file **Buffer** instead of a UTF-8 decoded string. This matches E1 Watcher, which hashes the raw git blob. The previous mismatch could report false drift for BOM-prefixed files, CRLF-normalised checkouts, and any non-UTF-8 content. Anchor now also caps per-file reads at 64 MiB to prevent OOM on pathological files and resolves symlinks during path validation to block symlink escape.
- **CF-SEC-03:** `PathGuard` hardened — explicit NUL-byte rejection, maximum path length enforcement (4096), optional `resolveSymlinks` mode, optional `rejectAbsolute` mode, and a tightened traversal check that no longer relies on substring matching over the `relative()` output.
- **CF-SEC-04:** `InjectionGuard` hardened — input length capped before any regex runs (DoS guard), Unicode NFKC normalisation to catch full-width variants (`ｓｙｓｔｅｍ:`), stripping of zero-width and bidirectional-override characters (Trojan Source, CVE-2021-42574), and an expanded pattern set covering role spoofing (`role: "system"`, `assistant:`), disregard/forget/override jailbreaks, "developer mode", "admin override", `DAN mode`, ChatML (`<|im_start|>`), Llama `[INST]` markers, and XML-style `<system>` tags. All injection regexes are explicitly bounded to prevent catastrophic backtracking.
- **CF-SEC-05:** Git invocations are defence-in-depth hardened. Every `spawnSync('git', …)` now (a) passes `shell: false` explicitly, (b) prepends `-c core.hooksPath=/dev/null -c protocol.ext.allow=never -c protocol.file.allow=never -c credential.helper= -c core.alternateRefsCommand= -c uploadpack.allowFilter=false` so a malicious per-repo git config or hook cannot hijack the MCP server, (c) validates SHAs against a strict hex pattern before use, and (d) uses `--end-of-options` before ref arguments so an argument that starts with `-` cannot be reinterpreted as a git flag.
- **CF-SEC-06:** E3 Router FTS5 sanitiser now caps raw query length at 4096 characters before regex processing (DoS guard).
- **CF-SEC-07:** `ResultCache` is now a bounded LRU (default 1 000 entries) with recency tracking. Previously the cache grew without bound in the number of distinct queries.
- **CF-SEC-08:** `VACUUM INTO` destination path in `db/client.ts` now explicitly rejects SQL-dangerous characters (quotes, control bytes) before interpolation. Backslashes in Windows paths are permitted because SQLite does not interpret escapes inside `'...'` literals.
- **CF-SEC-09:** MCP server now handles `SIGINT`, `SIGTERM`, and `SIGHUP` by calling `closeDb()` before exit, so the SQLite WAL is always checkpointed cleanly.
- **CF-SEC-10:** Added `.max()` bounds on `cf_query.query` (4096) and `cf_query.model` (120) to reject oversized tool inputs at the MCP boundary.

### Added
- `tests/security.test.ts` covering PathGuard (traversal, NUL byte, control chars, length limit, symlink escape) and InjectionGuard (pattern redaction, Unicode normalisation, zero-width stripping, DoS cap, wrapAsData boundaries).
- `tests/cache.test.ts` covering TTL, version invalidation, and LRU eviction for `ResultCache`.
- Anchor tests for UTF-8-with-BOM parity with Watcher and symlink-escape rejection.
- Router test for the raw-query length cap.

### Changed
- SECURITY.md's "Known threat mitigations" section expanded to cover the Buffer-level drift hash, git config hardening, symlink traversal, Unicode prompt-injection variants, and the LRU cache bound.
- Bumped pinned `@modelcontextprotocol/sdk` from `1.27.1` to `1.29.0` (current `latest`). Peer `zod: ^3.25 || ^4.0` is satisfied by our existing `^4.3.6`. Tool-registration and stdio-transport import paths (`@modelcontextprotocol/sdk/server/mcp.js`, `@modelcontextprotocol/sdk/server/stdio.js`) are unchanged across this range, so no source changes were required beyond `package.json`. `README.md`, `CONTRIBUTING.md`, and `.github/dependabot.yml` have been updated in lockstep.

---

## [1.0.5] — 2026-03-26

### Fixed
- Fixed GitHub Actions installs to include optional native dependencies required by Vitest and rolldown on Linux runners.

### Changed
- Clarified that `docs/wiki/*` are source files for the GitHub Wiki and do not populate the Wiki tab until the repository wiki is enabled and published separately.

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
