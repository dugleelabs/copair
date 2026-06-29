/**
 * Spec 029 F-11 — strict unknown-model handling tests (T-F08).
 *
 * Covers the new behavior added in the 2026-05-18 scope expansion:
 *   - Unknown model IDs no longer silently default to large-tier safe defaults.
 *   - `getCapabilities` / `explainCapabilities` throw `UnknownModelError` when
 *     a model is unrecognized AND undeclared in either `model_overrides` or
 *     the shipped JSON registry.
 *   - The error message carries did-you-mean suggestions sourced from shipped
 *     families, currently-loaded overrides, and TIER_RULES family names.
 *   - NF-08 hygiene: the message contains only the user-supplied modelId,
 *     normalizedId, suggestions, and the docs URL. No filesystem leaks.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  getCapabilities,
  explainCapabilities,
  setModelOverrides,
  suggestDidYouMean,
  UnknownModelError,
} from '../../src/core/model-capabilities.js';

beforeEach(() => {
  setModelOverrides({});
});
afterAll(() => {
  setModelOverrides({});
});

describe('Spec 029 F-11 — getCapabilities strict-unknowns', () => {
  it('known-family ID resolves normally without throwing', () => {
    const c = getCapabilities('claude-sonnet-4-6');
    expect(c.tier).toBe('large');
    expect(c.preferred_format).toBe('native');
  });

  it('unknown ID with no override and no shipped entry throws UnknownModelError', () => {
    expect(() => getCapabilities('made-up-model-xyz-9999')).toThrow(UnknownModelError);
  });

  it('unknown ID resolves cleanly when declared via model_overrides', () => {
    setModelOverrides({ 'made-up-model-xyz-9999': { tier: 'small' } });
    const c = getCapabilities('made-up-model-xyz-9999');
    expect(c.tier).toBe('small');
    expect(c.recommended_harness.enable_small_model_harness).toBe(true);
  });

  it('unknown ID resolves when only the shipped JSON registry covers it', () => {
    // gpt-4o is not a TIER_RULES match by family-prefix (the rule is
    // /^gpt-(?:3-5|4|5)/ which DOES match — bad example). Pick something
    // that's *only* covered by shipped JSON. starcoder2 — TIER_RULES has no
    // StarCoder family but the shipped JSON has a BigCode StarCoder2 entry.
    // (If shipped data changes, swap to another shipped-only family.)
    const c = getCapabilities('starcoder2-7b');
    // Shipped entry provides context window + tier; should not throw.
    expect(c).toBeDefined();
    expect(typeof c.context_window).toBe('number');
  });

  it('override + shipped entry both present: override wins for tier', () => {
    setModelOverrides({ 'claude-opus-4-7': { tier: 'small' } });
    const c = getCapabilities('claude-opus-4-7');
    expect(c.tier).toBe('small');
    // shipped entry's context_window survives since override didn't override it
    expect(c.context_window).toBe(200_000);
  });

  it('empty string and null IDs throw (no silent safe-default)', () => {
    expect(() => getCapabilities('')).toThrow(UnknownModelError);
    expect(() => getCapabilities(null)).toThrow(UnknownModelError);
    expect(() => getCapabilities(undefined)).toThrow(UnknownModelError);
  });
});

describe('Spec 029 F-11 — explainCapabilities strict-unknowns', () => {
  it('unknown ID throws UnknownModelError, does NOT fabricate a trace', () => {
    // Use an ID with no recognized family AND no recognized size-suffix
    // (Phase G removes the generic size heuristics; until then, IDs ending
    // in `-7b` still match the ≤8B fallthrough rule).
    expect(() => explainCapabilities('madeup-totally-fictional-id')).toThrow(UnknownModelError);
  });

  it('declared unknown ID yields a trace with override source', () => {
    setModelOverrides({ 'declared-fake-model': { tier: 'large' } });
    const ex = explainCapabilities('declared-fake-model');
    expect(ex.tier.value).toBe('large');
    expect(ex.tier.source).toBe('override');
  });
});

describe('Spec 029 F-11 — suggestDidYouMean', () => {
  it('returns top-3 nearest matches for a typo', () => {
    const suggestions = suggestDidYouMean('claude-sonet-4-6'); // missing one "n"
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    // At least one suggestion should be Claude-related
    expect(suggestions.some((s) => s.toLowerCase().includes('claude'))).toBe(true);
  });

  it('returns empty list for truly-random gibberish', () => {
    const suggestions = suggestDidYouMean('zzz-qqq-xyz-completely-unrelated-7842');
    expect(suggestions).toEqual([]);
  });

  it('includes currently-loaded model_overrides keys in the candidate pool', () => {
    setModelOverrides({ 'my-custom-finetune-v1': { tier: 'small' } });
    const suggestions = suggestDidYouMean('my-custom-finetune-v2'); // 1-edit-distance
    expect(suggestions).toContain('my-custom-finetune-v1');
  });

  it('typo against a TIER_RULES family produces a suggestion', () => {
    // "qwn" missing the "e" should still bring qwen-family suggestions
    const suggestions = suggestDidYouMean('qwn3-coder-30b');
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('dedupes suggestions from overlapping sources', () => {
    setModelOverrides({ claude: { tier: 'large' } });
    const suggestions = suggestDidYouMean('clauded');
    // 'claude' appears in both overrides and TIER_RULES family names; dedup
    // means it shows up at most once.
    const claudeCount = suggestions.filter((s) => s === 'claude').length;
    expect(claudeCount).toBeLessThanOrEqual(1);
  });
});

describe('Spec 029 F-11 — UnknownModelError message hygiene (NF-08)', () => {
  it('error message includes user-supplied modelId, normalizedId, and docs URL', () => {
    setModelOverrides({});
    try {
      getCapabilities('Mystery-Model:7B'); // mixed case + colon to test normalization
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownModelError);
      const msg = (err as UnknownModelError).message;
      expect(msg).toContain('Mystery-Model:7B'); // raw form
      expect(msg).toContain('mystery-model-7b'); // normalized form
      expect(msg).toContain('https://copair.dugleelabs.io/docs/custom-and-local-models');
      expect(msg).toContain('model_overrides'); // tells user what to do
    }
  });

  it('error message contains no filesystem paths or stack traces (NF-08)', () => {
    setModelOverrides({});
    try {
      getCapabilities('totally-unknown-blah-blah-1234');
    } catch (err) {
      const msg = (err as UnknownModelError).message;
      // No absolute paths (Mac/Linux/Windows-ish)
      expect(msg).not.toMatch(/\/Users\//);
      expect(msg).not.toMatch(/\/home\//);
      expect(msg).not.toMatch(/C:\\/);
      // No stack trace frames
      expect(msg).not.toMatch(/\bat\b.*\(/);
      // No internal hash-like strings
      expect(msg).not.toMatch(/0x[0-9a-f]{6,}/);
    }
  });

  it('UnknownModelError carries structured fields for programmatic handling', () => {
    setModelOverrides({});
    try {
      getCapabilities('my-fake-id-2099');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownModelError);
      const e = err as UnknownModelError;
      expect(e.modelId).toBe('my-fake-id-2099');
      expect(e.normalizedId).toBe('my-fake-id-2099');
      expect(Array.isArray(e.suggestions)).toBe(true);
      expect(e.name).toBe('UnknownModelError');
    }
  });
});
