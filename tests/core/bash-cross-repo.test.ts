/**
 * Tests for spec 028 T-A20: cross-repo bash path detection
 */
import { describe, it, expect } from 'vitest';
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
  const guard = new PathGuard('/project');

  it('returns true for path inside the project root', () => {
    expect(guard.isInsideProject('/project/src/foo.ts')).toBe(true);
  });

  it('returns false for absolute path outside project', () => {
    expect(guard.isInsideProject('/etc/passwd')).toBe(false);
  });

  it('returns false for a non-existent path with traversal outside project', () => {
    expect(guard.isInsideProject('/project/../outside')).toBe(false);
  });

  it('returns false for a non-existent random path', () => {
    expect(guard.isInsideProject('/some/completely/other/path')).toBe(false);
  });
});
