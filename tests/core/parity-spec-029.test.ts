/**
 * Spec 029 parity tests — verifies the subsumption refactor (Phase B)
 * preserves spec 028's existing behaviour for shipped models.
 *
 * What this gate guarantees, per design §11:
 *   - Every model that resolved to a specific formatter pre-refactor still
 *     does post-refactor (resolveFormatter → getCapabilities pipeline)
 *   - Small-tier models still trigger the harness with the same effective
 *     defaults (no surprise upgrades/downgrades)
 *   - Spec 028 F-23's Hermes envelope regression case still passes (the
 *     fallback was reframed as always-on; behaviour unchanged)
 *
 * If this file fails on a refactor, the refactor changed observable
 * behaviour for shipped models — investigate before merging.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveFormatter } from '../../src/core/formats/index.js';
import { DsmlFormatter } from '../../src/core/formats/dsml.js';
import { QwenXmlFormatter } from '../../src/core/formats/qwen-xml.js';
import { FencedBlockFormatter } from '../../src/core/formats/fenced-block.js';
import { SmallModelHarness, resolveMaxToolCalls } from '../../src/core/small-model-harness.js';
import {
  getCapabilities,
  explainCapabilities,
  setModelOverrides,
} from '../../src/core/model-capabilities.js';

beforeEach(() => {
  // Reset module-level override state so tests don't leak between files
  setModelOverrides({});
});

describe('Spec 029 parity — formatter selection (T-B01)', () => {
  // Each entry: a model ID that resolved to a specific formatter pre-refactor.
  // Post-refactor (resolveFormatter → getCapabilities → resolvePreferredFormat
  // family-prefix function) must yield the same formatter class.
  const cases: Array<[string, new () => unknown]> = [
    // DeepSeek family → DSML
    ['deepseek-chat-v3', DsmlFormatter],
    ['deepseek-v3.1', DsmlFormatter],
    ['deepseek-r1-distill-llama-70b', DsmlFormatter],
    // Qwen family → qwen-xml
    ['qwen2.5-coder-32b', QwenXmlFormatter],
    ['qwen3-coder-480b', QwenXmlFormatter],
    ['Qwen/Qwen3-Coder-480B-A35B-Instruct', QwenXmlFormatter],
    // Frontier cloud — native gets remapped to fenced-block inside resolveFormatter
    // (text-extraction path; native is the SDK path)
    ['claude-opus-4-7', FencedBlockFormatter],
    ['gpt-5', FencedBlockFormatter],
    ['gemini-2-5-pro', FencedBlockFormatter],
    // Known generic local family → fenced-block fallback
    ['llama-3-8b', FencedBlockFormatter],
    // Spec 029 F-11: unknown model IDs no longer silently fall back —
    // resolveFormatter must throw via getCapabilities. Asserted separately
    // below; removed from the happy-path table.
  ];

  for (const [modelId, ExpectedFormatter] of cases) {
    it(`${modelId} → ${ExpectedFormatter.name}`, () => {
      const f = resolveFormatter('any-provider', modelId);
      expect(f).toBeInstanceOf(ExpectedFormatter);
    });
  }

  it('unknown model ID → throws UnknownModelError (spec 029 F-11)', () => {
    expect(() => resolveFormatter('any-provider', 'some-completely-unknown-model')).toThrow(
      /Unknown model "some-completely-unknown-model"/,
    );
  });

  it('explicit override still wins over family-prefix routing', () => {
    const f = resolveFormatter('any-provider', 'deepseek-v3', 'fenced-block');
    expect(f).toBeInstanceOf(FencedBlockFormatter);
  });
});

describe('Spec 029 parity — harness engagement (T-B03)', () => {
  // Small-tier models (per spec 028 F-24 classifier) must still trigger
  // the harness. Large-tier models must not.
  const smallModels = ['qwen2.5-coder-7b', 'qwen3-4b', 'llama-3-8b', 'phi-3-mini', 'gemma-2-2b'];
  const largeModels = [
    'claude-opus-4-7',
    'gpt-5',
    'qwen3-coder-480b',
    'deepseek-v3',
    'gemini-2-5-pro',
  ];

  for (const id of smallModels) {
    it(`small-tier: ${id} → harness engaged`, () => {
      const h = new SmallModelHarness(id);
      expect(h.isSmallModel).toBe(true);
      expect(h.getSystemPromptAddition()).toContain('Small model operating rules');
      expect(h.getPerTurnReminder()).toContain('Reminder');
    });
  }

  for (const id of largeModels) {
    it(`large-tier: ${id} → harness disengaged`, () => {
      const h = new SmallModelHarness(id);
      expect(h.isSmallModel).toBe(false);
      expect(h.getSystemPromptAddition()).toBeNull();
      expect(h.getPerTurnReminder()).toBeNull();
    });
  }
});

describe('Spec 029 parity — max_tool_calls resolution chain (T-B04)', () => {
  it('returns hardcoded 20 when no overrides or global config set', () => {
    expect(resolveMaxToolCalls('qwen2.5-coder-7b', {})).toBe(20);
  });

  it('global config wins over hardcoded fallback', () => {
    expect(resolveMaxToolCalls('qwen2.5-coder-7b', { max_tool_calls: 50 })).toBe(50);
  });

  it('per-model override (model_overrides) wins over global config', () => {
    setModelOverrides({
      'qwen2-5-coder-7b': { recommended_harness: { max_tool_calls: 99 } },
    });
    expect(resolveMaxToolCalls('qwen2.5-coder-7b', { max_tool_calls: 50 })).toBe(99);
  });

  it('per-model override wins over hardcoded fallback (no global)', () => {
    setModelOverrides({
      'qwen2-5-coder-7b': { recommended_harness: { max_tool_calls: 7 } },
    });
    expect(resolveMaxToolCalls('qwen2.5-coder-7b', {})).toBe(7);
  });
});

describe('Spec 029 parity — Hermes envelope regression (T-B02; spec 028 F-23)', () => {
  it('QwenXmlFormatter still parses Hermes envelope output (the original F-23 scenario)', () => {
    const f = new QwenXmlFormatter();
    // The exact failure shape from spec 028 F-23: model emits Hermes envelope
    // inside a <tool_call> block instead of JSON. Parser must recover it.
    const hermesText = `<tool_call>
<function=read>
<parameter=file_path>/tmp/x.txt</parameter>
</function>
</tool_call>`;
    const { toolCalls } = f.parse(hermesText);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.name).toBe('read');
    const args = JSON.parse(toolCalls[0]?.arguments ?? '{}');
    expect(args.file_path).toBe('/tmp/x.txt');
  });

  it('QwenXmlFormatter still parses canonical JSON inside <tool_call> (no regression)', () => {
    const f = new QwenXmlFormatter();
    const jsonText = `<tool_call>
{"name":"read","arguments":{"file_path":"/tmp/x.txt"}}
</tool_call>`;
    const { toolCalls } = f.parse(jsonText);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.name).toBe('read');
    const args = JSON.parse(toolCalls[0]?.arguments ?? '{}');
    expect(args.file_path).toBe('/tmp/x.txt');
  });

  it('Hermes fallback is NOT gated on model — fires for any model whose output uses qwen-xml', () => {
    // Construct the formatter without any modelId / quirk context. The
    // resilient parsing is a property of the format, not of the model.
    const f = new QwenXmlFormatter();
    const hermesText = `<tool_call><function=write>
<parameter=file_path>/x</parameter>
<parameter=content>hello</parameter>
</function></tool_call>`;
    const { toolCalls } = f.parse(hermesText);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.name).toBe('write');
  });
});

describe('Spec 029 parity — capabilities derivation is purely generic', () => {
  it('no per-model code branches: capabilities for unknown model throws UnknownModelError (F-11)', () => {
    // Spec 029 F-11 flipped this: copair no longer silently defaults unknown
    // models to safe-large. Callers must declare unknown IDs via
    // model_overrides (asserted below) or via shipped JSON registry.
    expect(() => getCapabilities('totally-new-model-no-one-has-seen-2099')).toThrow(
      /Unknown model "totally-new-model-no-one-has-seen-2099"/,
    );
  });

  it('user override fully replaces tier classification when set', () => {
    setModelOverrides({
      'completely-fake-id': { tier: 'small', preferred_format: 'qwen-xml' },
    });
    const c = getCapabilities('completely-fake-id');
    expect(c.tier).toBe('small');
    expect(c.preferred_format).toBe('qwen-xml');
    expect(c.recommended_harness.enable_small_model_harness).toBe(true);
  });
});

describe('Spec 029 — shipped sparse JSON data (data/model-capabilities.json)', () => {
  it('Claude family gets 200k context from shipped data, not 32k safe default', () => {
    const c = getCapabilities('claude-opus-4-7');
    expect(c.context_window).toBe(200_000);
    expect(c.native_tool_calling).toBe('reliable');
    expect(c.max_tokens).toBe(32_000); // Anthropic Opus output cap
  });

  it('max_tokens differs by family — GPT-5 gets 16384, GPT-5-mini gets 4096', () => {
    expect(getCapabilities('gpt-5').max_tokens).toBe(16_384);
    expect(getCapabilities('gpt-5-mini').max_tokens).toBe(4_096);
  });

  it('Unknown models with no override / shipped entry throw (spec 029 F-11)', () => {
    // Pre-F-11 this returned 4096 max_tokens via silent-large default.
    // Now it errors so the user is forced to declare the model in
    // model_overrides — preventing accidental "guessing" about behavior.
    expect(() => getCapabilities('unknown-2099')).toThrow(/Unknown model "unknown-2099"/);
  });

  it('Unknown model declared via model_overrides resolves with SAFE_DEFAULTS', () => {
    setModelOverrides({ 'unknown-2099': { tier: 'large' } });
    const c = getCapabilities('unknown-2099');
    expect(c.tier).toBe('large');
    expect(c.max_tokens).toBe(4_096); // SAFE_DEFAULTS — no shipped entry hit
    expect(c.context_window).toBe(32_768);
  });

  it('User override of max_tokens wins over shipped data', () => {
    setModelOverrides({ 'claude-opus-4-7': { max_tokens: 200 } });
    expect(getCapabilities('claude-opus-4-7').max_tokens).toBe(200);
  });

  it('GPT-5 family gets 400k context', () => {
    expect(getCapabilities('gpt-5').context_window).toBe(400_000);
  });

  it('Gemini 2.5 gets 1M context', () => {
    expect(getCapabilities('gemini-2-5-pro').context_window).toBe(1_000_000);
  });

  it('Qwen3-Coder 480B gets 256k context via shipped data — cross-host normalized', () => {
    expect(getCapabilities('qwen.qwen3-coder-480b-a35b-v1:0').context_window).toBe(262_144);
    expect(getCapabilities('Qwen/Qwen3-Coder-480B-A35B-Instruct').context_window).toBe(262_144);
  });

  it('Qwen2.5-Coder 14B small gets 128k context (matches shipped entry)', () => {
    expect(getCapabilities('qwen2.5-coder:14b').context_window).toBe(131_072);
  });

  it('User model_overrides wins over shipped data', () => {
    setModelOverrides({
      'claude-opus-4-7': { context_window: 50_000 }, // user nerfs context
    });
    expect(getCapabilities('claude-opus-4-7').context_window).toBe(50_000);
  });

  it('explainCapabilities surfaces the shipped-data match for Claude', () => {
    const ex = explainCapabilities('claude-opus-4-7');
    expect(ex.shippedDataMatch).not.toBeNull();
    expect(ex.shippedDataMatch?.family).toMatch(/Claude/);
    expect(ex.finalCapabilities.context_window).toBe(200_000);
  });

  it('explainCapabilities throws UnknownModelError for unknown models (spec 029 F-11)', () => {
    // The CLI wrapper (src/cli/explain-model.ts via bootstrap.ts) catches this
    // and exits 1 — explainCapabilities itself does NOT fabricate a trace from
    // safe-defaults (design §17.4).
    expect(() => explainCapabilities('something-nobody-knows-2099')).toThrow(
      /Unknown model "something-nobody-knows-2099"/,
    );
  });

  it('explainCapabilities reports null shippedDataMatch for known-family-no-shipped-entry', () => {
    // Sanity check that the null-shippedDataMatch path still works for known
    // models that simply lack a shipped JSON entry. falcon-3-7b matches the
    // Falcon TIER_RULES entry (tier: small) but has no shipped JSON row.
    setModelOverrides({});
    const ex = explainCapabilities('falcon-3-7b');
    expect(ex.shippedDataMatch).toBeNull();
    // SAFE_DEFAULTS for context_window since no shipped entry covers this.
    expect(ex.finalCapabilities.context_window).toBe(32_768);
    expect(ex.tier.value).toBe('small');
    expect(ex.tier.source).toBe('classifier');
  });
});
