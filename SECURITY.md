# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.0.4 (current) | Yes |

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
- Path traversal (CVE-2025-68143 class): PathGuard enforces project root boundary
- Prompt injection via file content: InjectionGuard strips documented attack patterns and wraps content in DATA: boundaries
- SQL injection: all queries use parameterised prepared statements
- Command injection: all git operations use hardcoded arguments via `execSync` or `spawnSync`

---

## Out of Scope

The following are not considered security vulnerabilities for this project:

- Issues requiring physical access to the machine
- Issues in dependencies — report those to the dependency maintainer directly
- Theoretical vulnerabilities without a working proof of concept
