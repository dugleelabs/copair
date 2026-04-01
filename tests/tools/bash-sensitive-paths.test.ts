/**
 * T-35: Unit tests — bash sensitive path detection.
 */
import { describe, it, expect } from 'vitest';
import {
  SENSITIVE_PATH_PATTERNS,
  detectSensitivePaths,
} from '../../src/tools/bash.js';

describe('detectSensitivePaths', () => {
  it('detects ~/.ssh/ references', () => {
    expect(detectSensitivePaths('cat ~/.ssh/id_rsa')).toContain('~/.ssh/');
  });

  it('detects ~/.aws/ references', () => {
    expect(detectSensitivePaths('cat ~/.aws/credentials')).toContain('~/.aws/');
  });

  it('detects ~/.gnupg/ references', () => {
    expect(detectSensitivePaths('ls ~/.gnupg')).toContain('~/.gnupg/');
  });

  it('detects /etc/ references', () => {
    expect(detectSensitivePaths('cat /etc/hosts')).toContain('/etc/');
  });

  it('detects /private/ references (macOS)', () => {
    expect(detectSensitivePaths('cat /private/etc/hosts')).toContain('/private/');
  });

  it('detects ~/.config/ references', () => {
    expect(detectSensitivePaths('ls ~/.config/gcloud')).toContain('~/.config/');
  });

  it('detects ~/.netrc references', () => {
    expect(detectSensitivePaths('cat ~/.netrc')).toContain('~/.netrc');
  });

  it('detects ~/.npmrc references', () => {
    expect(detectSensitivePaths('cat ~/.npmrc')).toContain('~/.npmrc');
  });

  it('detects ~/.pypirc references', () => {
    expect(detectSensitivePaths('cat ~/.pypirc')).toContain('~/.pypirc');
  });

  it('returns empty array for benign commands', () => {
    expect(detectSensitivePaths('ls -la')).toEqual([]);
    expect(detectSensitivePaths('echo hello')).toEqual([]);
    expect(detectSensitivePaths('git status')).toEqual([]);
    expect(detectSensitivePaths('pnpm build')).toEqual([]);
    expect(detectSensitivePaths('cat src/index.ts')).toEqual([]);
  });

  it('returns all matched patterns when multiple sensitive paths appear in one command', () => {
    const matched = detectSensitivePaths('cp ~/.aws/credentials ~/.ssh/id_rsa /tmp/');
    expect(matched).toContain('~/.aws/');
    expect(matched).toContain('~/.ssh/');
    expect(matched.length).toBeGreaterThanOrEqual(2);
  });

  it('deduplicates — repeated same pattern still counts as one match', () => {
    const matched = detectSensitivePaths('cat ~/.ssh/id_rsa ~/.ssh/id_rsa.pub');
    const sshMatches = matched.filter((m) => m === '~/.ssh/');
    expect(sshMatches.length).toBe(1);
  });

  it('SENSITIVE_PATH_PATTERNS covers all expected credential paths', () => {
    const names = SENSITIVE_PATH_PATTERNS.map((p) => p.name);
    expect(names).toContain('~/.ssh/');
    expect(names).toContain('~/.aws/');
    expect(names).toContain('~/.gnupg/');
    expect(names).toContain('/etc/');
    expect(names).toContain('~/.netrc');
    expect(names).toContain('~/.npmrc');
    expect(names).toContain('~/.pypirc');
  });

  it('does not match paths that merely contain the keyword in a different context', () => {
    // "sshd" should not match ~/.ssh/ pattern
    expect(detectSensitivePaths('systemctl status sshd')).toEqual([]);
  });
});
