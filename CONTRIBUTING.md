# Contributing to Context Fabric

Thank you for your interest in contributing. This document explains how to contribute effectively.

---

## Before You Start

- Check [existing issues](../../issues) before opening a new one
- For significant changes, open an issue first to discuss the approach
- All contributions must pass the verification checklist in [05_context_fabric_mvp_build_plan.md](docs/)

---

## Development Setup

```bash
git clone https://github.com/VIKAS9793/context-fabric.git
cd context-fabric
npm ci                # use ci — not install — for deterministic builds
npm run build
```

**Node version requirement:** `>=22.0.0 <25.0.0`  
Do not use Node 25 — better-sqlite3 prebuilt binaries are not available.

---

## Pinned Dependencies

These versions are locked. Do not change them in a PR without an accompanying issue explaining why:

| Package | Pinned version |
|---|---|
| `@modelcontextprotocol/sdk` | `1.27.1` |
| `better-sqlite3` | `12.8.0` |
| `zod` | `^4.3.6` |

---

## Code Standards

- TypeScript strict mode — zero errors, zero `any` without explicit cast
- ESM only — all imports use `.js` extensions
- No `async/await` on `better-sqlite3` calls — the library is synchronous
- All file paths must pass through `PathGuard` before `fs` operations
- All SQL must use parameterised prepared statements — no string interpolation
- No tool in `index.ts` may write to project files based on LLM input

---

## Testing a Change

After every code change:

```bash
npm run build           # must produce zero TypeScript errors
node dist/cli.js init   # test on a real git repo
```

Then verify manually:
1. Make a commit — confirm the git hook fires silently
2. Modify a file without committing — run `cf_drift` — confirm severity HIGH
3. Run `cf_query "auth"` — confirm E3 BM25 returns auth-related files first
4. Run `cf_query "auth"` again — confirm cache hit (instant response)
5. Make another commit — run `cf_query "auth"` — confirm cache invalidated

## Local Installation (Testing from Source)

For beta testing or local development, you should run Context Fabric directly from the source rather than the npm registry.

1. Clone the repository:
   ```bash
   git clone https://github.com/VIKAS9793/context-fabric.git
   cd context-fabric
   ```
2. Install dependencies (requires build tools for `better-sqlite3`):
   ```bash
   npm ci
   ```
3. Build the project:
   ```bash
   npm run build
   ```

### Linking to a Test Project

To test Context Fabric on your own codebase:
1. Navigate to your project: `cd /path/to/your-project`
2. Initialise using the local build:
   ```bash
   node /absolute/path/to/context-fabric/dist/cli.js init
   ```
3. Configure your IDE's MCP settings to point to the local `index.js`:
   ```json
   {
     "mcpServers": {
       "context-fabric": {
         "command": "node",
         "args": ["/absolute/path/to/context-fabric/dist/index.js"]
       }
     }
   }
   ```

---

## Pull Request Process

1. Fork the repository
2. Create a branch: `git checkout -b fix/description` or `feat/description`
3. Make your changes
4. Run `npm run build` — must pass with zero errors
5. Complete the verification checklist from the build plan
6. Open a pull request against `main`
7. Fill in the pull request template completely

PRs that skip the verification checklist will not be reviewed.

---

## Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add BM25 column weight configuration
fix: correct FTS5 trigger on component delete
docs: update MCP config paths for Windsurf
chore: pin better-sqlite3 to 12.8.0
```

Types: `feat` `fix` `docs` `chore` `refactor` `test` `perf`

---

## Reporting Bugs

Use the [bug report template](../../issues/new?template=bug_report.yml).

Include:
- Node version (`node --version`)
- OS
- Steps to reproduce
- Expected vs actual behaviour
- Whether the git hook is installed (`cat .git/hooks/post-commit`)

---

## Security Vulnerabilities

Do **not** open a public GitHub issue for security vulnerabilities.  
See [SECURITY.md](SECURITY.md) for the private disclosure process.

---

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be direct and respectful.
