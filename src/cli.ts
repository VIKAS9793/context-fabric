#! /usr/bin/env node
// src/cli.ts
// Context Fabric CLI — Entry point for repo init and capture.

import { runWatcher } from './engines/watcher.js';
import { computeDrift } from './engines/anchor.js';
import { routeQuery, defaultRouterQuery } from './engines/router.js';
import { selectWithinBudget } from './engines/governor.js';
import { composeBriefing, loadSnapshot, loadDecisions } from './engines/weaver.js';
import { getDb } from './db/client.js';
import { writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const selfPath = resolve(__dirname, 'cli.js');

const command = process.argv[2];
const projectRoot = resolve('.');
const projectName = basename(projectRoot);
const db = getDb(projectRoot);

async function run() {
  switch (command) {
    case 'init': {
      console.log('Initialising Context Fabric...');
      
      if (process.platform === 'win32' && projectRoot.includes(' ')) {
        console.warn(
          '\x1b[33mWarning:\x1b[0m project path contains spaces. ' +
          'If the MCP server fails to start, move the project to a path without spaces.'
        );
      }
      
      const cfDir = resolve(projectRoot, '.context-fabric');
      if (!existsSync(cfDir)) mkdirSync(cfDir);

      console.log(`  ✓ Database initialised: .context-fabric/cf.db`);

      const hookPath = resolve(projectRoot, '.git/hooks/post-commit');
      // Use absolute node and cli path for robustness across shells (Windows/WSL/NVM)
      const nodePath = process.execPath;
      const hookContent = `#! /bin/sh\n# Context Fabric auto-capture\necho "Context Fabric: capturing state..."\n"${nodePath}" "${selfPath}" capture\n`;
      try {
        writeFileSync(hookPath, hookContent, { mode: 0o755 });
        if (existsSync(hookPath)) {
          console.log(`  ✓ git post-commit hook installed`);
        } else {
          throw new Error('File not created');
        }
      } catch {
        console.error(
          '  x  Hook installation failed. Check that .git/hooks/ directory exists.\n' +
          '     Run: mkdir .git\\hooks (Windows) or mkdir -p .git/hooks (Mac/Linux)\n' +
          '     Then run: npx context-fabric init again'
        );
      }

      const gitignorePath = resolve(projectRoot, '.gitignore');
      if (existsSync(gitignorePath)) {
        // Simple append if not already there
      } else {
        writeFileSync(gitignorePath, '.context-fabric/\n');
        console.log(`  ✓ .gitignore created with .context-fabric/ entry`);
      }

      const result = runWatcher(db, projectRoot);
      console.log(`  ✓ Initial capture: ${result.captured} files`);
      console.log(`\nContext Fabric is ready.`);
      break;
    }

    case 'capture': {
      const result = runWatcher(db, projectRoot);
      console.log(`Captured ${result.captured} files. SHA: ${result.git_sha}`);

      // Case 5: Verify hook is executable (Mac/Linux)
      const hookPath = join(projectRoot, '.git', 'hooks', 'post-commit');
      if (existsSync(hookPath) && process.platform !== 'win32') {
        try {
          const stats = statSync(hookPath);
          const isExecutable = (stats.mode & 0o111) !== 0;
          if (!isExecutable) {
            console.warn('\x1b[33mWarning:\x1b[0m post-commit hook exists but is not executable. Run: chmod +x .git/hooks/post-commit');
          }
        } catch { /* Ignore file access errors */ }
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
      const queryText = process.argv[3] || '';
      const snapshot = loadSnapshot(db);
      const decisions = loadDecisions(db);
      const drift = computeDrift(db, projectRoot);
      
      const routerQuery = { ...defaultRouterQuery, text: queryText, limit: 25 };
      const result = routeQuery(db, routerQuery);
      const budget = selectWithinBudget(result.ranked, { model: 'default', budget_pct: 0.1 });
      
      const briefing = composeBriefing({
        drift,
        budget,
        decisions,
        snapshot,
        projectName
      });

      console.log(briefing.briefing);
      break;
    }

    case 'diag': {
      console.log('\x1b[36mContext Fabric Diagnostic\x1b[0m');
      console.log('Node:          ', process.version);
      console.log('Platform:      ', process.platform);
      console.log('Arch:          ', process.arch);
      console.log('CWD:           ', process.cwd());
      console.log('PATH (head):   ', process.env.PATH?.split(process.platform === 'win32' ? ';' : ':').slice(0, 5).join('\n               ') + '...');
      
      const hookPath = join(projectRoot, '.git', 'hooks', 'post-commit');
      console.log('Hook installed:', existsSync(hookPath));
      
      const dbPath = join(projectRoot, '.context-fabric', 'cf.db');
      console.log('Database exists:', existsSync(dbPath));
      
      if (process.platform === 'win32' && projectRoot.includes(' ')) {
        console.log('Space Check:    \x1b[31mFAIL (Project path contains spaces)\x1b[0m');
      } else {
        console.log('Space Check:    \x1b[32mPASS\x1b[0m');
      }
      break;
    }

    default:
      console.log('Context Fabric — AI Project Continuity Infrastructure');
      console.log('\nCommands:');
      console.log('  init       Initialise in current git repo');
      console.log('  capture    Manual context capture');
      console.log('  drift      Check for context drift');
      console.log('  query      Generate AI briefing for a query');
      console.log('  diag       Print diagnostic info for debugging');
      break;
  }
}

run().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
