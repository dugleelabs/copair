import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';
import { AllowList, loadAllowList } from '../../src/core/allow-list.js';

// ── AllowList.matches() ───────────────────────────────────────────────────────

describe('AllowList — bash', () => {
  it('exact match passes', () => {
    const al = new AllowList({ bash: ['npm test'] });
    expect(al.matches('bash', { command: 'npm test' })).toBe(true);
  });

  it('exact match does not pass a longer command', () => {
    const al = new AllowList({ bash: ['npm test'] });
    expect(al.matches('bash', { command: 'npm test --reporter verbose' })).toBe(false);
  });

  it('prefix pattern "npm run *" matches any npm run subcommand', () => {
    const al = new AllowList({ bash: ['npm run *'] });
    expect(al.matches('bash', { command: 'npm run lint' })).toBe(true);
    expect(al.matches('bash', { command: 'npm run build' })).toBe(true);
  });

  it('prefix pattern does not match unrelated command', () => {
    const al = new AllowList({ bash: ['npm run *'] });
    expect(al.matches('bash', { command: 'rm -rf .' })).toBe(false);
  });

  it('returns false when list is empty', () => {
    const al = new AllowList({});
    expect(al.matches('bash', { command: 'npm test' })).toBe(false);
  });
});

describe('AllowList — git', () => {
  it('matches subcommand exactly', () => {
    const al = new AllowList({ git: ['diff'] });
    expect(al.matches('git', { args: 'diff' })).toBe(true);
  });

  it('matches subcommand with flags (prefix behaviour)', () => {
    const al = new AllowList({ git: ['diff'] });
    expect(al.matches('git', { args: 'diff --cached' })).toBe(true);
    expect(al.matches('git', { args: 'diff HEAD~1' })).toBe(true);
  });

  it('does not match a different subcommand', () => {
    const al = new AllowList({ git: ['diff'] });
    expect(al.matches('git', { args: 'commit -m "oops"' })).toBe(false);
  });
});

describe('AllowList — write/edit path globs', () => {
  it('exact path matches', () => {
    const al = new AllowList({ write: ['src/index.ts'] });
    expect(al.matches('write', { file_path: 'src/index.ts' })).toBe(true);
  });

  it('* matches within a single segment', () => {
    const al = new AllowList({ write: ['src/*.ts'] });
    expect(al.matches('write', { file_path: 'src/index.ts' })).toBe(true);
    expect(al.matches('write', { file_path: 'src/utils/helper.ts' })).toBe(false);
  });

  it('** matches across segments', () => {
    const al = new AllowList({ write: ['src/**'] });
    expect(al.matches('write', { file_path: 'src/utils/helper.ts' })).toBe(true);
    expect(al.matches('write', { file_path: 'tests/foo.ts' })).toBe(false);
  });

  it('edit rules apply to edit tool only', () => {
    const al = new AllowList({ edit: ['src/**'] });
    expect(al.matches('edit',  { file_path: 'src/foo.ts' })).toBe(true);
    expect(al.matches('write', { file_path: 'src/foo.ts' })).toBe(false);
  });
});

describe('AllowList — unknown tool', () => {
  it('returns false for unrecognised tools', () => {
    const al = new AllowList({ bash: ['anything'] });
    expect(al.matches('unknown-tool', {})).toBe(false);
  });
});

// ── loadAllowList() ───────────────────────────────────────────────────────────

describe('loadAllowList', () => {
  const tmp = join(tmpdir(), 'copair-allow-test-' + Date.now());
  const projectDir = join(tmp, 'project');
  const globalCopairDir = join(tmp, 'home', '.copair');

  beforeEach(() => {
    mkdirSync(globalCopairDir, { recursive: true });
    mkdirSync(join(projectDir, '.copair'), { recursive: true });
    vi.stubEnv('HOME', join(tmp, 'home'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns empty AllowList when no files exist', () => {
    const al = loadAllowList(join(tmp, 'nonexistent'));
    expect(al.matches('bash', { command: 'anything' })).toBe(false);
  });

  it('loads global allow file', () => {
    writeFileSync(join(globalCopairDir, 'allow.yaml'), 'bash:\n  - npm test\n');
    const al = loadAllowList(projectDir);
    expect(al.matches('bash', { command: 'npm test' })).toBe(true);
  });

  it('merges global and project entries', () => {
    writeFileSync(join(globalCopairDir, 'allow.yaml'), 'bash:\n  - npm test\n');
    writeFileSync(
      join(projectDir, '.copair', 'allow.yaml'),
      'bash:\n  - pnpm lint\ngit:\n  - diff\n',
    );
    const al = loadAllowList(projectDir);
    expect(al.matches('bash', { command: 'npm test' })).toBe(true);
    expect(al.matches('bash', { command: 'pnpm lint' })).toBe(true);
    expect(al.matches('git',  { args:    'diff --cached' })).toBe(true);
  });

  it('project entries do not remove global entries', () => {
    writeFileSync(join(globalCopairDir, 'allow.yaml'), 'bash:\n  - npm test\n');
    writeFileSync(join(projectDir, '.copair', 'allow.yaml'), 'bash:\n  - pnpm test\n');
    const al = loadAllowList(projectDir);
    // Both survive
    expect(al.matches('bash', { command: 'npm test'  })).toBe(true);
    expect(al.matches('bash', { command: 'pnpm test' })).toBe(true);
  });
});
