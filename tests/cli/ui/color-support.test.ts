import { describe, it, expect, afterEach } from 'vitest';
import { getColorLevel, shouldUseSyntaxHighlighting, resetColorCache } from '../../../src/cli/ui/color-support.js';

describe('color-support', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetColorCache();
  });

  it('returns 0 for non-TTY environment (test runner)', () => {
    // In vitest, stdout is not a TTY — detection returns 0
    expect(getColorLevel()).toBe(0);
  });

  it('returns 0 for NO_COLOR (non-TTY takes precedence)', () => {
    process.env.NO_COLOR = '1';
    expect(getColorLevel()).toBe(0);
  });

  it('returns 0 in non-TTY even with FORCE_COLOR', () => {
    // FORCE_COLOR is checked after TTY check in production code
    process.env.FORCE_COLOR = '3';
    delete process.env.NO_COLOR;
    expect(getColorLevel()).toBe(0);
  });

  it('returns 0 in non-TTY even with truecolor COLORTERM', () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    process.env.COLORTERM = 'truecolor';
    expect(getColorLevel()).toBe(0);
  });

  it('shouldUseSyntaxHighlighting accepts explicit level', () => {
    expect(shouldUseSyntaxHighlighting(3)).toBe(true);
    expect(shouldUseSyntaxHighlighting(2)).toBe(true);
    expect(shouldUseSyntaxHighlighting(1)).toBe(false);
    expect(shouldUseSyntaxHighlighting(0)).toBe(false);
  });

  it('shouldUseSyntaxHighlighting returns false in non-TTY', () => {
    expect(shouldUseSyntaxHighlighting()).toBe(false);
  });

  it('caches result across calls', () => {
    const first = getColorLevel();
    const second = getColorLevel();
    expect(first).toBe(second);
  });

  it('resetColorCache clears cached value', () => {
    getColorLevel(); // populates cache
    resetColorCache();
    // After reset, re-detection runs — still 0 in test env
    expect(getColorLevel()).toBe(0);
  });
});
