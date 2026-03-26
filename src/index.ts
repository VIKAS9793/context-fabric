// src/index.ts
// MCP SERVER ENTRY POINT — Context Fabric

import { McpServer }           from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z }                   from 'zod';
import { resolve, basename }   from 'node:path';
import { ensureWritableDb, getDb } from './db/client.js';
import {
  ensureHeadCaptured,
  getLatestSuccessfulCaptureId,
  runWatcher,
} from './engines/watcher.js';
import { computeDrift }        from './engines/anchor.js';
import { routeQuery, defaultRouterQuery } from './engines/router.js';
import { selectWithinBudget }  from './engines/governor.js';
import { composeBriefing, loadDecisions, loadSnapshot } from './engines/weaver.js';
import { formatHealthReport, getHealthReport } from './health.js';
import { PathGuard }           from './security/path-guard.js';
import { sanitiseFileContent, sanitiseLabel } from './security/injection-guard.js';
import { cache, makeCacheKey } from './cache/result-cache.js';

const PROJECT_ROOT = resolve(process.cwd());
const PROJECT_NAME = basename(PROJECT_ROOT);
const db           = getDb(PROJECT_ROOT);
const guard        = new PathGuard(PROJECT_ROOT);
// Ensure PROJECT_ROOT is valid at startup
guard.validate('.');

const server = new McpServer({
  name:    'context-fabric',
  version: '1.0.5',
});

function countActiveComponents(): number {
  return (db.prepare(`
    SELECT COUNT(*) AS total
    FROM cf_components
    WHERE status = 'active'
  `).get() as { total: number }).total;
}

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
        text: result.deferred
          ? `Capture deferred for ${result.git_sha.slice(0, 12)} | pending run #${result.capture_id ?? 'n/a'}`
          : `Captured: ${result.captured} files | SHA: ${result.git_sha} | Capture #${result.capture_id ?? 'n/a'}`,
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
    const report = computeDrift(db, PROJECT_ROOT);

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
    const reconciliation = ensureHeadCaptured(db, PROJECT_ROOT);
    const captureId = reconciliation.capture_id ?? getLatestSuccessfulCaptureId(db);
    const captureVersion = `capture:${captureId ?? 'none'}`;
    const routeKey = makeCacheKey({
      kind: 'route',
      capture_id: captureId,
      query,
    });

    const routerResult = await cache.getOrCompute(
      routeKey,
      captureVersion,
      () => routeQuery(db, defaultRouterQuery(query)),
    );

    if (!routerResult) throw new Error('Router result unavailable');

    const totalComponents = countActiveComponents();
    const driftReport = include_drift
      ? computeDrift(db, PROJECT_ROOT)
      : {
          drift_score: 0,
          severity: 'LOW' as const,
          stale: [],
          fresh: [],
          checked_at: Date.now(),
          total_components: totalComponents,
        };

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
      operationalWarnings: reconciliation.warning ? [reconciliation.warning] : [],
    });

    const canCacheBriefing = !include_drift && !reconciliation.warning;
    if (!canCacheBriefing) {
      return {
        content: [{
          type: 'text' as const,
          text: output.briefing,
        }],
      };
    }

    const briefingKey = makeCacheKey({
      kind: 'briefing',
      capture_id: captureId,
      query,
      budget_pct,
      model,
      include_drift,
    });

    const briefing = await cache.getOrCompute(
      briefingKey,
      captureVersion,
      () => output.briefing,
    );

    return {
      content: [{
        type: 'text' as const,
        text: briefing ?? output.briefing,
      }],
    };
  },
);

// ─── TOOL: cf_health ─────────────────────────────────────────────────────

server.tool(
  'cf_health',
  'Report local database, capture, and hook health.',
  {},
  async () => {
    const report = getHealthReport(db, PROJECT_ROOT);
    return {
      content: [{
        type: 'text' as const,
        text: formatHealthReport(report),
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
    ensureWritableDb();
    cache.invalidateAll();

    db.prepare(`
      INSERT INTO cf_decisions (title, rationale, status, captured_at, tags)
      VALUES (@title, @rationale, 'active', @captured_at, @tags)
    `).run({
      title:       sanitiseLabel(title, 120),
      rationale:   sanitiseFileContent(rationale, 'decision').slice(0, 600),
      captured_at: Date.now(),
      tags:        tags && tags.length > 0 ? JSON.stringify(tags) : null,
    });

    return {
      content: [{
        type: 'text' as const,
        text: `Decision logged: "${sanitiseLabel(title, 60)}"`,
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
