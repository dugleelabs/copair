/**
 * Model capabilities contract (spec 029).
 *
 * Provides a single lookup API — `getCapabilities(modelId)` — that future
 * Pillar 1 features consult instead of substring-matching `modelId`. Every
 * value in the returned record is derived by *generic* logic:
 *
 *   - `tier`               → spec 028 F-24's `classifyModel`
 *   - `preferred_format`   → family-prefix function (qwen-family → qwen-xml, etc.)
 *   - `recommended_harness`→ tier-driven defaults (small → harness on, large → off)
 *   - `context_window`, `native_tool_calling` → safe defaults
 *
 * Per-model facts that genuinely vary (e.g. a specific model's context window)
 * are handled via user `model_overrides` in config — the escape hatch. There
 * is no shipped per-model registry in code; copair carries no per-model
 * branches by design. Reframed 2026-05-15 per the no-per-model-code principle.
 *
 * If a model surfaces protocol drift (e.g. spec 028 F-23's Hermes envelope
 * pattern from Qwen3-Coder), the fix lives as resilient parsing inside the
 * relevant formatter — not as a per-model entry here. The qwen-xml formatter
 * always tries the Hermes fallback when standard parsing fails; any model
 * whose output uses qwen-xml gets the resilient parser.
 */

import { z } from 'zod';
import { classifyModel, normalizeModelId, type ModelTier } from './model-tiers.js';

// ── Capability schemas ─────────────────────────────────────────────────────

/**
 * Full per-model capabilities record. `getCapabilities()` always returns a
 * fully-populated value built from generic-logic-derived defaults plus
 * (optionally) user overrides.
 */
export const ModelCapabilitiesSchema = z.object({
  tier: z.enum(['small', 'large']),
  context_window: z.number().int().positive(),
  native_tool_calling: z.enum(['reliable', 'unreliable', 'none']),
  preferred_format: z.enum(['qwen-xml', 'dsml', 'fenced-block', 'native']),
  recommended_harness: z.object({
    enable_small_model_harness: z.boolean(),
    max_turns: z.number().int().positive(),
    /** Per-model override of the global `config.small_models.max_tool_calls`.
     *  Optional: when undefined, harness falls through to the global default. */
    max_tool_calls: z.number().int().positive().optional(),
    inject_format_reminder_every_turn: z.boolean(),
  }),
});

export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

/**
 * User override entry — every field optional. Deep-merged on the base
 * (generic-logic-derived) capabilities. Per design §3 + §5.
 */
export const ModelOverrideSchema = z.object({
  tier: z.enum(['small', 'large']).optional(),
  context_window: z.number().int().positive().optional(),
  native_tool_calling: z.enum(['reliable', 'unreliable', 'none']).optional(),
  preferred_format: z.enum(['qwen-xml', 'dsml', 'fenced-block', 'native']).optional(),
  recommended_harness: z
    .object({
      enable_small_model_harness: z.boolean().optional(),
      max_turns: z.number().int().positive().optional(),
      max_tool_calls: z.number().int().positive().optional(),
      inject_format_reminder_every_turn: z.boolean().optional(),
    })
    .optional(),
});

export type ModelOverride = z.infer<typeof ModelOverrideSchema>;

// ── Safe defaults ──────────────────────────────────────────────────────────

/**
 * Default values for fields that aren't derived dynamically (tier comes from
 * `classifyModel`; preferred_format comes from `resolvePreferredFormat`).
 * Users can override any of these per-model via config.
 */
const SAFE_DEFAULTS: Omit<ModelCapabilities, 'tier' | 'preferred_format'> = {
  context_window: 32_768,
  native_tool_calling: 'unreliable',
  recommended_harness: {
    enable_small_model_harness: false,
    max_turns: 20,
    max_tool_calls: undefined,
    inject_format_reminder_every_turn: false,
  },
};

// ── Generic protocol-level routing ─────────────────────────────────────────

/**
 * Family-prefix → preferred tool-call format. Protocol-family-level, not
 * per-model. Each `startsWith` line covers a family of N models, not just
 * one. Adding a new family is a one-line addition.
 *
 * If small-model-hardening (spec 032) benchmarks reveal a family needs a
 * different format than the prefix implies, we update this function — not a
 * per-model table.
 */
export function resolvePreferredFormat(normalizedId: string): ModelCapabilities['preferred_format'] {
  // Qwen family (Qwen2.x, Qwen3, Qwen3-Coder, QwQ, etc.) → qwen-xml
  if (normalizedId.startsWith('qwen') || normalizedId.startsWith('qwq')) return 'qwen-xml';
  // DeepSeek family (V2/V3, R1, Coder) → DSML
  if (normalizedId.startsWith('deepseek')) return 'dsml';
  // Frontier-cloud models with reliable native tool calling
  if (
    normalizedId.startsWith('claude') ||
    normalizedId.startsWith('gpt') ||
    normalizedId.startsWith('gemini') ||
    normalizedId.startsWith('o1') ||
    normalizedId.startsWith('o3') ||
    normalizedId.startsWith('o4')
  )
    return 'native';
  // Default — fenced-block is the most universally-parseable for unknowns
  return 'fenced-block';
}

/**
 * Tier-driven harness defaults. Two settings: small (harness engaged) or
 * large (harness disengaged). Users override individual fields via
 * `model_overrides` config if they need more granularity per-model.
 */
