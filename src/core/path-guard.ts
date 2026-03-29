/**
 * Repository boundary enforcement for all file-system tool operations.
 *
 * PathGuard is a session singleton instantiated once at startup and injected
 * into ToolExecutor. All path checking is centralized there — individual tools
 * receive an already-resolved path and never call PathGuard directly. This
 * ensures new file tools cannot accidentally bypass the boundary check.
 *
 * P0 policy: all paths outside the project root are unconditionally denied.
 * P1 will introduce allow_paths config exceptions and the PathPolicy deny list
 * (BUILTIN_DENY for credential paths) once config schema support is added.
 */

import { realpathSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';

export type PathGuardResult =
  | { allowed: true; resolvedPath: string }
  | { allowed: false; reason: 'access-denied' | 'parent-missing' };

export class PathGuard {
  private projectRoot: string;
  private mode: 'strict' | 'warn';

  constructor(cwd: string, mode: 'strict' | 'warn' = 'strict') {
    this.projectRoot = PathGuard.findProjectRoot(cwd);
    this.mode = mode;
  }

  /**
   * Resolve a path and check it against the project boundary.
   *
   * @param rawPath   The raw path string from tool input.
   * @param mustExist true for read operations (file must exist); false for
   *                  write/edit operations (parent dir must exist).
   */
  check(rawPath: string, mustExist: boolean): PathGuardResult {
    let resolved: string;

    if (mustExist) {
      if (!existsSync(rawPath)) {
        return { allowed: false, reason: 'access-denied' };
      }
      resolved = realpathSync(rawPath);
    } else {
      // For writes: resolve the parent directory, then reconstruct the full path.
      // This follows symlinks in the parent while allowing the target file to not exist yet.
      const parentRaw = dirname(resolve(rawPath));
      if (!existsSync(parentRaw)) {
        return { allowed: false, reason: 'parent-missing' };
      }
      const resolvedParent = realpathSync(parentRaw);
      const filename = rawPath.split('/').at(-1)!;
      resolved = resolve(resolvedParent, filename);
    }

    const outside =
      !resolved.startsWith(this.projectRoot + '/') && resolved !== this.projectRoot;

    if (outside) {
      if (this.mode === 'warn') {
        // warn mode is for testing / debugging only — not used in production
        return { allowed: true, resolvedPath: resolved };
      }
      return { allowed: false, reason: 'access-denied' };
    }

    return { allowed: true, resolvedPath: resolved };
  }

  /**
   * Attempt to locate the git repository root starting from cwd.
   * Falls back to cwd itself if not inside a git repo.
   *
   * Runs exactly once per session (at PathGuard construction).
   */
  static findProjectRoot(cwd: string): string {
    try {
      return execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8' }).trim();
    } catch {
      return cwd;
    }
  }
}
