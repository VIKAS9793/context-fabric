# FAQ

## What is Context Fabric?

Context Fabric is a local-first MCP server that captures Git-backed project state, detects drift, ranks relevant files, applies a token budget, and returns structured briefings to AI coding agents.

## Does it send code or telemetry anywhere?

No. Context Fabric is designed to run locally without outbound network traffic for its core behavior.

## What is the source of truth for capture?

Committed Git objects. Watcher reads from Git, not from the mutable working tree.

## What happens to uncommitted edits?

They can affect drift detection, but they are not indexed as the new source of truth until they are committed and captured.

## What local files does it create or modify?

Context Fabric writes:

- `.context-fabric/cf.db`
- `.context-fabric/runtime/**`
- `.context-fabric/bin/post-commit`
- `.git/hooks/post-commit`

It does not write user project files from MCP tool calls.

## Can I use it in a monorepo?

Yes, on a single developer machine. The current design is local-scale, not multi-tenant or distributed.

## Does it fully semantically index my codebase?

No. It indexes bounded structural context such as file paths, exports, summaries, and outlines. It does not index full implementation bodies for deep semantic search.

## Is it a replacement for `AGENTS.md` or product documentation?

Not completely. It reduces the need for manual session-memory documents, but it should not replace product specs, onboarding material, or stakeholder-facing documentation.

## When should I not use Context Fabric?

Do not use it if you need:

- a hosted team knowledge platform
- cross-repo or organization-wide search
- multi-machine synchronization
- full-code semantic indexing
- project-file mutation or code execution from MCP tools

## How do I check whether my install is healthy?

Run:

```bash
npx context-fabric doctor
```

This reports schema version, integrity state, capture backlog, and hook/runtime readiness.

## How do I repair a broken hook or runtime bundle?

Run:

```bash
npx context-fabric doctor --repair
```

This refreshes the local runtime bundle, reinstalls the stable hook wrapper, validates `.gitignore`, and rebuilds the search index when the database is healthy.

## How should releases be published?

Use this order:

1. Finish code, tests, docs, and version alignment.
2. Run `npm pack --dry-run`.
3. Manually run `npm publish`.
4. Create and push the matching Git tag.
5. Let GitHub Actions publish the MCP registry metadata.
