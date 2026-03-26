# Use Cases and Limitations

This document is for adopters deciding whether Context Fabric fits their workflow.

## Best-Fit Use Cases

Context Fabric is a strong fit when all of the following are true:

- You work in a local Git repository.
- You use AI coding agents across multiple sessions.
- You want context to stay aligned with commits instead of hand-written summaries.
- You want a local-only solution with no hosted service and no outbound telemetry.

## Common Scenarios It Handles Well

### Multi-Session Feature Work

You end a coding session, commit, and return later with a fresh context window or a different agent. Context Fabric reconstructs a relevant briefing from the latest captured state and decision log.

### Architecture-Sensitive Repositories

If file paths, exported APIs, and file summaries carry real meaning in your codebase, Context Fabric can route the most relevant files into a bounded briefing quickly.

### Local Monorepo Development

Large repositories on a single developer machine are supported through active-only indexing, bounded outlines, and deferred capture when an inline hook run would be too expensive.

### Security-Conscious Local Development

Context Fabric is appropriate when code must remain local. It does not upload repo content, call embeddings APIs, or depend on a remote vector store.

### Decision Retention Across Sessions

If your team repeatedly revisits the same architecture choices, `cf_log_decision` provides a local decision record that can be included in future briefings.

## What Context Fabric Is Not For

Context Fabric is the wrong tool when you need:

- A hosted team knowledge platform
- Cross-repo or organization-wide search
- Multi-machine synchronization
- Full semantic indexing of implementation bodies
- Project execution, builds, or code modification from MCP tool calls

## Important Limitations

### Local-Only by Design

There is no shared backend, remote admin surface, or cloud synchronization. Each repository has its own local store.

### Git-Backed Capture Boundary

Watcher captures committed Git objects. Uncommitted edits are visible to drift detection, but they are not indexed as the new source of truth until committed and captured.

### Bounded Retrieval Depth

Routing uses paths, exports, summaries, and bounded structural outlines. It does not index full implementation bodies for deep semantic search.

### Large File Handling

Files beyond the outline threshold remain tracked for metadata and drift purposes, but their outline text is skipped to keep local indexing bounded.

### Local Concurrency Model

The system is tuned for one local writer and multiple concurrent readers. It is not a distributed coordination service.

## Practical Non-Goals

These are deliberate non-goals:

- Cloud indexing
- Embedding pipelines
- IDE lock-in
- Telemetry-based analytics
- Replacing human-authored product documentation

## Adoption Checklist

Use Context Fabric if most answers are yes:

- Do you commit regularly?
- Do you lose time re-explaining the repo to AI tools?
- Do you want local retrieval instead of a hosted RAG stack?
- Do you care about detecting stale context before the model acts on it?

Do not treat Context Fabric as your only documentation system if you also need broad onboarding docs, product specs, or stakeholder-facing narrative documentation.
