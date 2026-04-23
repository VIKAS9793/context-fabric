# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.0.7 (current) | Yes |
| 1.0.5 | Yes — security fixes only |

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately via GitHub's Security Advisory feature:  
**[Report a vulnerability](../../security/advisories/new)**

Or email: `Vikassahani17@gmail.com`

Include in your report:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

You will receive acknowledgement within 48 hours. We aim to release a fix within 14 days for confirmed vulnerabilities.

---

## Threat Model

Context Fabric's designed attack surface is minimal by intent.

**What it can access:**
- Local filesystem — project root only. PathGuard validates all paths. Traversal attempts are rejected and logged to stderr.
- SQLite database — `.context-fabric/cf.db` only.
- Git metadata — `git rev-parse`, `git diff --name-only`, `git log -1 --oneline`. All hardcoded — no user input reaches shell commands.

**What it cannot do:**
- No outbound network connections
- No writes to project files from any tool call
- No execution of project code
- No access outside the project root

**Known threat mitigations:**

- **Path traversal (CVE-2025-68143 class):** `PathGuard` enforces the project-root boundary. NUL bytes, ASCII control characters, and paths longer than 4096 bytes are rejected. An optional `resolveSymlinks` mode resolves symlinks with `realpath()` and re-checks containment, blocking symlink-escape attacks where an attacker places a symlink under the project root that points outside it. E2 Anchor uses this mode on every drift read.
- **Prompt injection via file content:** `InjectionGuard` redacts an explicit pattern set (role spoofing, "ignore/disregard/forget previous instructions", "developer mode", "admin override", `DAN mode`, ChatML `<|im_start|>`, Llama `[INST]`, XML `<system>` tags, etc.), applies Unicode NFKC normalisation so full-width variants (`ｓｙｓｔｅｍ:`) collapse to their ASCII form, strips zero-width and bidirectional-override characters (Trojan Source, CVE-2021-42574), and caps input length before regex work so a large pasted file cannot cause catastrophic backtracking. All content is additionally wrapped in explicit `--- BEGIN DATA ---` boundaries.
- **SQL injection:** All runtime queries use parameterised prepared statements. The sole exception is `VACUUM INTO <path>` during schema migration, which SQLite does not allow to be parameterised; the destination path is constructed locally from `.context-fabric/` and rejects quotes and control characters before string interpolation.
- **Command injection:** All git operations use hardcoded argv arrays via `spawnSync` with `shell: false`. Every invocation also prepends `-c core.hooksPath=/dev/null -c protocol.ext.allow=never -c protocol.file.allow=never -c credential.helper= -c core.alternateRefsCommand= -c uploadpack.allowFilter=false` so a malicious per-repo git config or hook cannot hijack the MCP server. Ref arguments (SHAs) are validated against a strict hex pattern and preceded by `--end-of-options` so an argument that begins with `-` cannot be reinterpreted as a git flag.
- **Drift-hash consistency:** E1 Watcher hashes the raw git blob Buffer; E2 Anchor hashes the raw file Buffer from disk. Hashing identical bytes removes a class of false-positive drift reports from BOM-prefixed or CRLF-normalised files and keeps the two engines byte-equivalent.
- **Resource exhaustion:** Anchor caps per-file drift reads at 64 MiB; Router caps raw FTS5 query length at 4096 characters; InjectionGuard caps input at 64 KiB before regex work; `ResultCache` is a bounded LRU (1000 entries) so distinct queries cannot grow memory without bound.
- **Graceful shutdown:** The MCP server installs `SIGINT`/`SIGTERM`/`SIGHUP` handlers that close the SQLite connection so the WAL is always checkpointed cleanly.

---

## Out of Scope

The following are not considered security vulnerabilities for this project:

- Issues requiring physical access to the machine
- Issues in dependencies — report those to the dependency maintainer directly
- Theoretical vulnerabilities without a working proof of concept
