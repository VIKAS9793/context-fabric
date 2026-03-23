// src/index.ts
// MCP SERVER ENTRY POINT — Context Fabric

import { McpServer }           from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z }                   from 'zod';
import { resolve, basename }   from 'node:path';
import { getDb }               from './db/client.js';
import { runWatcher, getGitSha } from './engines/watcher.js';
import { computeDrift }        from './engines/anchor.js';
import { routeQuery, defaultRouterQuery } from './engines/router.js';
import { selectWithinBudget }  from './engines/governor.js';
import { composeBriefing, loadDecisions, loadSnapshot } from './engines/weaver.js';
import { PathGuard }           from './security/path-guard.js';
import { cache }               from './cache/result-cache.js';

const PROJECT_ROOT = resolve(process.cwd());
const PROJECT_NAME = basename(PROJECT_ROOT);
const db           = getDb(PROJECT_ROOT);
const guard        = new PathGuard(PROJECT_ROOT);
// Ensure PROJECT_ROOT is valid at startup
guard.validate('.');

const server = new McpServer({
  name:    'context-fabric',
  version: '1.0.2',
});

// ─── TOOL: cf_capture ────────────────────────────────────────────────────

server.tool(
  'cf_capture',
  'Capture current project state.',
  {},
  async () => {
    cache.invalidateAll();
    const result = runWatcher(db, PROJECT_ROOT);
    return {
      content: [{
        type: 'text' as const,
        text: `Captured: ${result.captured} files | SHA: ${result.git_sha}`,
      }],
    };
  },
);

// ─── TOOL: cf_drift ──────────────────────────────────────────────────────

server.tool(
  'cf_drift',
  'Check context drift. Returns severity.',
  {},
  async () => {
    const gitSha = getGitSha(PROJECT_ROOT);

    const report = await cache.getOrCompute(
      'drift_report',
      gitSha,
      () => computeDrift(db, PROJECT_ROOT),
    );

    if (!report) throw new Error('Failed to compute drift report');

    return {
      content: [{
        type: 'text' as const,
        text: [
          `Severity: ${report.severity}`,
          `Drift score: ${report.drift_score.toFixed(1)}%`,
          `Stale: ${report.stale.length} / ${report.total_components} components`,
          `Checked: ${new Date(report.checked_at).toISOString()}`,
        ].join('\n'),
      }],
    };
  },
);

// ─── TOOL: cf_query ──────────────────────────────────────────────────────

server.tool(
  'cf_query',
  'Get project context briefing.',
  {
    query: z.string().min(1)
      .describe('What context you need. Task description, component name, or question.'),
    budget_pct: z.number().min(0.01).max(0.20).optional().default(0.08)
      .describe('Fraction of model context window to use. Default: 0.08'),
    model: z.string().optional().default('default')
      .describe('Model name for context size lookup. Default: 200K tokens.'),
    include_drift: z.boolean().optional().default(true)
      .describe('Check drift and inject warnings. Default: true.'),
  },
  async ({ query, budget_pct = 0.08, model = 'default', include_drift = true }) => {
    const gitSha = getGitSha(PROJECT_ROOT);
    const cacheKey = `briefing:${query}:${budget_pct}:${model}`;

    const cached = await cache.getOrCompute(
      cacheKey,
      gitSha,
      () => null as string | null,
    );

    if (cached !== null) {
      return {
        content: [{
          type: 'text' as const,
          text: cached as string,
        }],
      };
    }

    // E2 ANCHOR
    const driftReport = include_drift
      ? await cache.getOrCompute(
          'drift_report',
          gitSha,
          () => computeDrift(db, PROJECT_ROOT),
        )
      : { drift_score: 0, severity: 'LOW' as const, stale: [], fresh: [],
          checked_at: Date.now(), total_components: 0 };

    if (!driftReport) throw new Error('Drift report unavailable');

    // E3 ROUTER
    const routerResult = await cache.getOrCompute(
      `route:${query}`,
      gitSha,
      () => routeQuery(db, defaultRouterQuery(query)),
    );

    if (!routerResult) throw new Error('Router result unavailable');

    // E4 GOVERNOR
    const budgetResult = selectWithinBudget(
      routerResult.ranked,
      { model, budget_pct },
    );

    // E5 WEAVER
    const decisions = loadDecisions(db);
    const snapshot  = loadSnapshot(db);

    const output = composeBriefing({
      drift:       driftReport,
      budget:      budgetResult,
      decisions,
      snapshot,
      projectName: PROJECT_NAME,
    });

    cache.store.set(cacheKey, {
      value:        output.briefing,
      computed_at:  Date.now(),
      git_sha:      gitSha,
    });

    return {
      content: [{
        type: 'text' as const,
        text: output.briefing,
      }],
    };
  },
);

// ─── TOOL: cf_log_decision ───────────────────────────────────────────────

server.tool(
  'cf_log_decision',
  'Log an architecture decision.',
  {
    title:     z.string().min(1).max(120).describe('Short name for the decision.'),
    rationale: z.string().min(1).max(600).describe('Why this decision was made.'),
    tags:      z.array(z.string().max(30)).max(10).optional()
                .describe('Optional tags.'),
  },
  async ({ title, rationale, tags }) => {
    cache.invalidateAll();

    db.prepare(`
      INSERT INTO cf_decisions (title, rationale, status, captured_at, tags)
      VALUES (@title, @rationale, 'active', @captured_at, @tags)
    `).run({
      title:       title.slice(0, 120),
      rationale:   rationale.slice(0, 600),
      captured_at: Date.now(),
      tags:        tags && tags.length > 0 ? JSON.stringify(tags) : null,
    });

    return {
      content: [{
        type: 'text' as const,
        text: `Decision logged: "${title.slice(0, 60)}"`,
      }],
    };
  },
);

// ─── START ────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  process.stderr.write(`[CF] Fatal: ${err}\n`);
  process.exit(1);
});
