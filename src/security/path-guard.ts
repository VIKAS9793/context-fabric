// src/security/path-guard.ts

import { realpathSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';

const MAX_PATH_LENGTH = 4096;

function hasControlCharacters(input: string): boolean {
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export interface PathGuardValidateOptions {
  /**
   * Reject inputs that are absolute paths. Defaults to `false` for backward
   * compatibility — absolute paths are permitted so long as they resolve
   * within the project root.
   */
  rejectAbsolute?: boolean;
  /**
   * If the resolved target exists, also resolve symlinks via `realpath()`
   * and re-check that the real path stays inside the project root. This
   * blocks symlink-escape attacks on systems where the resolved path would
   * point outside the project root.
   */
  resolveSymlinks?: boolean;
}

export class PathGuard {
  private readonly projectRoot: string;
  private readonly realProjectRoot: string;

  constructor(projectRoot: string) {
    // Resolve once at construction — projectRoot is trusted
    this.projectRoot = resolve(projectRoot);
    this.realProjectRoot = (() => {
      try {
        return realpathSync(this.projectRoot);
      } catch {
        return this.projectRoot;
      }
    })();
  }

  /**
   * Validates that a path resolves within the project root.
   * Throws if path traversal is detected, if the path contains a NUL byte
   * or other control character, or if the path is unreasonably long.
   * Returns the resolved absolute path if safe.
   */
  validate(inputPath: string, options: PathGuardValidateOptions = {}): string {
    if (typeof inputPath !== 'string') {
      throw new TypeError(`SECURITY: Path must be a string, received ${typeof inputPath}`);
    }

    if (inputPath.length === 0) {
      // Empty input resolves to the project root itself — allow.
    } else if (inputPath.length > MAX_PATH_LENGTH) {
      throw new Error(`SECURITY: Path exceeds maximum length (${MAX_PATH_LENGTH}).`);
    }

    if (inputPath.includes('\0')) {
      throw new Error('SECURITY: Path contains NUL byte.');
    }

    if (hasControlCharacters(inputPath)) {
      throw new Error(`SECURITY: Path contains control characters: "${inputPath}"`);
    }

    if (options.rejectAbsolute && isAbsolute(inputPath)) {
      throw new Error(`SECURITY: Absolute paths are not permitted: "${inputPath}"`);
    }

    const resolved = resolve(this.projectRoot, inputPath);
    this.assertInsideRoot(resolved, inputPath);

    if (options.resolveSymlinks && existsSync(resolved)) {
      let real: string;
      try {
        real = realpathSync(resolved);
      } catch {
        // Unreadable target; treat as safe because the path itself is already
        // under the project root — callers will fail at the actual read.
        return resolved;
      }
      this.assertInsideRoot(real, inputPath, this.realProjectRoot);
    }

    return resolved;
  }

  private assertInsideRoot(
    candidate: string,
    inputPath: string,
    root: string = this.projectRoot,
  ): void {
    const rel = relative(root, candidate);
    if (rel === '') return;
    const outside =
      rel.startsWith(`..${sep}`) ||
      rel === '..' ||
      isAbsolute(rel);
    if (outside) {
      throw new Error(
        `SECURITY: Path traversal rejected. ` +
        `Input "${inputPath}" resolves outside project root "${root}"`
      );
    }
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
