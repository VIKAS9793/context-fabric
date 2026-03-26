#! /usr/bin/env node
// src/cli.ts
// Context Fabric CLI — repo install, capture, query, and repair entry point.

import { computeDrift } from './engines/anchor.js';
import { selectWithinBudget } from './engines/governor.js';
import { routeQuery, defaultRouterQuery } from './engines/router.js';
import { composeBriefing, loadDecisions, loadSnapshot } from './engines/weaver.js';
import {
  ensureHeadCaptured,
  runHookCapture,
  runWatcher,
} from './engines/watcher.js';
import { ensureWritableDb, getDb, getDbRuntimeState } from './db/client.js';
import { rebuildSearchIndex } from './db/search-index.js';
import { formatHealthReport, getHealthReport } from './health.js';
import { getContextFabricPaths } from './project-paths.js';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distRoot = resolve(__dirname);

const command = process.argv[2];
const flags = new Set(process.argv.slice(3));
const queryArg = process.argv[3] ?? '';
const projectRoot = resolve('.');
const projectName = basename(projectRoot);
const db = getDb(projectRoot);
const runtimeState = getDbRuntimeState();

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function toShellPath(path: string): string {
  const normalised = path.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalised)) {
    return `/${normalised[0]!.toLowerCase()}${normalised.slice(2)}`;
  }
  return normalised;
}

function copyDirectoryRecursive(sourceDir: string, targetDir: string): void {
  ensureDir(targetDir);
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
      continue;
    }

    copyFileSync(sourcePath, targetPath);
  }
}

function installRuntimeBundle(): void {
  const paths = getContextFabricPaths(projectRoot);
  ensureDir(paths.runtimeDir);
  ensureDir(paths.runtimeDistDir);
  rmSync(paths.runtimeDistDir, { recursive: true, force: true });
  ensureDir(paths.runtimeDistDir);
  copyDirectoryRecursive(distRoot, paths.runtimeDistDir);
}

function ensureGitignoreEntry(): boolean {
  const paths = getContextFabricPaths(projectRoot);
  const entry = '.context-fabric/';

  if (!existsSync(paths.gitignorePath)) {
    writeFileSync(paths.gitignorePath, `${entry}\n`, 'utf8');
    return true;
  }

  const current = readFileSync(paths.gitignorePath, 'utf8');
  const lines = current.split(/\r?\n/);
  if (lines.includes(entry)) return false;

  const separator = current.endsWith('\n') || current.length === 0 ? '' : '\n';
  writeFileSync(paths.gitignorePath, `${current}${separator}${entry}\n`, 'utf8');
  return true;
}

function installHookWrapper(): void {
  const paths = getContextFabricPaths(projectRoot);
  ensureDir(paths.binDir);

  const nodePath = toShellPath(process.execPath);
  const wrapper = [
    '#!/bin/sh',
    '# Context Fabric stable hook wrapper',
    'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"',
    'PROJECT_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"',
    `NODE_BIN="${nodePath}"`,
    'RUNTIME="$PROJECT_ROOT/.context-fabric/runtime/dist/cli.js"',
    'if [ ! -x "$NODE_BIN" ]; then',
    '  NODE_BIN=node',
    'fi',
    '"$NODE_BIN" "$RUNTIME" capture --hook --silent',
    '',
  ].join('\n');
  writeFileSync(paths.hookWrapperPath, wrapper, { mode: 0o755 });

  const hook = [
    '#!/bin/sh',
    '# Context Fabric post-commit entry',
    'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"',
    'PROJECT_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"',
    '"$PROJECT_ROOT/.context-fabric/bin/post-commit"',
    '',
  ].join('\n');
  writeFileSync(paths.gitHookPath, hook, { mode: 0o755 });
}

function printHealth(): void {
  console.log(formatHealthReport(getHealthReport(db, projectRoot)));
}

