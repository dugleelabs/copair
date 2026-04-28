/**
 * Tests for spec 028 T-B20b: F-10 UNCLEAR: signal detection
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Simulate the UNCLEAR: scanning logic used in agent.ts
function scanUnclear(fullText: string): string[] {
  const matches = fullText.match(/^UNCLEAR:\s+.+/gm);
  return matches ? matches.map((line) => line.replace(/^UNCLEAR:\s+/, '')) : [];
}

describe('UNCLEAR: scanning logic', () => {
  it('detects a line starting with UNCLEAR: followed by a space and message', () => {
    const text = 'UNCLEAR: What is the target file path?';
    expect(scanUnclear(text)).toEqual(['What is the target file path?']);
  });

  it('does not match "unclear" mid-sentence', () => {
    const text = 'The spec is unclear about this point.';
    expect(scanUnclear(text)).toHaveLength(0);
  });

  it('does not match UNCLEAR: without trailing whitespace', () => {
    const text = 'UNCLEAR:no space here';
    expect(scanUnclear(text)).toHaveLength(0);
  });

  it('detects multiple UNCLEAR: lines in one response', () => {
    const text = [
      'UNCLEAR: What is the target file?',
      'Doing some work...',
      'UNCLEAR: Which branch should I use?',
    ].join('\n');
    const results = scanUnclear(text);
    expect(results).toHaveLength(2);
    expect(results[0]).toBe('What is the target file?');
    expect(results[1]).toBe('Which branch should I use?');
  });

  it('does not match UNCLEAR: that appears mid-line', () => {
    const text = 'Note: UNCLEAR: this is mid-line';
    expect(scanUnclear(text)).toHaveLength(0);
  });
});

describe('Renderer.showUnclearSignal', () => {
  it('calls showUnclearSignal with the message after the prefix', () => {
    const renderer = { showUnclearSignal: vi.fn() };
    const fullText = 'UNCLEAR: What should I name the variable?';
    const matches = fullText.match(/^UNCLEAR:\s+.+/gm);
    if (matches) {
      for (const line of matches) {
        renderer.showUnclearSignal(line.replace(/^UNCLEAR:\s+/, ''));
      }
    }
    expect(renderer.showUnclearSignal).toHaveBeenCalledWith('What should I name the variable?');
    expect(renderer.showUnclearSignal).toHaveBeenCalledTimes(1);
  });
});
