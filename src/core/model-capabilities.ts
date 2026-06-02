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
import {
  classifyModel,
  normalizeModelId,
  TIER_RULE_FAMILIES,
  TIER_RULE_PATTERN_SOURCES,
  type ModelTier,
} from './model-tiers.js';
import shippedData from '../../data/model-capabilities.json' with { type: 'json' };

// STABLE PUBLIC SURFACE — see spec 029 requirements §10 F-16 URL stability requirement.
// Do not refactor casually; users will hit this URL in error messages, and the
// page route is coordinated across copair (this constant) and the copair-website
// page (T-W05). Renaming requires a coordinated rename in both places.
const DOCS_URL_CUSTOM_MODELS = 'https://docs.copair.dev/custom-and-local-models';

// ── Capability schemas ─────────────────────────────────────────────────────

/**
 * Full per-model capabilities record. `getCapabilities()` always returns a
 * fully-populated value built from generic-logic-derived defaults plus
 * (optionally) user overrides.
 */
export const ModelCapabilitiesSchema = z.object({
  tier: z.enum(['small', 'large']),
  context_window: z.number().int().positive(),
  /**
   * Maximum output tokens the model can generate in a single response.
   * Distinct from `context_window` (total prompt + completion). Real
   * per-family variation: frontier-cloud models often allow 16k-128k
   * output; many open-weight models cap at 4-8k. When a provider config
   * doesn't override this, copair uses the value here as the cap to
   * avoid silent truncation.
   */
  max_tokens: z.number().int().positive(),
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
  max_tokens: z.number().int().positive().optional(),
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
  /** Conservative default for unknown models. Most modern APIs accept at
   *  least 4k output. Shipped JSON overrides for families with higher caps. */
  max_tokens: 4_096,
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
 *
 * **`max_tool_calls` is intentionally `undefined`** for both tiers so the
 * resolution chain in `resolveMaxToolCalls` (small-model-harness.ts) falls
 * through to `config.small_models.max_tool_calls` (the global) and then to
 * the hardcoded fallback. This preserves spec 028's backwards-compat —
 * users who set `small_models.max_tool_calls: N` continue to see N apply.
 */
export function resolveHarnessDefaults(tier: ModelTier): ModelCapabilities['recommended_harness'] {
  if (tier === 'small') {
    return {
      enable_small_model_harness: true,
      max_turns: 30,
      max_tool_calls: undefined, // falls through to global config (NF-01 backwards compat)
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
    max_tokens: override.max_tokens ?? base.max_tokens,
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

// ── Shipped sparse data (data/model-capabilities.json) ────────────────────

/**
 * Compiled entry from the shipped JSON data file. Patterns are compiled
 * once at module load; capabilities are `ModelOverride`-shape (deep-partial)
 * so individual fields layer onto base defaults without forcing full records.
 */
interface ShippedEntry {
  pattern: RegExp;
  family: string;
  capabilities: ModelOverride;
}

const SHIPPED_ENTRIES: ShippedEntry[] = (() => {
  const entries: ShippedEntry[] = [];
  for (const raw of shippedData.entries) {
    // Validate each entry's capabilities shape against ModelOverrideSchema at
    // module load — catches malformed JSON developer-side before production.
    const caps = ModelOverrideSchema.parse(raw.capabilities);
    entries.push({
      pattern: new RegExp(raw.pattern),
      family: raw.family,
      capabilities: caps,
    });
  }
  return entries;
})();

/**
 * Walk SHIPPED_ENTRIES in order; return the first matching entry, or null
 * if none match. Mirrors spec 028 F-24's classifier ordering: most-specific
 * patterns appear first in the JSON file.
 */
function lookupShippedData(normalizedId: string): ShippedEntry | null {
  for (const entry of SHIPPED_ENTRIES) {
    if (entry.pattern.test(normalizedId)) return entry;
  }
  return null;
}

// ── Strict-unknowns: UnknownModelError + did-you-mean (spec 029 §17, F-11) ─

/**
 * Thrown by `getCapabilities` when a model ID is not recognized by any
 * TIER_RULES family rule, has no `model_overrides[normalizedId]` entry, and
 * has no shipped `data/model-capabilities.json` entry. The error carries the
 * raw + normalized ID and the top did-you-mean suggestions so the message
 * is self-sufficient for the user to act on.
 *
 * NF-08 hygiene (spec 029 requirements §10): the error message contains
 * ONLY the user-supplied modelId, the normalizedId, the suggestion list,
 * and `DOCS_URL_CUSTOM_MODELS`. No filesystem paths, no stack traces, no
 * internal hash values, no `_modelOverrides` contents.
 */
export class UnknownModelError extends Error {
  constructor(
    readonly modelId: string,
    readonly normalizedId: string,
    readonly suggestions: string[],
  ) {
    const didYouMean =
      suggestions.length > 0
        ? `Did you mean:\n${suggestions.map((s) => `  - ${s}`).join('\n')}\n\n`
        : '';
    super(
      `Unknown model "${modelId}" (normalized: "${normalizedId}"). ` +
        `Add it to model_overrides in your config with at least \`tier: small | large\`. ` +
        `See: ${DOCS_URL_CUSTOM_MODELS}\n\n` +
        didYouMean +
        `Or check the shipped registry: data/model-capabilities.json`,
    );
    this.name = 'UnknownModelError';
  }
}

/**
 * Levenshtein edit distance via a small DP table. Pure JS, no library —
 * runs only on the `UnknownModelError` path so cost is irrelevant on the
 * happy path. ~20 LOC per spec 029 design §17.3.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Extract user-typeable model-ID stems from a regex pattern source. Handles
 * the common shapes we use in TIER_RULES / shipped JSON:
 *   - `^claude-opus`            → ['claude-opus']
 *   - `^claude-(?:sonnet|haiku)` → ['claude-sonnet', 'claude-haiku']
 *   - `^gpt-(?:3-5|4|5)`        → ['gpt-3-5', 'gpt-4', 'gpt-5']
 * For patterns with more exotic regex meta (lookahead, character classes),
 * falls back to the literal prefix up to the first meta character. The goal
 * is "good enough" did-you-mean coverage, not exhaustive expansion.
 */
function extractPatternStems(source: string): string[] {
  const body = source.replace(/^\^/, '').replace(/\$$/, '');
  // Match: literal-prefix + optional (?:a|b|c) alternation + literal-suffix.
  // Each segment must be free of regex meta beyond simple-character runs.
  const altRe = /^([a-z0-9-]*)\(\?:([a-z0-9|-]+)\)([a-z0-9-]*)/i;
  const m = body.match(altRe);
  if (m) {
    const [, prefix, alts, suffix] = m;
    return alts.split('|').map((a) => (prefix + a + suffix).toLowerCase());
  }
  // No alternation we can expand — take the literal-only prefix
  const literal = body.match(/^[a-z0-9-]+/i);
  return literal ? [literal[0].toLowerCase()] : [];
}

/**
 * Return up to 3 closest-matching candidate model IDs to `normalized` by
 * Levenshtein distance. Threshold: distance ≤ max(3, len(query) × 0.4) — a
 * small absolute floor for short queries, scaled fraction for long ones.
 * Per spec 029 design §17.3 + requirements NF-05.
 *
 * Candidate set: shipped JSON pattern stems (e.g. `claude-opus`,
 * `claude-sonnet`) ∪ shipped family labels ∪ currently-loaded
 * `_modelOverrides` keys ∪ TIER_RULES family names ∪ TIER_RULES pattern
 * stems. Dedup before scoring; slice top 3 ascending.
 *
 * Returns `[]` for gibberish IDs that aren't near anything — the empty list
 * triggers the no-suggestion branch in `UnknownModelError`.
 */
export function suggestDidYouMean(normalized: string): string[] {
  const candidates: string[] = [
    ...SHIPPED_ENTRIES.flatMap((e) => extractPatternStems(e.pattern.source)),
    ...SHIPPED_ENTRIES.map((e) => e.family.toLowerCase()),
    ...Object.keys(_modelOverrides),
    ...TIER_RULE_FAMILIES,
    ...TIER_RULE_PATTERN_STEMS,
  ];
  const seen = new Set<string>();
  const scored: Array<{ c: string; d: number }> = [];
  const queryThreshold = Math.max(3, Math.floor(normalized.length * 0.4));
  for (const c of candidates) {
    if (!c) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    const d = levenshtein(normalized, c);
    if (d <= queryThreshold) scored.push({ c, d });
  }
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, 3).map((s) => s.c);
}

/**
 * Module-load-time-computed list of TIER_RULES pattern stems, expanded once
 * per import. Used by `suggestDidYouMean` to give the candidate pool real
 * model-ID-shaped strings (e.g. `claude`, `qwen3-coder-480b`) rather than
 * just family labels.
 */
const TIER_RULE_PATTERN_STEMS: string[] = TIER_RULE_PATTERN_SOURCES.flatMap(
  extractPatternStems,
);

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
 *   2. Classify via spec 028 `classifyModel` — may yield `tier: null` (unknown)
 *   3. **Strict-unknowns guard (spec 029 §17, F-11)**: if the classifier
 *      returned `tier: null` AND there is no `model_overrides` entry AND no
 *      shipped-data entry for this ID, throw `UnknownModelError`. Otherwise
 *      derive the effective tier from override / shipped-data / classifier
 *      (in that precedence order).
 *   4. Derive `preferred_format` via `resolvePreferredFormat` (family-prefix)
 *   5. Derive `recommended_harness` via `resolveHarnessDefaults(tier)`
 *   6. Fill `context_window` / `native_tool_calling` from `SAFE_DEFAULTS`
 *   7. Layer shipped JSON entry, then user `model_overrides[normalizedId]`,
 *      on top via `deepMerge`.
 *
 * @throws {UnknownModelError} when the ID matches no family rule and the user
 *   has not declared it via overrides / shipped data.
 */
export function getCapabilities(modelId: string | null | undefined): ModelCapabilities {
  const id = modelId ?? '';
  const normalized = normalizeModelId(id);
  const classification = classifyModel(id);
  const override = _modelOverrides[normalized];
  const shipped = lookupShippedData(normalized);

  // Strict-unknowns: refuse silently-defaulting to `large` for IDs we don't
  // recognize. The user must declare unknown models in `model_overrides` (or
  // the ID must be covered by shipped JSON data).
  if (classification.tier === null && !override && !shipped) {
    throw new UnknownModelError(id, normalized, suggestDidYouMean(normalized));
  }

  // Effective tier — override > shipped > classifier. The classifier tier may
  // be null here (when shipped or override is providing the value), so we
  // fall back to 'large' as the absolute floor; downstream resolution then
  // re-merges shipped/override on top so the user-declared value wins anyway.
  const effectiveTier: ModelTier =
    override?.tier ?? shipped?.capabilities.tier ?? classification.tier ?? 'large';

  let base: ModelCapabilities = {
    tier: effectiveTier,
    context_window: SAFE_DEFAULTS.context_window,
    max_tokens: SAFE_DEFAULTS.max_tokens,
    native_tool_calling: SAFE_DEFAULTS.native_tool_calling,
    preferred_format: resolvePreferredFormat(normalized),
    recommended_harness: resolveHarnessDefaults(effectiveTier),
  };

  if (shipped) {
    base = deepMerge(base, shipped.capabilities);
  }

  return override ? deepMerge(base, override) : base;
}

// ── Diagnostic API (for --explain-model) ───────────────────────────────────

export interface ResolvedCapabilities {
  modelId: string;
  normalizedId: string;
  tier: { value: ModelTier; source: 'classifier' | 'shipped-data' | 'override' };
  preferred_format: {
    value: ModelCapabilities['preferred_format'];
    source: 'family-prefix' | 'shipped-data' | 'override';
  };
  /** Which shipped-data entry (if any) contributed to the resolved capabilities.
   *  Helps users see "context_window=200000 because the shipped entry for Claude
   *  matched my model ID, not the safe default."  null when no shipped entry hit. */
  shippedDataMatch: { family: string; pattern: string } | null;
  overrideApplied: ModelOverride | null;
  finalCapabilities: ModelCapabilities;
}

/**
 * Return the full resolution trace for a model ID. Used by `--explain-model`
 * CLI flag to surface where each value came from. Read-only; no warning side
 * effects.
 *
 * @throws {UnknownModelError} when the ID matches no family rule and has no
 *   user override / shipped-data entry — same strict-unknowns contract as
 *   `getCapabilities`. The CLI wrapper catches and prints to stderr; do NOT
 *   fabricate a trace from safe-defaults (spec 029 design §17.4).
 */
export function explainCapabilities(modelId: string): ResolvedCapabilities {
  const id = modelId ?? '';
  const normalized = normalizeModelId(id);
  const classification = classifyModel(id);
  const derivedFormat = resolvePreferredFormat(normalized);
  const override = _modelOverrides[normalized] ?? null;
  const shipped = lookupShippedData(normalized);

  // Strict-unknowns: same guard as getCapabilities so `--explain-model
  // <unknown>` cleanly errors out instead of fabricating a trace from
  // safe-defaults.
  if (classification.tier === null && !override && !shipped) {
    throw new UnknownModelError(id, normalized, suggestDidYouMean(normalized));
  }

  // Effective tier — override > shipped > classifier > 'large' floor.
  const effectiveTier: ModelTier =
    override?.tier ?? shipped?.capabilities.tier ?? classification.tier ?? 'large';

  let base: ModelCapabilities = {
    tier: effectiveTier,
    context_window: SAFE_DEFAULTS.context_window,
    max_tokens: SAFE_DEFAULTS.max_tokens,
    native_tool_calling: SAFE_DEFAULTS.native_tool_calling,
    preferred_format: derivedFormat,
    recommended_harness: resolveHarnessDefaults(effectiveTier),
  };

  if (shipped) base = deepMerge(base, shipped.capabilities);

  const final = override ? deepMerge(base, override) : base;

  // preferred_format source resolution (most-specific-first):
  // override > shipped-data > family-prefix
  let formatSource: 'family-prefix' | 'shipped-data' | 'override' = 'family-prefix';
  if (override?.preferred_format !== undefined) formatSource = 'override';
  else if (shipped?.capabilities.preferred_format !== undefined) formatSource = 'shipped-data';

  // tier source resolution (most-specific-first): override > shipped-data >
  // classifier. Aligned with the effectiveTier fallback chain above.
  let tierSource: 'classifier' | 'shipped-data' | 'override' = 'classifier';
  if (override?.tier !== undefined) tierSource = 'override';
  else if (classification.tier === null && shipped?.capabilities.tier !== undefined) {
    tierSource = 'shipped-data';
  }

  return {
    modelId: id,
    normalizedId: normalized,
    tier: {
      value: final.tier,
      source: tierSource,
    },
    preferred_format: {
      value: final.preferred_format,
      source: formatSource,
    },
    shippedDataMatch: shipped
      ? { family: shipped.family, pattern: shipped.pattern.source }
      : null,
    overrideApplied: override,
    finalCapabilities: final,
  };
}

// ── Re-exports for downstream consumers ────────────────────────────────────

export { classifyModel, normalizeModelId };
export type { ModelTier };
