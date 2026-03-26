// src/project-paths.ts

import { join } from 'node:path';

export interface ContextFabricPaths {
  cfDir: string;
  binDir: string;
  runtimeDir: string;
  runtimeDistDir: string;
  runtimeCliPath: string;
  hookWrapperPath: string;
  gitHookPath: string;
  dbPath: string;
  gitignorePath: string;
}

export function getContextFabricPaths(projectRoot: string): ContextFabricPaths {
  const cfDir = join(projectRoot, '.context-fabric');
  const binDir = join(cfDir, 'bin');
  const runtimeDir = join(cfDir, 'runtime');
  const runtimeDistDir = join(runtimeDir, 'dist');

  return {
    cfDir,
    binDir,
    runtimeDir,
    runtimeDistDir,
    runtimeCliPath: join(runtimeDistDir, 'cli.js'),
    hookWrapperPath: join(binDir, 'post-commit'),
    gitHookPath: join(projectRoot, '.git', 'hooks', 'post-commit'),
    dbPath: join(cfDir, 'cf.db'),
    gitignorePath: join(projectRoot, '.gitignore'),
  };
}
