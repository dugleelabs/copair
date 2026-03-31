import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { PathGuard, BUILTIN_DENY, expandHome } from '../../src/core/path-guard.js';

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

// ── expandHome ──────────────────────────────────────────────────────────────

describe('expandHome', () => {
  it('expands ~/path to homedir/path', () => {
    expect(expandHome('~/.ssh/id_rsa')).toBe(join(homedir(), '.ssh/id_rsa'));
  });

  it('expands bare ~ to homedir', () => {
    expect(expandHome('~')).toBe(homedir());
  });

  it('leaves non-home paths unchanged', () => {
    expect(expandHome('/etc/hosts')).toBe('/etc/hosts');
    expect(expandHome('**/.env')).toBe('**/.env');
  });
});

// ── BUILTIN_DENY ────────────────────────────────────────────────────────────

describe('BUILTIN_DENY', () => {
  it('contains at least the expected credential paths', () => {
    const patterns = BUILTIN_DENY;
    expect(patterns.some(p => p.includes('.ssh'))).toBe(true);
    expect(patterns.some(p => p.includes('.aws'))).toBe(true);
    expect(patterns.some(p => p.includes('.env'))).toBe(true);
    expect(patterns.some(p => p.includes('.gnupg'))).toBe(true);
  });
});

// ── PathPolicy — P1 features ────────────────────────────────────────────────

describe('PathGuard with PathPolicy', () => {
  let projectRoot: string;
  let outsideDir: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'copair-pathguard-policy-'));
    execSync('git init -q', { cwd: projectRoot });
    outsideDir = mkdtempSync(join(tmpdir(), 'copair-outside-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('deny list blocks ~/.ssh/id_rsa (write path, home exists)', () => {
    const sshKey = join(homedir(), '.ssh', 'id_rsa');
    const guard = new PathGuard(projectRoot, 'strict');
    // Use mustExist: false so we test the deny list without needing the file
    // to exist. We need the parent dir to exist though.
    const sshDir = join(homedir(), '.ssh');
    if (!existsSync(sshDir)) {
      // Skip on CI where ~/.ssh doesn't exist
      return;
    }
    const result = guard.check(sshKey, false);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('access-denied');
    }
  });

  it('deny list blocks ~/.aws/credentials (write path, home exists)', () => {
    const awsDir = join(homedir(), '.aws');
    if (!existsSync(awsDir)) {
      mkdirSync(awsDir, { recursive: true });
    }
    const guard = new PathGuard(projectRoot, 'strict');
    const result = guard.check(join(awsDir, 'credentials'), false);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('access-denied');
    }
  });

  it('allow_paths permits a configured path outside project root', () => {
    const allowedFile = join(outsideDir, 'shared.ts');
    writeFileSync(allowedFile, '');
    // Use realpathSync so the pattern matches the resolved path on macOS
    // where /var/folders → /private/var/folders via symlink.
    const realOutsideDir = realpathSync(outsideDir);

    const guard = new PathGuard(projectRoot, 'strict', {
      allowPaths: [realOutsideDir + '/**'],
      denyPaths: [],
    });

    const result = guard.check(allowedFile, true);
    expect(result.allowed).toBe(true);
  });

  it('deny_paths override replaces built-in deny list', () => {
    // With a custom denyPaths, BUILTIN_DENY is replaced entirely.
    // So ~/.aws/credentials is no longer blocked, but the custom pattern is.
    const targetFile = join(outsideDir, 'blocked.txt');
    writeFileSync(targetFile, '');
    const realOutsideDir = realpathSync(outsideDir);

    const guard = new PathGuard(projectRoot, 'strict', {
      allowPaths: [],
      denyPaths: [realOutsideDir + '/**'],
    });

    const result = guard.check(targetFile, true);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('access-denied');
    }
  });

  it('deny_paths override takes precedence over allow_paths', () => {
    const targetFile = join(outsideDir, 'secret.txt');
    writeFileSync(targetFile, '');
    const realOutsideDir = realpathSync(outsideDir);

    // Both deny and allow match the path — deny wins.
    const guard = new PathGuard(projectRoot, 'strict', {
      allowPaths: [realOutsideDir + '/**'],
      denyPaths: [realOutsideDir + '/**'],
    });

    const result = guard.check(targetFile, true);
    expect(result.allowed).toBe(false);
  });

  it('.env outside project root is denied by built-in deny list', () => {
    const envFile = join(outsideDir, '.env');
    writeFileSync(envFile, '');

    const guard = new PathGuard(projectRoot, 'strict');
    const result = guard.check(envFile, true);
    expect(result.allowed).toBe(false);
  });

  it('.env inside project root passes boundary check (not in deny list for project paths)', () => {
    const envFile = join(projectRoot, '.env');
    writeFileSync(envFile, '');

    const guard = new PathGuard(projectRoot, 'strict');
    const result = guard.check(envFile, true);
    // Inside project root — deny list is not evaluated; returns allowed (approval gate decides)
    expect(result.allowed).toBe(true);
  });

  it('unconfigured path outside project root is denied even with allow_paths set', () => {
    const unlistedFile = join(outsideDir, 'unlisted.ts');
    writeFileSync(unlistedFile, '');

    const guard = new PathGuard(projectRoot, 'strict', {
      allowPaths: [realpathSync(projectRoot) + '/some/other/dir/**'],
      denyPaths: [],
    });

    const result = guard.check(unlistedFile, true);
    expect(result.allowed).toBe(false);
  });
});
