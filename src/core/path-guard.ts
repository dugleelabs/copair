/**
 * Repository boundary enforcement for all file-system tool operations.
 *
 * PathGuard is a session singleton instantiated once at startup and injected
 * into ToolExecutor. All path checking is centralized there — individual tools
 * receive an already-resolved path and never call PathGuard directly. This
 * ensures new file tools cannot accidentally bypass the boundary check.
 *
 * P0 policy: all paths outside the project root are unconditionally denied.
 * P1 policy: PathPolicy introduces an allow_paths escape hatch (subject to
 * normal approval gate) and a deny_paths override for the built-in deny list.
 * Paths matching the deny list are always denied, regardless of allow_paths.
 *
 * Check order (outside-project paths only):
 *   1. Built-in deny list / deny_paths → hard deny
 *   2. allow_paths glob match → allow (to approval gate)
 *   3. Default → deny (strict) or warn+allow (warn mode)
 *
 * Note on .env patterns: BUILTIN_DENY includes glob patterns for .env files
 * scoped to paths outside the project root. Paths inside the project root
 * return at step 1 of check() before the deny list is evaluated, so .env
 * files inside the project are subject only to the normal approval gate.
 */

import { realpathSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { minimatch } from 'minimatch';

export type PathGuardResult =
  | { allowed: true; resolvedPath: string }
  | { allowed: false; reason: 'access-denied' | 'parent-missing' };

/**
 * P1 policy configuration for cross-project path access.
 * Sourced from `permissions.allow_paths` and `permissions.deny_paths` in config.
 */
export interface PathPolicy {
  /** Glob patterns of paths outside the project root that the agent may request access to. */
  allowPaths: string[];
  /**
   * Glob patterns unconditionally denied regardless of approval mode or session overrides.
   * When non-empty, replaces BUILTIN_DENY entirely. To add to the built-in list, spread
   * BUILTIN_DENY into this array.
   */
  denyPaths: string[];
}

/**
 * Built-in deny list — credential and sensitive paths that are always denied
 * when accessed from outside the project root. Overridable only by providing
 * a non-empty `denyPaths` array in PathPolicy, which replaces this list entirely.
 */
export const BUILTIN_DENY: string[] = [
  '~/.ssh/**',
  '~/.gnupg/**',
  '~/.aws/credentials',
  '~/.aws/config',
  '~/.config/gcloud/**',
  '~/.kube/config',
  '~/.docker/config.json',
  '~/.netrc',
  '~/Library/Keychains/**',
  '**/.env',
  '**/.env.*',
  '**/.env.local',
];

/** Expand a leading `~/` or bare `~` to the OS home directory. */
export function expandHome(pattern: string): string {
  if (pattern === '~') return homedir();
  if (pattern.startsWith('~/')) return homedir() + pattern.slice(1);
  return pattern;
}

export class PathGuard {
  private projectRoot: string;
  private mode: 'strict' | 'warn';
  private expandedDenyPatterns: string[];
  private expandedAllowPatterns: string[];

  constructor(cwd: string, mode: 'strict' | 'warn' = 'strict', policy?: PathPolicy) {
    this.projectRoot = PathGuard.findProjectRoot(cwd);
    this.mode = mode;

    // If denyPaths is non-empty, use it in place of the built-in list.
    const denySource = policy?.denyPaths.length ? policy.denyPaths : BUILTIN_DENY;
    this.expandedDenyPatterns = denySource.map(expandHome);
    this.expandedAllowPatterns = (policy?.allowPaths ?? []).map(expandHome);
  }

  /**
   * Resolve a path and check it against the project boundary and deny/allow lists.
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

    const inside =
      resolved.startsWith(this.projectRoot + '/') || resolved === this.projectRoot;

    if (inside) {
      return { allowed: true, resolvedPath: resolved };
    }

    // Outside project root: check deny list (hard deny, not affected by warn mode).
    if (this.isDenied(resolved)) {
      return { allowed: false, reason: 'access-denied' };
    }

    // Check allow list (P1 escape hatch for legitimate cross-project access).
    if (this.isAllowed(resolved)) {
      return { allowed: true, resolvedPath: resolved };
    }

    // Default outside-project behavior.
    if (this.mode === 'warn') {
      return { allowed: true, resolvedPath: resolved };
    }
    return { allowed: false, reason: 'access-denied' };
  }

  private isDenied(resolved: string): boolean {
    return this.expandedDenyPatterns.some(pattern =>
      minimatch(resolved, pattern, { dot: true }),
    );
  }

  private isAllowed(resolved: string): boolean {
    return this.expandedAllowPatterns.some(pattern =>
      minimatch(resolved, pattern, { dot: true }),
    );
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
