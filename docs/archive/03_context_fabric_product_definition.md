# Context Fabric — Product Definition Document

**Product:** Context Fabric  
**Category:** AI Developer Infrastructure  
**Layer:** Workflow Continuity Infrastructure  
**Author:** Vikas Sahani  
**Role:** Product Research — AI Developer Tooling  
**Document Type:** Product  
**Research Period:** March 2026  
**Version:** v1.0  

---

*Context Fabric — AI Project Continuity Infrastructure*

---

> This document bridges the validated problem (Document 02) and the technical architecture (Document 04). It defines what Context Fabric is, what it does, what it does not do, and why it is positioned as infrastructure rather than a feature or tool.

---

## 1. Product Thesis

Developers using AI coding agents are manually constructing AI project continuity infrastructure — documentation systems, session handoff rituals, multi-source knowledge architectures, RAG pipelines — because no standard layer exists to manage project context automatically.

This is not a feature gap. It is an infrastructure gap.

Context Fabric is the standard infrastructure layer that replaces the manual systems developers are already building. It captures project state automatically on every git commit, detects when stored context has drifted from codebase reality, routes relevant context to queries within token budget constraints, and delivers structured briefings to AI agents without requiring any developer action.

**One line thesis:**

> Context Fabric is the infrastructure layer that makes AI project continuity automatic.

---

## 2. What Context Fabric Is

Context Fabric is a context orchestration layer. It decides what to surface, for which agent, at what cost, and with what freshness guarantee — automatically, on every query.

**Context Fabric is:**

- An AI workflow continuity infrastructure layer
- A context orchestration system for AI-assisted development
- An automated replacement for CLAUDE.md, AGENTS.md, and session handoff rituals
- A drift detection and correction layer between the codebase and AI agents
- A token-budget-aware context delivery mechanism
- An MCP-native, IDE-agnostic infrastructure layer that works with Claude Code, Cursor, Windsurf, and any MCP-compatible tool

---

## 3. What Context Fabric Is Not

This boundary is important. Misclassification of the product leads to wrong comparisons, wrong positioning, and wrong ICP targeting.

**Context Fabric is not:**

- A prompt manager — it does not store or organise prompts
- A documentation tool — it does not write documentation
- A notes tool — it does not capture freeform notes
- A RAG wrapper — it does not wrap a vector database
- A chat history tool — it does not persist conversation history
- A code review tool — it does not analyse code quality
- A project management system — it does not track tasks or tickets
- An AI memory feature — memory implies storage. Context Fabric is orchestration.

The distinction that matters most: tools that store and retrieve are utilities. Context Fabric decides what to surface, when, at what cost, and with what freshness guarantee. That is infrastructure, not storage.

---

## 4. Product Principles

These five principles are derived directly from the research signals. Each one addresses a documented failure mode from the 34-signal dataset.

### Principle 1 — Zero Discipline Required

Every workaround documented in the research (9 archetypes, W-01 through W-09) requires the developer to remember to do something. Markdown files require updating after every commit. Session rituals require 5 manual steps. RAG pipelines require maintenance. All break when the developer forgets or is interrupted.

Context Fabric fires on git commit. No developer action is required at any point in the workflow.

**Research basis:** Insight from ledger — "The real differentiator is zero discipline required."

### Principle 2 — Ground Truth Over Description

AI-generated documentation (workaround W-07) produces AI interpretations of file contents, not measurements of file reality. These interpretations cannot be verified without manual review.

Context Fabric captures SHA256 fingerprints of actual file state. It measures the codebase. It does not describe it.

**Research basis:** F-010 — "Context Fabric does not describe your code. It measures it."

### Principle 3 — Explicit Drift Over Silent Staleness

The dominant failure mode of AGENTS.md — confirmed across three platforms and by ETH Zurich research — is that AI agents proceed with stale context without being informed the context is stale.

Context Fabric detects drift using hash comparison on every query. When drift is significant, it injects an explicit warning into the context briefing. The AI is always informed of the reliability of the context it receives.

