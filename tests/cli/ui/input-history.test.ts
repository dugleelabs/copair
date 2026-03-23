import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveHistoryPath, loadHistory, saveHistory, appendHistory } from '../../../src/cli/ui/input-history.js';

describe('input-history', () => {
  const testDir = join(tmpdir(), 'copair-history-test-' + Date.now());

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('resolveHistoryPath prefers project .copair/ if it exists', () => {
    mkdirSync(join(testDir, '.copair'), { recursive: true });
    const path = resolveHistoryPath(testDir);
    expect(path).toBe(join(testDir, '.copair', 'history'));
  });

  it('resolveHistoryPath falls back to global', () => {
    mkdirSync(testDir, { recursive: true });
    const path = resolveHistoryPath(testDir);
    expect(path).toContain('.copair/history');
    expect(path).not.toContain(testDir);
  });

  it('loadHistory returns empty array for missing file', () => {
    const entries = loadHistory(join(testDir, 'nonexistent'));
    expect(entries).toEqual([]);
  });

  it('saveHistory and loadHistory round-trip', () => {
    mkdirSync(testDir, { recursive: true });
    const histPath = join(testDir, 'history');
    const entries = ['hello', 'world', 'test'];
    saveHistory(histPath, entries);
    const loaded = loadHistory(histPath);
    expect(loaded).toEqual(entries);
  });

  it('saveHistory truncates to max entries', () => {
    mkdirSync(testDir, { recursive: true });
    const histPath = join(testDir, 'history');
    const entries = Array.from({ length: 600 }, (_, i) => `entry-${i}`);
    saveHistory(histPath, entries);
    const loaded = loadHistory(histPath);
    expect(loaded).toHaveLength(500);
    expect(loaded[0]).toBe('entry-100');
  });

  it('appendHistory deduplicates consecutive entries', () => {
    mkdirSync(testDir, { recursive: true });
    const histPath = join(testDir, 'history');
    writeFileSync(histPath, 'first\nsecond\n', 'utf-8');
    appendHistory(histPath, 'second'); // duplicate
    const loaded = loadHistory(histPath);
    expect(loaded).toEqual(['first', 'second']); // no dupe
  });

  it('appendHistory adds non-duplicate entry', () => {
    mkdirSync(testDir, { recursive: true });
    const histPath = join(testDir, 'history');
    writeFileSync(histPath, 'first\nsecond\n', 'utf-8');
    appendHistory(histPath, 'third');
    const loaded = loadHistory(histPath);
    expect(loaded).toEqual(['first', 'second', 'third']);
  });
});
