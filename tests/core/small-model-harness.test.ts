/**
 * Tests for spec 028 T-B20 (harness mechanics) + T-C15 (tier-based detection)
 */
import { describe, it, expect } from 'vitest';
import { SmallModelHarness } from '../../src/core/small-model-harness.js';
import { FencedBlockFormatter } from '../../src/core/formats/fenced-block.js';
import { QwenXmlFormatter } from '../../src/core/formats/qwen-xml.js';
import { DsmlFormatter } from '../../src/core/formats/dsml.js';

describe('SmallModelHarness — model detection', () => {
  it('classifies small local models as small', () => {
    expect(new SmallModelHarness('qwen2.5-coder:7b').isSmallModel).toBe(true);
    expect(new SmallModelHarness('llama-3.1-8b').isSmallModel).toBe(true);
    expect(new SmallModelHarness('mistral-7b').isSmallModel).toBe(true);
    expect(new SmallModelHarness('phi-3-mini').isSmallModel).toBe(true);
    expect(new SmallModelHarness('command-r7b').isSmallModel).toBe(true);
  });

  it('classifies frontier-class models as large despite family-name substrings', () => {
    // F-24: substring-match would have flagged these as small. They are not.
    expect(new SmallModelHarness('qwen.qwen3-coder-480b-a35b-v1:0').isSmallModel).toBe(false);
    expect(new SmallModelHarness('qwen.qwen3-235b-a22b-2507-v1:0').isSmallModel).toBe(false);
    expect(new SmallModelHarness('qwen-max').isSmallModel).toBe(false);
    expect(new SmallModelHarness('claude-sonnet-4-6').isSmallModel).toBe(false);
    expect(new SmallModelHarness('llama-3.3-70b').isSmallModel).toBe(false);
  });

  it('normalizes Bedrock and OpenRouter prefixes', () => {
    expect(new SmallModelHarness('us.anthropic.claude-sonnet-4-6').isSmallModel).toBe(false);
    expect(new SmallModelHarness('anthropic/claude-sonnet-4-6').isSmallModel).toBe(false);
    expect(new SmallModelHarness('Qwen/Qwen2.5-Coder-7B-Instruct').isSmallModel).toBe(true);
  });

  it('tier_overrides wins over built-in classification', () => {
    // Force a frontier model into small-tier behavior
    const small = new SmallModelHarness('claude-sonnet-4-6', {
      tier_overrides: { 'claude-sonnet-4-6': 'small' },
    });
    expect(small.isSmallModel).toBe(true);

    // Force a known-small model out of the harness
    const large = new SmallModelHarness('qwen2.5-coder:7b', {
      tier_overrides: { 'qwen2.5-coder:7b': 'large' },
    });
    expect(large.isSmallModel).toBe(false);
  });

  it('forceOverride=true forces small model regardless of model ID', () => {
    const harness = new SmallModelHarness('gpt-4o', {}, true);
    expect(harness.isSmallModel).toBe(true);
  });

  it('forceOverride=false forces non-small-model regardless of model ID', () => {
    const harness = new SmallModelHarness('qwen2.5:7b', {}, false);
    expect(harness.isSmallModel).toBe(false);
  });

  it('forceOverride takes precedence over tier_overrides', () => {
    const harness = new SmallModelHarness(
      'claude-sonnet-4-6',
      { tier_overrides: { 'claude-sonnet-4-6': 'small' } },
      false,
    );
    expect(harness.isSmallModel).toBe(false);
  });
});

describe('SmallModelHarness — getSystemPromptAddition', () => {
  it('returns non-null for small model', () => {
    const harness = new SmallModelHarness('qwen2.5:7b');
    expect(harness.getSystemPromptAddition()).not.toBeNull();
  });

  it('returns null for large model', () => {
    const harness = new SmallModelHarness('claude-sonnet-4-6');
    expect(harness.getSystemPromptAddition()).toBeNull();
  });

  it('content includes all five rules', () => {
    const harness = new SmallModelHarness('qwen2.5:7b');
    const addition = harness.getSystemPromptAddition()!;
    expect(addition).toContain('one at a time');
    expect(addition).toContain('UNCLEAR');
    expect(addition).toContain('task_complete');
    expect(addition).toContain('ask_user');
    // Spec 029 F-15a: inspect-before-act rule.
    expect(addition).toContain('read it first');
    expect(addition).toContain('Never invent identifiers');
    // Structural assertion: five numbered rules, in order.
    expect(addition).toMatch(/^Small model operating rules:\n1\.[^\n]+\n2\.[^\n]+\n3\.[^\n]+\n4\.[^\n]+\n5\.[^\n]+$/);
  });
});

describe('SmallModelHarness — getPerTurnReminder', () => {
  it('returns non-null for small model', () => {
    const harness = new SmallModelHarness('qwen2.5:7b');
    expect(harness.getPerTurnReminder()).not.toBeNull();
  });

  it('returns null for large model', () => {
    const harness = new SmallModelHarness('claude-sonnet-4-6');
    expect(harness.getPerTurnReminder()).toBeNull();
  });
});

describe('SmallModelHarness — getFormatHint', () => {
  it('calls formatter.exampleCall() for small models and returns prefixed hint', () => {
    const harness = new SmallModelHarness('qwen2.5:7b');
    const formatter = new FencedBlockFormatter();
    const hint = harness.getFormatHint(formatter);
    expect(hint).not.toBeNull();
    expect(hint).toContain('Format reminder');
    expect(hint).toContain(formatter.exampleCall());
  });

  it('returns null for large models (no hint injected)', () => {
    const harness = new SmallModelHarness('claude-sonnet-4-6');
    const formatter = new FencedBlockFormatter();
    expect(harness.getFormatHint(formatter)).toBeNull();
  });
});

describe('Formatter exampleCall()', () => {
  it('FencedBlockFormatter.exampleCall() returns non-empty string with tool name', () => {
    const formatter = new FencedBlockFormatter();
    const example = formatter.exampleCall();
    expect(example.length).toBeGreaterThan(0);
    expect(example).toContain('read');
  });

  it('QwenXmlFormatter.exampleCall() returns non-empty string with tool name', () => {
    const formatter = new QwenXmlFormatter();
    const example = formatter.exampleCall();
    expect(example.length).toBeGreaterThan(0);
    expect(example).toContain('read');
  });

  it('DsmlFormatter.exampleCall() returns non-empty string with tool name', () => {
    const formatter = new DsmlFormatter();
    const example = formatter.exampleCall();
    expect(example.length).toBeGreaterThan(0);
    expect(example).toContain('read');
  });
});
