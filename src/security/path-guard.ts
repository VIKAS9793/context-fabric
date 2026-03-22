// src/security/path-guard.ts

import { resolve, relative } from 'node:path';

export class PathGuard {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    // Resolve once at construction — projectRoot is trusted
    this.projectRoot = resolve(projectRoot);
  }

  /**
   * Validates that a path resolves within the project root.
   * Throws if path traversal is detected.
   * Returns the resolved absolute path if safe.
   */
  validate(inputPath: string): string {
    const resolved = resolve(this.projectRoot, inputPath);
    const rel = relative(this.projectRoot, resolved);

    // Path traversal: relative path starts with '..' or is absolute outside root
    if (rel.startsWith('..') || resolve(rel) === rel) {
      throw new Error(
        `SECURITY: Path traversal rejected. ` +
        `Input "${inputPath}" resolves outside project root "${this.projectRoot}"`
      );
    }

    return resolved;
  }

  /**
   * Returns relative path from project root.
   * Used for storing paths in SQLite — never store absolute paths.
   */
  toRelative(absolutePath: string): string {
    return relative(this.projectRoot, absolutePath);
  }

  /**
   * Validates a list of paths. Returns only the safe ones.
   * Silently drops unsafe paths — used for batch git diff processing.
   */
  validateBatch(paths: string[]): string[] {
    const safe: string[] = [];
    for (const p of paths) {
      try {
        this.validate(p);
        safe.push(p);
      } catch {
        // Log to stderr, not stdout — never surface security rejections to AI context
        process.stderr.write(`[CF SECURITY] Path rejected: ${p}\n`);
      }
    }
    return safe;
  }
}
