import { describe, it, expect } from 'vitest';
import { TokenTracker } from '../../src/core/token-tracker.js';

describe('TokenTracker', () => {
  it('starts with empty summary', () => {
    const tracker = new TokenTracker();
    const summary = tracker.getSessionSummary();
    expect(summary.totalInput).toBe(0);
    expect(summary.totalOutput).toBe(0);
    expect(summary.totalCost).toBe(0);
    expect(summary.byModel.size).toBe(0);
  });

  it('records token usage', () => {
    const tracker = new TokenTracker();
    tracker.record(1000, 500, 'gpt-4o', 'openai');

    const summary = tracker.getSessionSummary();
    expect(summary.totalInput).toBe(1000);
    expect(summary.totalOutput).toBe(500);
  });

  it('tracks per-model breakdown', () => {
    const tracker = new TokenTracker();
    tracker.record(1000, 500, 'gpt-4o', 'openai');
    tracker.record(2000, 800, 'claude-sonnet', 'anthropic');
    tracker.record(500, 200, 'gpt-4o', 'openai');

    const summary = tracker.getSessionSummary();
    expect(summary.totalInput).toBe(3500);
    expect(summary.totalOutput).toBe(1500);
    expect(summary.byModel.size).toBe(2);

    const gpt = summary.byModel.get('gpt-4o')!;
    expect(gpt.input).toBe(1500);
    expect(gpt.output).toBe(700);

    const claude = summary.byModel.get('claude-sonnet')!;
    expect(claude.input).toBe(2000);
    expect(claude.output).toBe(800);
  });

  it('estimates cost with pricing data', () => {
    const pricing = new Map([
      ['gpt-4o', { input: 2.50, output: 10.00 }],
    ]);
    const tracker = new TokenTracker(pricing);
    tracker.record(1_000_000, 500_000, 'gpt-4o', 'openai');

    const summary = tracker.getSessionSummary();
    // 1M * 2.50/M + 500K * 10.00/M = 2.50 + 5.00 = 7.50
    expect(summary.totalCost).toBeCloseTo(7.50);
  });

  it('returns zero cost for unknown model pricing', () => {
    const tracker = new TokenTracker();
    tracker.record(1000, 500, 'unknown-model', 'unknown');

    const summary = tracker.getSessionSummary();
    expect(summary.totalCost).toBe(0);
  });
});
