/**
 * Tests for spec 028 T-B20: SmallModelHarness unit tests
 */
import { describe, it, expect } from 'vitest';
import { SmallModelHarness, DEFAULT_SMALL_MODELS } from '../../src/core/small-model-harness.js';
import { FencedBlockFormatter } from '../../src/core/formats/fenced-block.js';
import { QwenXmlFormatter } from '../../src/core/formats/qwen-xml.js';
import { DsmlFormatter } from '../../src/core/formats/dsml.js';

describe('SmallModelHarness — model detection', () => {
  it('detects model IDs in DEFAULT_SMALL_MODELS list', () => {
    for (const modelId of DEFAULT_SMALL_MODELS) {
      const harness = new SmallModelHarness(modelId);
      expect(harness.isSmallModel, `Expected ${modelId} to be detected as small`).toBe(true);
    }
  });

  it('detects small models by substring match (case-insensitive)', () => {
    const harness = new SmallModelHarness('ollama/Qwen2.5-Coder-7B-Instruct');
    expect(harness.isSmallModel).toBe(true);
  });

  it('does not mark a large model as small', () => {
    const harness = new SmallModelHarness('claude-3-5-sonnet');
    expect(harness.isSmallModel).toBe(false);
  });

  it('user-supplied model_ids replace defaults, not merge', () => {
    // Only 'my-custom-model' is in the override list
    const harness = new SmallModelHarness('qwen', { model_ids: ['my-custom-model'] });
    // qwen is in defaults but NOT in override list → not a small model
    expect(harness.isSmallModel).toBe(false);

    const harness2 = new SmallModelHarness('my-custom-model', { model_ids: ['my-custom-model'] });
    expect(harness2.isSmallModel).toBe(true);
  });

  it('forceOverride=true forces small model regardless of model ID', () => {
    const harness = new SmallModelHarness('gpt-4o', {}, true);
    expect(harness.isSmallModel).toBe(true);
  });

  it('forceOverride=false forces non-small-model regardless of model ID', () => {
    const harness = new SmallModelHarness('qwen', {}, false);
    expect(harness.isSmallModel).toBe(false);
  });
});

describe('SmallModelHarness — getSystemPromptAddition', () => {
  it('returns non-null for small model', () => {
    const harness = new SmallModelHarness('qwen');
    expect(harness.getSystemPromptAddition()).not.toBeNull();
  });

  it('returns null for large model', () => {
    const harness = new SmallModelHarness('claude-3-5-sonnet');
    expect(harness.getSystemPromptAddition()).toBeNull();
  });

  it('content includes all four rules', () => {
    const harness = new SmallModelHarness('qwen');
    const addition = harness.getSystemPromptAddition()!;
    expect(addition).toContain('one at a time');
    expect(addition).toContain('UNCLEAR');
    expect(addition).toContain('task_complete');
    expect(addition).toContain('ask_user');
  });
});

describe('SmallModelHarness — getPerTurnReminder', () => {
  it('returns non-null for small model', () => {
    const harness = new SmallModelHarness('qwen');
    expect(harness.getPerTurnReminder()).not.toBeNull();
  });

  it('returns null for large model', () => {
    const harness = new SmallModelHarness('claude-3-5-sonnet');
    expect(harness.getPerTurnReminder()).toBeNull();
  });
});

describe('SmallModelHarness — getFormatHint', () => {
  it('calls formatter.exampleCall() for small models and returns prefixed hint', () => {
    const harness = new SmallModelHarness('qwen');
    const formatter = new FencedBlockFormatter();
    const hint = harness.getFormatHint(formatter);
    expect(hint).not.toBeNull();
    expect(hint).toContain('Format reminder');
    expect(hint).toContain(formatter.exampleCall());
  });

  it('returns null for large models (no hint injected)', () => {
    const harness = new SmallModelHarness('claude-3-5-sonnet');
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