**Research basis:** ETH Zurich (arXiv:2602.11988) — AGENTS.md actively degrades AI performance. F-015, F-005, F-001.

### Principle 4 — Cost-Aware by Default

A developer on r/OpenAI (Signal 028) explicitly described making documentation loading decisions based on token cost. Token cost is not a theoretical concern — it is an active workflow variable for real developers.

Context Fabric applies a configurable token budget ceiling to every context delivery. Budget usage is reported in every briefing. The developer always knows what the context delivery costs.

**Research basis:** Signal 028, F-012 — first live organic signal confirming token cost as workflow variable.

### Principle 5 — Infrastructure, Not Feature

A feature is something a developer uses. Infrastructure is something that operates automatically while the developer does other work.

Context Fabric is infrastructure. Developers use it by doing `git commit`. Everything else is automatic.

---

## 5. Core Capabilities

Each capability maps directly to a documented workaround that it replaces.

### Automatic Context Capture

Fires on every git commit via post-commit hook. Computes SHA256 fingerprints of all changed files. Stores component metadata, exports, and token estimates. Requires no developer action.

**Replaces:** W-01 (markdown per commit), W-03 (5-step session ritual), W-09 (AI interview workflow)

### Drift Detection

Compares stored SHA256 hashes against current file state on every query. Returns a scored DriftReport with severity classification (LOW / MED / HIGH). Surfaces stale files explicitly.

**Replaces:** The undetected staleness in AGENTS.md, CLAUDE.md, and every static documentation workaround

### Relevance-Ranked Context Routing

Uses SQLite FTS5 BM25 to rank stored context modules by relevance to the active query. Automatically selects the most relevant modules without developer involvement.

**Replaces:** W-06 (4-source manual selection), W-05 (3-item checklist), the modular selection problem in W-08

### Token-Budgeted Delivery

Enforces a configurable token budget ceiling using greedy selection. By default, context delivery uses 8% of the model context window. Budget usage is reported per query.

**Replaces:** The manual token management described in Signal 028

### Structured Agent Briefings

Composes structured markdown briefings — Architecture, Recent Changes, Decision Records, Drift Warning — formatted for direct AI agent consumption. No transformation required.

**Replaces:** W-09 (AI interview workflow), the manual briefing preparation in W-02 and W-03

### Architecture Decision Records

Captures and persists architecture decisions (title, rationale, status, tags). Loads decision history into every context briefing automatically.

**Replaces:** The decisions file in W-06, validated by Wix Engineering Design Log Methodology (external independent validation)

### Multi-Agent Shared Context

SQLite WAL mode allows multiple AI agents to read from the same persistent context store concurrently without locking conflicts.

**Replaces:** W-04 (dedicated lead agent memory owner) — the multi-agent coordination problem confirmed independently on r/ClaudeAI and r/OpenAI

---

## 6. Differentiation

### vs. AGENTS.md / CLAUDE.md

Static files. No staleness detection. No automatic updates. ETH Zurich proved they degrade AI coding performance. Developers maintain them manually under discipline that breaks under pressure.

**Context Fabric:** Automatic, hash-verified, always reflects current codebase state.

### vs. Custom RAG Pipelines

Require 10 to 40 hours to build. Require ongoing maintenance. Require an external vector database service. Use semantic embeddings that are less precise than structured retrieval for codebase queries. Signal 027 confirms developers who tried RAG switched back to structured docs for reliability.

**Context Fabric:** Zero-config npm install. No external services. BM25 structured retrieval. Sub-millisecond query time.

### vs. Cursor's Native Indexing

Cursor indexes file contents for semantic search. It does not capture architectural decisions. It does not detect when stored context has drifted. It does not produce structured agent briefings.

**Context Fabric:** Captures decisions, detects drift, routes context, delivers briefings.

### vs. AI-Generated Documentation

Agent-generated docs (W-07) are AI interpretations of file contents. They cannot be verified without manual review. They do not detect staleness.

**Context Fabric:** Measures files, does not describe them. Drift detection is hash-based, not AI-based.

### vs. Generic MCP Memory Servers

