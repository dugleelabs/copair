/**
 * Spec 029 F-12 — ≤22B = small reclassification tests (T-G06).
 *
 * Locks in the rule changes from the 2026-05-18 addendum:
 *   - Phi-4 14B → small (boundary case)
 *   - Mistral-Small 3 → small (22B, at the boundary)
 *   - DeepSeek R1 distill 14B → small (split from the old ≥14B-large rule)
 *   - DeepSeek R1 distill 32B / 70B → large (the other side of the split)
 *   - Generic size-suffix heuristics deleted → unrecognized families now
 *     surface as UnknownModelError (F-11), not silent-large
 *   - Known families >22B still classify large (Qwen3 32B, Qwen 72B, etc.)
 *
 * Acts as a regression guard so the boundary doesn't drift by accident.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { classifyModel } from '../../src/core/model-tiers.js';
import {
  getCapabilities,
  setModelOverrides,
  UnknownModelError,
} from '../../src/core/model-capabilities.js';

beforeEach(() => {
  setModelOverrides({});
});
afterAll(() => {
  setModelOverrides({});
});

describe('Spec 029 F-12 — ≤22B reclassifications', () => {
  it('Phi-4 14B is small', () => {
    expect(classifyModel('phi-4').tier).toBe('small');
    expect(classifyModel('phi-4-14b').tier).toBe('small');
    const caps = getCapabilities('phi-4');
    expect(caps.tier).toBe('small');
    expect(caps.recommended_harness.enable_small_model_harness).toBe(true);
  });

  it('Mistral-Small 3 (22B) is small', () => {
    expect(classifyModel('mistral-small-3').tier).toBe('small');
    expect(classifyModel('mistral-small-3-1-24b-instruct').tier).toBe('small');
    const caps = getCapabilities('mistral-small-3');
    expect(caps.tier).toBe('small');
    expect(caps.recommended_harness.enable_small_model_harness).toBe(true);
  });

  it('DeepSeek R1 distill 14B is small (split from old ≥14B-large rule)', () => {
    expect(classifyModel('deepseek-r1-distill-qwen-14b').tier).toBe('small');
    expect(classifyModel('deepseek-r1-distill-14b').tier).toBe('small');
    const caps = getCapabilities('deepseek-r1-distill-qwen-14b');
    expect(caps.tier).toBe('small');
  });

  it('DeepSeek R1 distill 32B stays large', () => {
    expect(classifyModel('deepseek-r1-distill-qwen-32b').tier).toBe('large');
    expect(classifyModel('deepseek-r1-distill-32b').tier).toBe('large');
  });

  it('DeepSeek R1 distill 70B stays large', () => {
    expect(classifyModel('deepseek-r1-distill-llama-70b').tier).toBe('large');
    expect(classifyModel('deepseek-r1-distill-70b').tier).toBe('large');
  });
});

describe('Spec 029 F-12 — generic size-suffix heuristics deleted', () => {
  it('unrecognized family with a -7b suffix throws UnknownModelError (not silent-small)', () => {
    // Pre-F-12 the generic ≤8B rule would have caught this and classified
    // as small. Post-F-12 it falls through to the strict-unknowns guard.
    expect(() => getCapabilities('mystery-7b')).toThrow(UnknownModelError);
    expect(classifyModel('mystery-7b').tier).toBeNull();
  });

  it('unrecognized family with a -70b suffix throws UnknownModelError (not silent-large)', () => {
    expect(() => getCapabilities('madeup-70b')).toThrow(UnknownModelError);
    expect(classifyModel('madeup-70b').tier).toBeNull();
  });

  it('unrecognized family with a -480b suffix throws UnknownModelError', () => {
    expect(() => getCapabilities('imaginary-vendor-480b')).toThrow(UnknownModelError);
  });
});

describe('Spec 029 F-12 — known families >22B still classify large', () => {
  it('Qwen3 32B stays large', () => {
    expect(classifyModel('qwen3-32b').tier).toBe('large');
    expect(classifyModel('qwen3-30b-a3b').tier).toBe('large');
  });

  it('Qwen 72B stays large', () => {
    expect(classifyModel('qwen2-5-72b').tier).toBe('large');
    expect(classifyModel('qwen2-5-coder-72b').tier).toBe('large');
  });

  it('Llama 70B class stays large', () => {
    expect(classifyModel('llama-3-70b').tier).toBe('large');
    expect(classifyModel('llama-3-1-70b').tier).toBe('large');
  });

  it('Granite 30B stays large', () => {
    expect(classifyModel('granite-4-30b').tier).toBe('large');
  });
});

describe('Spec 029 F-12 — pre-existing override + shipped-data paths still work', () => {
  it('model_overrides still wins when set on a reclassified family', () => {
    // User can force Phi-4 14B back to large if they want
    setModelOverrides({ 'phi-4': { tier: 'large' } });
    expect(getCapabilities('phi-4').tier).toBe('large');
    expect(getCapabilities('phi-4').recommended_harness.enable_small_model_harness).toBe(false);
  });

  it('classifier tier survives when shipped JSON does not claim a tier', () => {
    // mistral-small-3 has no shipped JSON tier override (verified at audit
    // time in T-G05); the classifier's tier change to small must surface.
    const caps = getCapabilities('mistral-small-3');
    expect(caps.tier).toBe('small');
  });
});
