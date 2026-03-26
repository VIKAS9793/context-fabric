# Context Fabric Wiki Home

This page is a GitHub Wiki-ready landing page for the project.

## What Context Fabric Does

Context Fabric is a local-first MCP server that captures Git-backed project state, detects drift, ranks relevant context, applies a token budget, and returns structured briefings to AI coding agents.

## Start Here

- [README](../../README.md) for install and MCP setup
- [Developer Guide](../DEVELOPER_GUIDE.md) for maintainers and contributors
- [FAQ](../FAQ.md) for common operational and adoption questions
- [Use Cases and Limitations](../USE_CASES.md) for adoption guidance
- [Security Policy](../../SECURITY.md) for the threat model and disclosure path
- [Changelog](../../CHANGELOG.md) for release history

## Core Commands

```bash
npx context-fabric init
npx context-fabric doctor
npx context-fabric doctor --repair
```

## Product Boundaries

- Local-only operation
- No outbound network
- No project file writes from MCP tools
- Git-backed capture as the source of truth
- Bounded structured retrieval instead of full semantic indexing

## Release Policy

Publication happens in this order:

1. Manual `npm publish`
2. Matching Git tag push
3. MCP registry publication through GitHub Actions

That ordering keeps registry metadata aligned with an already-available npm package version.
