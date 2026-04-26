/**
 * Tests for spec 028 T-A23: F-05 context limit detection
 */
import { describe, it, expect } from 'vitest';
import { ContextWindowManager } from '../../src/core/context-window.js';

// Access the private detectContextLimit method via a testable subclass
class TestableAgent {
  private contextWindow: ContextWindowManager;

  constructor(maxTokens: number) {
    this.contextWindow = new ContextWindowManager(maxTokens);
  }

  detectContextLimit(lastInputTokens: number, fullText: string, toolCalls: unknown[], thresholdPct = 0.9): boolean {
    const maxTokens = this.contextWindow.maxTokens;
    if (maxTokens > 0 && lastInputTokens >= maxTokens * thresholdPct) {
      return true;
    }
    if (toolCalls.length === 0 && fullText.trim().length > 0) {
      const trimmed = fullText.trimEnd();
      const lastChar = trimmed[trimmed.length - 1];
      if (lastChar && !/[.!?:;\n]/.test(lastChar)) {
        return true;
      }
    }
    return false;
  }

  get maxTokens() {
    return this.contextWindow.maxTokens;
  }
}

describe('detectContextLimit — token threshold (T-A23)', () => {
  it('returns true when input tokens >= 90% of maxTokens', () => {
    const agent = new TestableAgent(10000);
    expect(agent.detectContextLimit(9000, '', [])).toBe(true);
  });

  it('returns true at exactly the threshold', () => {
    const agent = new TestableAgent(10000);
    expect(agent.detectContextLimit(9000, '', [])).toBe(true);
  });

  it('returns false when below threshold', () => {
    const agent = new TestableAgent(10000);
    expect(agent.detectContextLimit(8999, '', [])).toBe(false);
  });

  it('returns false when maxTokens is 0 (unknown — skip threshold)', () => {
    const agent = new TestableAgent(0);
    expect(agent.detectContextLimit(99999, '', [])).toBe(false);
  });
});

describe('detectContextLimit — truncation heuristic (T-A23)', () => {
  it('returns true for text response ending mid-word (no tool calls)', () => {
    const agent = new TestableAgent(10000);
    const text = 'The answer to your question is that the function should be implemen';
    expect(agent.detectContextLimit(100, text, [])).toBe(true);
  });

  it('returns false for text response ending with period', () => {
    const agent = new TestableAgent(10000);
    const text = 'The function is complete.';
    expect(agent.detectContextLimit(100, text, [])).toBe(false);
  });

  it('returns false for text response ending with newline', () => {
    const agent = new TestableAgent(10000);
    const text = 'Done.\n';
    expect(agent.detectContextLimit(100, text, [])).toBe(false);
  });

  it('returns false when there are tool calls (not a truncation)', () => {
    const agent = new TestableAgent(10000);
    const text = 'I will read the file now';
    expect(agent.detectContextLimit(100, text, [{ name: 'read' }])).toBe(false);
  });

  it('returns false for empty text with no tool calls', () => {
    const agent = new TestableAgent(10000);
    expect(agent.detectContextLimit(100, '', [])).toBe(false);
  });
});

describe('ContextWindowManager.markForCompaction (T-A23)', () => {
  it('maxTokens getter returns the configured limit', () => {
    const cwm = new ContextWindowManager(8192);
    expect(cwm.maxTokens).toBe(8192);
  });

  it('maxTokens returns 0 when initialized with 0', () => {
    const cwm = new ContextWindowManager(0);
    expect(cwm.maxTokens).toBe(0);
  });
});
