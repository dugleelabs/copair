import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { PathGuard } from '../../src/core/path-guard.js';

/**
 * Creates a temp dir with a .git/ folder so git rev-parse sees it as a repo root.
 */
function makeTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'copair-pathguard-'));
  execSync('git init -q', { cwd: dir });
  return dir;
}

/**
 * Creates a temp dir with NO git repo.
 */
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'copair-pathguard-'));
}

describe('PathGuard', () => {
  let projectRoot: string;
  let guard: PathGuard;

  beforeEach(() => {
    projectRoot = makeTempGitRepo();
    guard = new PathGuard(projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  // ── Happy paths ───────────────────────────────────────────────────────────

  it('allows a path inside the project root (mustExist: true)', () => {
    const filePath = join(projectRoot, 'src', 'index.ts');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(filePath, '');

    const result = guard.check(filePath, true);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      // Use realpathSync to handle macOS /var → /private/var symlinks
      expect(result.resolvedPath).toBe(realpathSync(filePath));
    }
  });

  it('allows writing to a new file inside the project (mustExist: false)', () => {
    const filePath = join(projectRoot, 'output.txt');
    const result = guard.check(filePath, false);
    expect(result.allowed).toBe(true);
  });

  it('allows the project root directory itself', () => {
    writeFileSync(join(projectRoot, 'README.md'), '');
    const result = guard.check(join(projectRoot, 'README.md'), true);
    expect(result.allowed).toBe(true);
  });

  // ── Denied: outside project root ─────────────────────────────────────────

  it('denies a path outside the project root (strict mode)', () => {
    const result = guard.check('/etc/hosts', true);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('access-denied');
    }
  });

  it('denies /tmp path (outside project root)', () => {
    const outsideFile = join(tmpdir(), 'outside.txt');
    writeFileSync(outsideFile, '');
    const result = guard.check(outsideFile, true);
    expect(result.allowed).toBe(false);
  });

  it('denies ../ traversal that escapes project root', () => {
    const traversal = join(projectRoot, '..', 'etc', 'passwd');
    const result = guard.check(traversal, false);
    // Either the path resolves outside and is denied, or the parent doesn't exist
    expect(result.allowed).toBe(false);
  });

  // ── Symlink escape ────────────────────────────────────────────────────────

  it('denies a symlink inside the project that points outside', () => {
    const linkPath = join(projectRoot, 'escape-link');
    symlinkSync('/etc/hosts', linkPath);

    const result = guard.check(linkPath, true);
    expect(result.allowed).toBe(false);
  });

  // ── mustExist: true — file not found ─────────────────────────────────────

  it('denies access when mustExist: true and file does not exist', () => {
    const missing = join(projectRoot, 'nonexistent.ts');
    const result = guard.check(missing, true);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('access-denied');
    }
  });

  // ── mustExist: false — parent missing ────────────────────────────────────

  it('returns parent-missing when parent directory does not exist', () => {
    const filePath = join(projectRoot, 'does-not-exist', 'file.ts');
    const result = guard.check(filePath, false);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('parent-missing');
    }
  });

  // ── Warn mode ─────────────────────────────────────────────────────────────

  it('allows out-of-project path in warn mode (but would normally be denied)', () => {
    const warnGuard = new PathGuard(projectRoot, 'warn');
    const outsideFile = join(tmpdir(), 'warn-test.txt');
    writeFileSync(outsideFile, '');

    const result = warnGuard.check(outsideFile, true);
    expect(result.allowed).toBe(true);
  });

  // ── findProjectRoot ──────────────────────────────────────────────────────

  it('findProjectRoot returns git root when inside a git repo', () => {
    const found = PathGuard.findProjectRoot(projectRoot);
    // Use realpathSync to handle macOS /var → /private/var symlinks
    expect(realpathSync(found)).toBe(realpathSync(projectRoot));
  });

  it('findProjectRoot falls back to cwd when not in a git repo', () => {
    const nonGitDir = makeTempDir();
    try {
      const found = PathGuard.findProjectRoot(nonGitDir);
      expect(found).toBe(nonGitDir);
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});
