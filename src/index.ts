// src/index.ts
// MCP SERVER ENTRY POINT — Context Fabric

import { McpServer }           from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z }                   from 'zod';
import { resolve, basename }   from 'node:path';
import { closeDb, ensureWritableDb, getDb } from './db/client.js';
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
  version: '1.1.0',
});

function countActiveComponents(): number {
  return (db.prepare(`
    SELECT COUNT(*) AS total
    FROM cf_components
    WHERE status = 'active'
  `).get() as { total: number }).total;
}

// ─── TOOL: cf_capture ────────────────────────────────────────────────────

server.registerTool(
  'cf_capture',
  {
    title:       'Capture Project State',
    description: 'Capture current project state.',
    inputSchema: {},
    outputSchema: {
      captured:   z.number().describe('Count of files processed.'),
      git_sha:    z.string().describe('Git SHA the capture was taken against.'),
      timestamp:  z.number().describe('Unix ms when the capture ran.'),
      capture_id: z.number().nullable().describe('Row id of the capture run, if one was created.'),
      deferred:   z.boolean().optional().describe('True if the capture was deferred rather than run immediately.'),
    },
    annotations: {
      title:           'Capture Project State',
      readOnlyHint:    false, // writes capture rows and invalidates cache
      destructiveHint: false, // appends/updates state, does not delete prior captures
      idempotentHint:  false, // each call can create a new capture run
      openWorldHint:   false, // local filesystem + git only, no external calls
    },
  },
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
      structuredContent: {
        captured:   result.captured,
        git_sha:    result.git_sha,
        timestamp:  result.timestamp,
        capture_id: result.capture_id ?? null,
        deferred:   result.deferred ?? false,
      },
    };
  },
);

// ─── TOOL: cf_drift ──────────────────────────────────────────────────────

server.registerTool(
  'cf_drift',
  {
    title:       'Check Context Drift',
    description: 'Check context drift. Returns severity.',
    inputSchema: {},
    outputSchema: {
      severity:         z.enum(['LOW', 'MED', 'HIGH']),
      drift_score:      z.number().describe('0-100, rounded to 1 decimal.'),
      stale_count:      z.number(),
      fresh_count:       z.number(),
      total_components: z.number(),
      checked_at:       z.number().describe('Unix ms.'),
    },
    annotations: {
      title:           'Check Context Drift',
      readOnlyHint:    true,
      destructiveHint: false,
      idempotentHint:  true,
      openWorldHint:   false,
    },
  },
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
      structuredContent: {
        severity:         report.severity,
        drift_score:      report.drift_score,
        stale_count:      report.stale.length,
        fresh_count:      report.fresh.length,
        total_components: report.total_components,
        checked_at:       report.checked_at,
      },
    };
  },
);

// ─── TOOL: cf_query ──────────────────────────────────────────────────────