export function resolveHarnessDefaults(tier: ModelTier): ModelCapabilities['recommended_harness'] {
  if (tier === 'small') {
    return {
      enable_small_model_harness: true,
      max_turns: 30,
      max_tool_calls: 20,
      inject_format_reminder_every_turn: true,
    };
  }
  // Large tier — harness disengaged, generous limits
  return SAFE_DEFAULTS.recommended_harness;
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Deep-merge a user `ModelOverride` onto a base `ModelCapabilities`. Per
 * design §5:
 *   - Primitive fields: override wins if `!== undefined` (last-write-wins)
 *   - `recommended_harness`: field-by-field nested merge
 */
function deepMerge(base: ModelCapabilities, override: ModelOverride): ModelCapabilities {
  return {
    tier: override.tier ?? base.tier,
    context_window: override.context_window ?? base.context_window,
    native_tool_calling: override.native_tool_calling ?? base.native_tool_calling,
    preferred_format: override.preferred_format ?? base.preferred_format,
    recommended_harness: {
      enable_small_model_harness:
        override.recommended_harness?.enable_small_model_harness ??
        base.recommended_harness.enable_small_model_harness,
      max_turns:
        override.recommended_harness?.max_turns ?? base.recommended_harness.max_turns,
      max_tool_calls:
        override.recommended_harness?.max_tool_calls ?? base.recommended_harness.max_tool_calls,
      inject_format_reminder_every_turn:
        override.recommended_harness?.inject_format_reminder_every_turn ??
        base.recommended_harness.inject_format_reminder_every_turn,
    },
  };
}

// ── Config access ──────────────────────────────────────────────────────────

/**
 * Per-process pointer to the loaded config's `model_overrides` map. Set by
 * the config loader via `setModelOverrides`; defaults to empty until wired up.
 * Keys must already be normalized (use `normalizeModelId`) before passing.
 */
let _modelOverrides: Record<string, ModelOverride> = {};

/**
 * Replace the active `model_overrides` map. Called by the config loader
 * after parsing + normalizing the user's config.
 */
export function setModelOverrides(overrides: Record<string, ModelOverride>): void {
  _modelOverrides = overrides;
}

/** Test-only — read the current overrides map. */
export function _getModelOverridesForTests(): Record<string, ModelOverride> {
  return _modelOverrides;
}

// ── Public lookup API ──────────────────────────────────────────────────────

/**
 * Resolve the full `ModelCapabilities` record for a given model ID.
 *
 * Pipeline:
 *   1. Normalize via spec 028 `normalizeModelId`
 *   2. Derive `tier` via spec 028 `classifyModel` (single source of truth)
 *   3. Derive `preferred_format` via `resolvePreferredFormat` (family-prefix)
 *   4. Derive `recommended_harness` via `resolveHarnessDefaults(tier)`
 *   5. Fill `context_window` / `native_tool_calling` from `SAFE_DEFAULTS`
 *   6. Deep-merge any user `model_overrides[normalizedId]` on top
 *
 * Never throws. Empty / null / undefined `modelId` resolves to safe defaults
 * (`tier: 'large'` from F-24's unknown-default; `preferred_format: 'fenced-block'`).
 */
export function getCapabilities(modelId: string | null | undefined): ModelCapabilities {
  const id = modelId ?? '';
  const normalized = normalizeModelId(id);
  const { tier } = classifyModel(id);

  const base: ModelCapabilities = {
    tier,
    context_window: SAFE_DEFAULTS.context_window,
    native_tool_calling: SAFE_DEFAULTS.native_tool_calling,
    preferred_format: resolvePreferredFormat(normalized),
    recommended_harness: resolveHarnessDefaults(tier),
  };

  const override = _modelOverrides[normalized];
  return override ? deepMerge(base, override) : base;
}

// ── Diagnostic API (for --explain-model) ───────────────────────────────────

export interface ResolvedCapabilities {
  modelId: string;
  normalizedId: string;
  tier: { value: ModelTier; source: 'classifier' | 'override' };
  preferred_format: {
    value: ModelCapabilities['preferred_format'];
    source: 'family-prefix' | 'override';
  };
  overrideApplied: ModelOverride | null;
  finalCapabilities: ModelCapabilities;
}

/**
 * Return the full resolution trace for a model ID. Used by `--explain-model`
 * CLI flag to surface where each value came from. Read-only; no warning side
 * effects.
 */
export function explainCapabilities(modelId: string): ResolvedCapabilities {
  const id = modelId ?? '';
  const normalized = normalizeModelId(id);
  const { tier: derivedTier } = classifyModel(id);
  const derivedFormat = resolvePreferredFormat(normalized);

  const base: ModelCapabilities = {
    tier: derivedTier,
    context_window: SAFE_DEFAULTS.context_window,
    native_tool_calling: SAFE_DEFAULTS.native_tool_calling,
    preferred_format: derivedFormat,
    recommended_harness: resolveHarnessDefaults(derivedTier),
  };

  const override = _modelOverrides[normalized] ?? null;
  const final = override ? deepMerge(base, override) : base;

  return {
    modelId: id,
    normalizedId: normalized,
    tier: {
      value: final.tier,
      source: override?.tier !== undefined ? 'override' : 'classifier',
    },
    preferred_format: {
      value: final.preferred_format,
      source: override?.preferred_format !== undefined ? 'override' : 'family-prefix',
    },
    overrideApplied: override,
    finalCapabilities: final,
  };
}

// ── Re-exports for downstream consumers ────────────────────────────────────

export { classifyModel, normalizeModelId };
export type { ModelTier };
