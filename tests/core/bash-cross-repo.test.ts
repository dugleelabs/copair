/**
 * Tests for spec 028 T-A20: cross-repo bash path detection
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { extractPathTokens } from '../../src/tools/bash.js';
import { PathGuard } from '../../src/core/path-guard.js';

describe('extractPathTokens — cross-repo detection (T-A20)', () => {
  it('extracts ../ relative path from bash command', () => {
    const tokens = extractPathTokens('cat ../../other-repo/file.ts');
    expect(tokens.some((t) => t.includes('..'))).toBe(true);
  });

  it('extracts absolute path outside project', () => {
    const tokens = extractPathTokens('cp /etc/passwd /tmp/out.txt');
    expect(tokens).toContain('/etc/passwd');
  });

  it('extracts ~/ home path', () => {
    const tokens = extractPathTokens('cat ~/secrets/.env');
    expect(tokens.some((t) => t.startsWith('~/'))).toBe(true);
  });

  it('does NOT extract a plain word as a path token', () => {
    const tokens = extractPathTokens('echo hello world');
    expect(tokens).toHaveLength(0);
  });

  it('does NOT extract a number as a path token', () => {
    const tokens = extractPathTokens('sleep 5');
    expect(tokens).toHaveLength(0);
  });

  it('extracts intra-project absolute path', () => {
    const tokens = extractPathTokens('cat /project/src/index.ts');
    expect(tokens).toContain('/project/src/index.ts');
  });
});

describe('PathGuard.isInsideProject — boundary checks (T-A20)', () => {
  // Use platform-resolved synthetic paths so the test works on POSIX and Windows.
  // resolve() turns '/project' into 'C:\project' on Windows, and Path comparisons
  // need both projectRoot and the input path to use the same convention.
  const PROJECT_ROOT = resolve('/project');
  const INSIDE_PATH = resolve('/project/src/foo.ts');
  const OUTSIDE_ABS = resolve('/etc/passwd');
  const TRAVERSAL_OUTSIDE = resolve('/project/../outside');
  const RANDOM_OUTSIDE = resolve('/some/completely/other/path');

  let guard: PathGuard;
  let findRootSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    // Mock findProjectRoot so PathGuard uses our synthetic root regardless of the real git repo
    findRootSpy = vi.spyOn(PathGuard, 'findProjectRoot').mockReturnValue(PROJECT_ROOT);
    guard = new PathGuard(PROJECT_ROOT);
  });

  afterAll(() => {
    findRootSpy.mockRestore();
  });

  it('returns true for path inside the project root', () => {
    expect(guard.isInsideProject(INSIDE_PATH)).toBe(true);
  });

  it('returns false for absolute path outside project', () => {
    expect(guard.isInsideProject(OUTSIDE_ABS)).toBe(false);
  });

  it('returns false for a non-existent path with traversal outside project', () => {
    expect(guard.isInsideProject(TRAVERSAL_OUTSIDE)).toBe(false);
  });

  it('returns false for a non-existent random path', () => {
    expect(guard.isInsideProject(RANDOM_OUTSIDE)).toBe(false);
  });
});