server.registerTool(
  'cf_query',
  {
    title:       'Get Context Briefing',
    description: 'Get project context briefing.',
    inputSchema: {
      query: z.string().min(1).max(4096)
        .describe('What context you need. Task description, component name, or question.'),
      budget_pct: z.number().min(0.01).max(0.20).optional().default(0.08)
        .describe('Fraction of model context window to use. Default: 0.08'),
      model: z.string().max(120).optional().default('default')
        .describe('Model name for context size lookup. Default: 200K tokens.'),
      include_drift: z.boolean().optional().default(true)
        .describe('Check drift and inject warnings. Default: true.'),
    },
    // No outputSchema: the briefing is prose for injection into an agent's
    // context window, not a data structure any known consumer parses.
    // Forcing structured output here would constrain the format for no
    // client benefit — deliberate omission, not an oversight.
    annotations: {
      title:           'Get Context Briefing',
      readOnlyHint:    false, // ensureHeadCaptured() can run a write via runWatcher()
      destructiveHint: false,
      idempotentHint:  false,
      openWorldHint:   false,
    },
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

server.registerTool(
  'cf_health',
  {
    title:       'Check System Health',
    description: 'Report local database, capture, and hook health.',
    inputSchema: {},
    outputSchema: {
      schema_version:       z.number(),
      search_index_version: z.number(),
      db_integrity:         z.enum(['ok', 'failed']),
      degraded:             z.boolean(),
      degraded_reason:      z.string().nullable(),
      latest_successful_capture: z.object({
        id:             z.number(),
        git_sha:        z.string(),
        completed_at:   z.number().nullable(),
        indexed_files:  z.number(),
        skipped_count:  z.number(),
      }).nullable(),
      pending_capture_count:  z.number(),
      failed_capture_count:   z.number(),
      latest_skipped_summary: z.record(z.string(), z.number()),
      hook_installed:         z.boolean(),
      hook_runtime_ready:     z.boolean(),
    },
    annotations: {
      title:           'Check System Health',
      readOnlyHint:    true,
      destructiveHint: false,
      idempotentHint:  true,
      openWorldHint:   false,
    },
  },
  async () => {
    const report = getHealthReport(db, PROJECT_ROOT);
    return {
      content: [{
        type: 'text' as const,
        text: formatHealthReport(report),
      }],
      structuredContent: {
        schema_version:            report.schema_version,
        search_index_version:      report.search_index_version,
        db_integrity:              report.db_integrity,
        degraded:                  report.degraded,
        degraded_reason:           report.degraded_reason,
        latest_successful_capture: report.latest_successful_capture,
        pending_capture_count:     report.pending_capture_count,
        failed_capture_count:      report.failed_capture_count,
        latest_skipped_summary:    report.latest_skipped_summary,
        hook_installed:            report.hook_installed,
        hook_runtime_ready:        report.hook_runtime_ready,
      },
    };
  },
);

// ─── TOOL: cf_log_decision ───────────────────────────────────────────────

server.registerTool(
  'cf_log_decision',
  {
    title:       'Log Architecture Decision',
    description: 'Log an architecture decision.',
    inputSchema: {
      title:     z.string().min(1).max(120).describe('Short name for the decision.'),
      rationale: z.string().min(1).max(600).describe('Why this decision was made.'),
      tags:      z.array(z.string().max(30)).max(10).optional()
                  .describe('Optional tags.'),
    },
    outputSchema: {
      id:     z.number().describe('Row id of the logged decision.'),
      title:  z.string(),
      status: z.literal('active'),
    },
    annotations: {
      title:           'Log Architecture Decision',
      readOnlyHint:    false,
      destructiveHint: false, // inserts a new row, never overwrites/removes one
      idempotentHint:  false, // each call inserts another decision row
      openWorldHint:   false,
    },
  },
  async ({ title, rationale, tags }) => {
    ensureWritableDb();
    cache.invalidateAll();

    const sanitisedTitle = sanitiseLabel(title, 120);
    const result = db.prepare(`
      INSERT INTO cf_decisions (title, rationale, status, captured_at, tags)
      VALUES (@title, @rationale, 'active', @captured_at, @tags)
    `).run({
      title:       sanitisedTitle,
      rationale:   sanitiseFileContent(rationale, 'decision').slice(0, 600),
      captured_at: Date.now(),
      tags:        tags && tags.length > 0 ? JSON.stringify(tags) : null,
    });

    return {
      content: [{
        type: 'text' as const,
        text: `Decision logged: "${sanitiseLabel(title, 60)}"`,
      }],
      structuredContent: {
        id:     Number(result.lastInsertRowid),
        title:  sanitisedTitle,
        status: 'active' as const,
      },
    };
  },
);

// ─── SHUTDOWN HANDLERS ────────────────────────────────────────────────────

// SECURITY / RELIABILITY: better-sqlite3 uses WAL mode; a process killed
// without calling `db.close()` can leave the WAL file unmerged. Closing on
// SIGINT / SIGTERM ensures the on-disk state is consistent and that other
// processes (e.g. the git hook) can reopen the database without being
// blocked by a stale lock.
let shuttingDown = false;
function gracefulShutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    closeDb();
  } catch (err) {
    process.stderr.write(`[CF] Error closing db on ${signal}: ${err}\n`);
  }
  process.exit(0);
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGHUP',  () => gracefulShutdown('SIGHUP'));

// ─── START ────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  process.stderr.write(`[CF] Fatal: ${err}\n`);
  try { closeDb(); } catch { /* best effort */ }
  process.exit(1);
});
