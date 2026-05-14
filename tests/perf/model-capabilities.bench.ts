/**
 * Performance benchmark for `getCapabilities` (spec 029 NF-02, T-D04).
 *
 * Target: <0.5 ms median per call.
 *
 * Run locally before releases:
 *   $ npx vitest bench tests/perf/model-capabilities.bench.ts
 *
 * NOT CI-gated. Local-only — we'd rather fix slow lookups when we notice
 * them than block builds on perf budget violations.
 *
 * Cost breakdown (per design §10):
 *   - normalizeModelId        ~10μs   (string ops)
 *   - classifyModel           ~50-300μs (regex walk over ~50 family rules)
 *   - resolvePreferredFormat  ~5μs    (handful of startsWith)
 *   - resolveHarnessDefaults  ~1μs    (object-literal return)
 *   - lookupShippedData       ~10-200μs (regex walk over ~60 entries)
 *   - deepMerge (if override) ~5μs    (handful of ?? chains)
 *
 * Worst case (override + all entries miss): ~500μs. Typical case (early
 * shipped-data hit): well under 1ms. No caching at v1; if numbers drift
 * above target, switch to memoized lookup per design §10 trip-wires.
 */
import { bench, describe } from 'vitest';
import {
  getCapabilities,
  explainCapabilities,
  setModelOverrides,
} from '../../src/core/model-capabilities.js';

// A rotating set of realistic model IDs covering frontier-cloud, frontier
// open-weight, and small open-weight families — exercises different paths
// through the shipped data layer.
const MIXED_IDS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'gpt-5',
  'gpt-4o',
  'gemini-2-5-pro',
  'grok-4',
  'qwen.qwen3-coder-480b-a35b-v1:0',
  'qwen2.5-coder:14b',
  'deepseek-v3',
  'llama-3-1-8b',
  'llama-4-scout',
  'phi-4-mini',
  'gemma-3-4b',
  'codestral-2501',
  'glm-4-9b',
  'mixtral-8x7b',
  'unknown-model-2099',  // exercises fall-through path
  'another-fake-id',
] as const;

describe('getCapabilities — hot path latency (NF-02 target: <0.5ms)', () => {
  bench('single cold lookup (claude-opus-4-7) — typical frontier-cloud path', () => {
    getCapabilities('claude-opus-4-7');
  });

  bench('single cold lookup (qwen.qwen3-coder-480b-a35b-v1:0) — Bedrock-prefixed normalization', () => {
    getCapabilities('qwen.qwen3-coder-480b-a35b-v1:0');
  });

  bench('single cold lookup (totally-unknown-model) — full miss path (slowest)', () => {
    getCapabilities('something-nobody-has-heard-of-2099');
  });

  bench('mixed-model loop (18 IDs, simulates a session with frequent /model switches)', () => {
    for (const id of MIXED_IDS) {
      getCapabilities(id);
    }
  });
});

describe('getCapabilities — with user overrides loaded', () => {
  setModelOverrides({
    'qwen2-5-coder-14b': {
      tier: 'large',
      context_window: 99_999,
      recommended_harness: { max_turns: 100 },
    },
    'claude-opus-4-7': { context_window: 50_000 },
  });

  bench('cold lookup with override applied (override path adds deepMerge)', () => {
    getCapabilities('qwen2.5-coder:14b');
  });

  bench('mixed-model loop with some overridden, some not', () => {
    for (const id of MIXED_IDS) {
      getCapabilities(id);
    }
  });

  setModelOverrides({});
});

describe('explainCapabilities — diagnostic path (slightly slower; not on hot path)', () => {
  bench('explainCapabilities for known model', () => {
    explainCapabilities('claude-opus-4-7');
  });

  bench('explainCapabilities for unknown model', () => {
    explainCapabilities('something-nobody-has-heard-of-2099');
  });
});