function runDoctor(repair: boolean): void {
  console.log('\x1b[36mContext Fabric Doctor\x1b[0m');
  console.log(`Project: ${projectRoot}`);
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform}/${process.arch}`);

  if (repair) {
    const paths = getContextFabricPaths(projectRoot);
    ensureDir(paths.cfDir);
    installRuntimeBundle();
    installHookWrapper();
    const updatedGitignore = ensureGitignoreEntry();
    console.log('Repair: runtime bundle refreshed');
    console.log('Repair: hook wrapper regenerated');
    console.log(`Repair: .gitignore ${updatedGitignore ? 'updated' : 'already correct'}`);

    if (!runtimeState.degraded) {
      ensureWritableDb();
      rebuildSearchIndex(db);
      console.log('Repair: search index rebuilt');
    } else {
      console.log(`Repair: search index rebuild skipped (${runtimeState.degradedReason ?? 'database degraded'})`);
    }
  }

  printHealth();
}

async function run(): Promise<void> {
  switch (command) {
    case 'init': {
      console.log('Initialising Context Fabric...');

      if (process.platform === 'win32' && projectRoot.includes(' ')) {
        console.warn(
          '\x1b[33mWarning:\x1b[0m project path contains spaces. ' +
          'If the MCP server fails to start, move the project to a path without spaces.'
        );
      }

      const paths = getContextFabricPaths(projectRoot);
      ensureDir(paths.cfDir);
      installRuntimeBundle();
      installHookWrapper();

      console.log('  ✓ Database initialised: .context-fabric/cf.db');
      console.log('  ✓ Stable hook wrapper installed');
      console.log('  ✓ Runtime bundle installed under .context-fabric/runtime');
      console.log(`  ✓ .gitignore ${ensureGitignoreEntry() ? 'updated' : 'already contains .context-fabric/'}`);

      const result = runWatcher(db, projectRoot);
      console.log(`  ✓ Initial capture: ${result.captured} files`);
      console.log('\nContext Fabric is ready.');
      break;
    }

    case 'capture': {
      const silent = flags.has('--silent');
      const fromHook = flags.has('--hook');
      const result = fromHook
        ? runHookCapture(db, projectRoot)
        : runWatcher(db, projectRoot);

      if (!silent) {
        if (result.deferred) {
          console.log(`Deferred capture for ${result.git_sha}. Pending run #${result.capture_id ?? 'n/a'}`);
        } else {
          console.log(`Captured ${result.captured} files. SHA: ${result.git_sha}. Capture #${result.capture_id ?? 'n/a'}`);
        }
      }
      break;
    }

    case 'drift': {
      const report = computeDrift(db, projectRoot);
      console.log(`Context Drift — Severity: ${report.severity} (${report.drift_score.toFixed(1)}%)`);
      console.log(`Stale files: ${report.stale.length}`);
      for (const entry of report.stale) {
        console.log(`  - ${entry.path} (${entry.current_sha === 'DELETED' ? 'Deleted' : 'Modified'})`);
      }
      break;
    }

    case 'query': {
      const reconciliation = ensureHeadCaptured(db, projectRoot);
      const snapshot = loadSnapshot(db);
      const decisions = loadDecisions(db);
      const drift = computeDrift(db, projectRoot);
      const result = routeQuery(db, defaultRouterQuery(queryArg));
      const budget = selectWithinBudget(result.ranked, { model: 'default', budget_pct: 0.1 });
      const briefing = composeBriefing({
        drift,
        budget,
        decisions,
        snapshot,
        projectName,
        operationalWarnings: reconciliation.warning ? [reconciliation.warning] : [],
      });

      console.log(briefing.briefing);
      break;
    }

    case 'doctor':
    case 'diag': {
      runDoctor(flags.has('--repair'));
      break;
    }

    default:
      console.log('Context Fabric — AI Project Continuity Infrastructure');
      console.log('\nCommands:');
      console.log('  init          Initialise in current git repo');
      console.log('  capture       Manual context capture');
      console.log('  drift         Check for context drift');
      console.log('  query         Generate AI briefing for a query');
      console.log('  doctor        Print health and repair with --repair');
      console.log('  diag          Compatibility alias for doctor');
      break;
  }
}

run().catch(err => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