Generic memory servers store and retrieve. They have no concept of project structure, file-level drift, token budgets, or architectural decisions.

**Context Fabric:** Context orchestration — decides what to surface, at what cost, with what freshness guarantee. Purpose-built for AI-assisted software development.

---

## 7. MCP Positioning

Context Fabric is distributed as an MCP (Model Context Protocol) server. This positioning is strategic, not incidental.

**Why MCP:**

MCP is the standard protocol for connecting AI agents to external data sources and tools. As of March 2026, the MCP ecosystem has 1,864+ published servers and the official TypeScript SDK has 33,000+ npm dependents. MCP is the distribution layer for AI developer infrastructure.

Context Fabric is MCP-native from day one. This means:

- Any MCP-compatible AI coding tool can connect to it with a single config line
- No IDE-specific integration required — one server works with Claude Code, Cursor, Windsurf, and any future MCP-compatible tool
- The protocol handles tool discovery, schema validation, and transport — Context Fabric focuses entirely on context orchestration

**MCP transport strategy:**

- Phase 1 (v1.0): stdio transport — zero-config, no port management, immediate compatibility with all major AI coding tools
- Phase 2 (v2.0): StreamableHTTP — multi-user teams, remote connections, agent-to-agent coordination

**Distribution:**

- npm package: `npx context-fabric init` — single-command setup
- VS Code Extension: `vikas9793.context-fabric-vscode`
- MCP Connectors Directory: submission planned post v1.0 launch

---

## 8. Why Now

Six conditions converge in March 2026 that make this the right moment.

### 1. AI coding adoption crossed mainstream

Claude Code, Cursor, and Windsurf are no longer early-adopter tools. Multi-session AI-assisted development is the standard workflow for a significant portion of the developer population. The problem population is large and growing.

### 2. MCP ecosystem crossed adoption threshold

1,864+ MCP servers. 33,000+ npm dependents on the official TypeScript SDK. The infrastructure distribution layer exists and has been validated.

### 3. Context engineering is emerging as a practice

Developers are naming and practising "context engineering" independently across all four platforms observed. The category is forming from the bottom up. No standard has been set.

### 4. AGENTS.md is being invalidated by research

ETH Zurich (February 2026) proved that AGENTS.md degrades AI coding performance. The dominant workaround is being deprecated by academic evidence. Developers who relied on it need an alternative. The timing window for establishing a replacement standard is open.

### 5. Category formation has begun

An adjacent builder disclosed a beta tool (contextarch.ai) on r/cursor on 16 March 2026. The category is entering early tooling phase. No dominant solution exists. No standard has been established.

### 6. The window is measured in months

Whoever establishes the zero-config, MCP-native, drift-aware standard earliest will own the default slot in developer workflows. That window is open now. It will not remain open indefinitely as AI vendors begin building native continuity features.

---

## 9. Target User

**Primary ICP:**

Intermediate to advanced developers building multi-session AI-assisted software projects, who already maintain some form of project documentation and value workflow efficiency. US-dominant, globally distributed.

Specifically:

- Uses Claude Code, Cursor, Windsurf, or any MCP-compatible AI coding tool daily
- Maintains project documentation across sessions (even if manually)
- Works on non-trivial projects spanning multiple days or weeks
- Has felt session restart friction or context preparation overhead
- Values setup simplicity — will not invest in a tool that requires significant configuration

**Secondary ICP:**

Advanced developers who have already built custom continuity infrastructure (RAG pipelines, vector databases, multi-source documentation systems). High switching intent once they understand that Context Fabric replaces their entire system with a single npm install.

---

## 10. Success Criteria

The product is succeeding when:

- Developers stop maintaining CLAUDE.md and AGENTS.md manually
- Session restart time drops to under 30 seconds
- Architecture decisions are captured without a separate workflow
- AI agents receive current, drift-warned context without developer preparation
- The phrase "let me re-explain the project" disappears from developer workflows

---

*Author: Vikas Sahani — North Star Hunter*  
*Document Type: Product Definition*  
*Phase: Post Discovery / Pre-Solution*  
*March 2026*  
