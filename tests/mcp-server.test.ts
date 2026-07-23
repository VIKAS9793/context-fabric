// tests/mcp-server.test.ts
// Protocol-level regression test for the MCP server entry point (src/index.ts).
//
// WHY THIS EXISTS: vitest.config.ts intentionally excludes src/index.ts from
// coverage ("entry points, not logic") — that's correct for line coverage,
// but it left zero automated verification that the actual MCP wire protocol
// (tool registration, annotations, outputSchema, structuredContent) behaves
// as intended. The existing CI "Smoke Test" step only runs `cli.js init` and
// checks for db file creation; it never calls a single MCP tool. This test
// closes that gap by driving the real, built server with the real SDK
// client over a real stdio transport. No mocking of the protocol layer.
//
// PREREQUISITE: requires `npm run build` to have already produced
// dist/index.js. This matches the existing project convention in
// .github/workflows/ci.yml, where "Build project" runs before "Run tests".
// If dist/index.js is missing, this file fails fast with a clear message
// rather than a confusing spawn error.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PROJECT_ROOT = resolve(process.cwd());
const SERVER_ENTRY = join(PROJECT_ROOT, 'dist', 'index.js');

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

let testRoot: string;
let client: Client;

beforeAll(async () => {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(
      `${SERVER_ENTRY} does not exist. Run \`npm run build\` before \`npm test\` ` +
      `(this matches the existing order in .github/workflows/ci.yml).`,
    );
  }

  // Isolated temp git repo as PROJECT_ROOT — never touch the real repo's
  // own .context-fabric/ state.
  testRoot = join(tmpdir(), `cf-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testRoot, { recursive: true });
  git(testRoot, ['init']);
  git(testRoot, ['config', 'user.email', 'test@cf.test']);
  git(testRoot, ['config', 'user.name', 'CF Test']);

  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(testRoot, 'README.md'), '# test project\n');
  git(testRoot, ['add', '.']);
  git(testRoot, ['commit', '-m', 'initial commit']);

  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_ENTRY],
    cwd: testRoot,
  });
  client = new Client({ name: 'cf-protocol-test', version: '1.0.0' });
  await client.connect(transport);
});

afterAll(async () => {
  await client?.close();
  if (testRoot && existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true });
  }
});

describe('MCP server — tool registration', () => {
  it('exposes exactly the five expected tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([
      'cf_capture',
      'cf_drift',
      'cf_health',
      'cf_log_decision',
      'cf_query',
    ]);
  });

  it('marks read-only tools correctly, accounting for cf_query\'s write side effect', async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map(t => [t.name, t]));

    // cf_drift and cf_health are pure reads.
    expect(byName.cf_drift.annotations?.readOnlyHint).toBe(true);
    expect(byName.cf_health.annotations?.readOnlyHint).toBe(true);

    // cf_query looks like a read but calls ensureHeadCaptured(), which can
    // run a write via runWatcher() when HEAD isn't already captured. It
    // must NOT claim readOnlyHint: true — that would be a false signal to
    // any client that uses annotations to decide what to auto-approve.
    expect(byName.cf_query.annotations?.readOnlyHint).toBe(false);

    // cf_capture and cf_log_decision are explicit writes.
    expect(byName.cf_capture.annotations?.readOnlyHint).toBe(false);
    expect(byName.cf_log_decision.annotations?.readOnlyHint).toBe(false);
  });

  it('has outputSchema on every tool except cf_query', async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map(t => [t.name, t]));

    expect(byName.cf_capture.outputSchema).toBeDefined();
    expect(byName.cf_drift.outputSchema).toBeDefined();
    expect(byName.cf_health.outputSchema).toBeDefined();
    expect(byName.cf_log_decision.outputSchema).toBeDefined();

    // Deliberate omission: the briefing is prose for injection into an
    // agent's context, not a data structure any known consumer parses.
    expect(byName.cf_query.outputSchema).toBeUndefined();
  });
});

describe('MCP server — structuredContent shape', () => {
  it('cf_health returns structuredContent matching its outputSchema', async () => {
    const result = await client.callTool({ name: 'cf_health', arguments: {} });
    expect(result.structuredContent).toMatchObject({
      db_integrity: 'ok',
      degraded: expect.any(Boolean),
      pending_capture_count: expect.any(Number),
      failed_capture_count: expect.any(Number),
      hook_installed: expect.any(Boolean),
      hook_runtime_ready: expect.any(Boolean),
    });
    // Text content must still be present — structured output is additive,
    // not a replacement, for any client that hasn't adopted outputSchema.
    expect(result.content).toEqual([
      expect.objectContaining({ type: 'text' }),
    ]);
  });

  it('cf_drift returns structuredContent with counts, not full file lists', async () => {
    const result = await client.callTool({ name: 'cf_drift', arguments: {} });
    expect(result.structuredContent).toMatchObject({
      severity: expect.stringMatching(/^(LOW|MED|HIGH)$/),
      drift_score: expect.any(Number),
      stale_count: expect.any(Number),
      fresh_count: expect.any(Number),
      total_components: expect.any(Number),
      checked_at: expect.any(Number),
    });
    // Explicitly not the full StaleEntry[] — that's a separate scope
    // decision, not bundled in here.
    expect(result.structuredContent).not.toHaveProperty('stale');
    expect(result.structuredContent).not.toHaveProperty('fresh');
  });

  it('cf_log_decision returns the inserted row id', async () => {
    const result = await client.callTool({
      name: 'cf_log_decision',
      arguments: { title: 'protocol test decision', rationale: 'verifying structuredContent.id' },
    });
    expect(result.structuredContent).toMatchObject({
      id: expect.any(Number),
      title: 'protocol test decision',
      status: 'active',
    });
  });

  it('cf_capture returns a structuredContent shape matching CaptureResult', async () => {
    const result = await client.callTool({ name: 'cf_capture', arguments: {} });
    expect(result.structuredContent).toMatchObject({
      captured: expect.any(Number),
      git_sha: expect.stringMatching(/^[0-9a-f]{40}$/),
      timestamp: expect.any(Number),
    });
  });

  it('cf_query has no structuredContent, by design', async () => {
    const result = await client.callTool({
      name: 'cf_query',
      arguments: { query: 'test' },
    });
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: 'text' });
  });
});
