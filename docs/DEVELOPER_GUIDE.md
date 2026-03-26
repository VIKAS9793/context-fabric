# Developer Guide

This guide is for contributors and maintainers working on Context Fabric itself.

## Product Boundary

Context Fabric is a local-first MCP server for Git-backed project context capture and retrieval.

- Event source: Git commits plus manual capture reconciliation
- Persistence: local SQLite under `.context-fabric/cf.db`
- Serving interface: MCP over stdio
- Safety model: no outbound network and no project file writes from MCP tools

The product goal is stable project continuity for AI coding agents without requiring a hosted service or manual context-maintenance rituals.

## Core Architecture

- `Watcher`: captures committed Git state into the local store
- `Anchor`: detects drift between captured state and the working tree
- `Router`: ranks active components from the local FTS index
- `Governor`: enforces a token budget on ranked results
- `Weaver`: composes the final structured briefing

Supporting operational components:

- `doctor`: reports schema state, capture backlog, DB integrity, and hook/runtime health
- `doctor --repair`: refreshes the local runtime, reinstalls the hook wrapper, validates `.gitignore`, and rebuilds the search index when safe

## Development Workflow

```bash
npm ci
npm run build
npm test
npm run release:check
node dist/cli.js doctor
```

Use `node dist/cli.js init` inside a disposable Git repository when validating end-to-end hook behavior.

## Trust Boundaries

- Treat all repo-derived text as untrusted input.
- Keep all paths inside the project root.
- Keep Git invocations hardcoded and parameter-safe.
- Block writes when the DB is degraded.
- Do not let MCP tools write user project files based on model input.

If a change weakens any of those boundaries, that is a blocking design issue.

## Release Flow

Context Fabric uses a strict release order:

1. Finalize code, tests, docs, and version metadata locally.
2. Run `npm pack --dry-run` and manually `npm publish`.
3. Create and push the matching `vX.Y.Z` Git tag.
4. Let the tag trigger MCP registry publication via GitHub Actions.

This order matters because the MCP registry metadata points to an npm package version that must already exist.

## Versioning Rules

- Patch: internal fixes with no new public tool or contract change
- Minor: additive MCP tools, CLI commands, or meaningful behavior expansion
- Major: breaking CLI, MCP, schema, or packaging changes

The following files must stay aligned for every release:

- `package.json`
- `package-lock.json`
- `server.json`
- `src/index.ts`
- `CHANGELOG.md`

`npm run release:check` enforces that alignment.

## Pre-Merge Verification

- Build passes on the generated `dist` output.
- Tests cover the regression being fixed or the feature being added.
- `doctor` reports healthy state on a clean local repo.
- `npm pack --dry-run` excludes local state and temp artifacts.
- README and changelog reflect the shipped behavior.
