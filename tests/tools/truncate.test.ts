/**
 * Spec 029 F-15b T-J08 — unit tests for `truncateMiddle` (bash-only helper).
 *
 * Covers the design §21.2.4 contract:
 *   - Below-threshold input returned unchanged (identity).
 *   - Over-threshold input gets head+tail preservation with a marker.
 *   - Very-short multi-line falls back to char-based slicing.
 *   - Marker contains the actual number of truncated lines/chars.
 *   - Caller can vary `maxTokens` per call (no module-level default).
 */
import { describe, it, expect } from 'vitest';
import { truncateMiddle } from '../../src/tools/truncate.js';

describe('truncateMiddle — below-threshold passthrough', () => {
  it('returns the input unchanged when length <= maxTokens*4', () => {
    const text = 'a'.repeat(100);
    expect(truncateMiddle(text, 100)).toBe(text);
  });

  it('returns multi-line input unchanged when under budget', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    expect(truncateMiddle(text, 500)).toBe(text);
  });
});

describe('truncateMiddle — over-threshold line-based truncation', () => {
  it('preserves head and tail with a `[... N lines truncated ...]` marker', () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line-${i}`);
    const text = lines.join('\n');
    const result = truncateMiddle(text, 200);
    expect(result).not.toBe(text);
    expect(result).toMatch(/\[\.\.\. \d+ lines truncated \.\.\.\]/);
    // Head preserved
    expect(result.startsWith('line-0\n')).toBe(true);
    // Tail preserved
    expect(result.endsWith('line-4999')).toBe(true);
  });

  it('marker line-count matches the actual number of truncated lines', () => {
    // Use a unique format with explicit `:end` boundary so `l1` doesn't
    // substring-match `l10`/`l100`/etc when we count survivors. Exact split
    // on '\n' + regex filter gives the precise survivor count.
    const lines = Array.from({ length: 2000 }, (_, i) => `L${i}:end`);
    const text = lines.join('\n');
    const result = truncateMiddle(text, 100);
    const m = result.match(/\[\.\.\. (\d+) lines truncated \.\.\.\]/);
    expect(m).not.toBeNull();
    const reportedTruncated = Number(m![1]);
    const surviving = result.split('\n').filter((l) => /^L\d+:end$/.test(l)).length;
    expect(surviving + reportedTruncated).toBe(2000);
  });

  it('respects different maxTokens budgets per call (no module-level default)', () => {
    const text = Array.from({ length: 10000 }, (_, i) => `x${i}`).join('\n');
    const tight = truncateMiddle(text, 50);
    const loose = truncateMiddle(text, 500);
    expect(tight.length).toBeLessThan(loose.length);
    expect(tight.length).toBeLessThanOrEqual(50 * 4 + 200); // budget + marker overhead
  });
});

describe('truncateMiddle — char-fallback for very-short multi-line', () => {
  it('uses `[... N chars truncated ...]` marker when fewer than 4 lines', () => {
    // 3 lines, but each line is very long — triggers the lines<4 branch.
    const text = ['a'.repeat(5000), 'b'.repeat(5000), 'c'.repeat(5000)].join('\n');
    const result = truncateMiddle(text, 100);
    expect(result).toMatch(/\[\.\.\. \d+ chars truncated \.\.\.\]/);
  });

  it('falls back gracefully on a single huge line', () => {
    const text = 'x'.repeat(20000);
    const result = truncateMiddle(text, 100);
    expect(result.length).toBeLessThan(text.length);
    expect(result).toMatch(/\[\.\.\. \d+ chars truncated \.\.\.\]/);
  });
});
