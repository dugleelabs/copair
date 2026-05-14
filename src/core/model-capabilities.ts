/**
 * Model capabilities registry (spec 029).
 *
 * Extends spec 028 F-24's `small | large` tier classifier into a richer
 * per-model record covering: tier, context window, native tool-call quality,
 * preferred tool-call format, known quirks, and recommended harness flags.
 *
 * Lookup is keyed on the post-normalization model ID (via spec 028's
 * `normalizeModelId`). Tier is resolved via `classifyModel` from spec 028 —
 * the registry layers additional fields on top so tier classification stays
 * the single source of truth.
 *
 * Module-level invariants:
 *   - REGISTRY entries are ordered most-specific-first; first match wins.
 *   - Every shipped entry passes `ModelCapabilitiesSchema.parse` at module
 *     load (see the validation pass at the bottom of this file).
 *   - Adding a new entry is an append-only PR; no schema changes required.
 *   - Adding a new quirk is a 4-step PR (see design §3): extend QUIRK_IDS,
 *     apply to relevant entries, add consumer handling, add tests.
 */

import { z } from 'zod';
import { classifyModel, normalizeModelId, type ModelTier } from './model-tiers.js';

// ── Quirk taxonomy ─────────────────────────────────────────────────────────

/**
 * Quirk IDs the harness / formatter layers know to handle.
 *
 * Typed union so adding a new quirk requires schema + handler in the same
 * PR. Consumers reference quirks by string-literal: e.g.
 * `caps.known_quirks.includes('hermes-envelope-drift')`.
 */
export const QUIRK_IDS = [
  /** Spec 028 F-23 — Qwen3-Coder relapses to Hermes envelope mid-conversation.
   *  Formatter activates the Hermes envelope fallback parser when present. */
  'hermes-envelope-drift',
] as const;

export type QuirkId = (typeof QUIRK_IDS)[number];

// ── Capability schemas ─────────────────────────────────────────────────────

/**
 * Full per-model capabilities record. Every shipped registry entry conforms
 * to this schema; `getCapabilities()` always returns a fully-populated value.
 */
export const ModelCapabilitiesSchema = z.object({
  tier: z.enum(['small', 'large']),
  context_window: z.number().int().positive(),
  native_tool_calling: z.enum(['reliable', 'unreliable', 'none']),
  preferred_format: z.enum(['qwen-xml', 'dsml', 'fenced-block', 'native']),
  known_quirks: z.array(z.enum(QUIRK_IDS)).default([]),
  recommended_harness: z.object({
    enable_small_model_harness: z.boolean(),
    max_turns: z.number().int().positive(),
    /** Per-model override of the global `config.small_models.max_tool_calls`.
     *  Optional: when undefined, the harness falls through to the global. */
    max_tool_calls: z.number().int().positive().optional(),
    inject_format_reminder_every_turn: z.boolean(),
  }),
});

export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

/**
 * User override entry — every field optional. Deep-merged on the matched
 * registry entry (or on SAFE_DEFAULTS if no match). See design §3 + §5 for
 * the merge algorithm.
 */
export const ModelOverrideSchema = z.object({
  tier: z.enum(['small', 'large']).optional(),
  context_window: z.number().int().positive().optional(),
  native_tool_calling: z.enum(['reliable', 'unreliable', 'none']).optional(),
  preferred_format: z.enum(['qwen-xml', 'dsml', 'fenced-block', 'native']).optional(),
  known_quirks: z.array(z.enum(QUIRK_IDS)).optional(),
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

// ── Registry entry shape ───────────────────────────────────────────────────

export interface RegistryEntry {
  /** Regex matched against the post-normalization model ID (lowercase, dashed). */
  pattern: RegExp;
  /** Human-readable family name; mirrors spec 028 F-24's `family` field. */
  family: string;
  /** Full capabilities record. No partial — every shipped entry is complete. */
  capabilities: ModelCapabilities;
}

// ── Safe defaults for unknown models ───────────────────────────────────────

/**
 * Default capability values for unknown models. The `tier` field is omitted
 * here — it's filled in at lookup time by `classifyModel` so spec 028 F-24
 * stays the single source of truth for tier (which itself defaults to
 * `'large'` for unmatched IDs).
 *
 * Composite default for a truly unknown model is `{ tier: 'large', ...SAFE_DEFAULTS }`.
 */
export const SAFE_DEFAULTS: Omit<ModelCapabilities, 'tier'> = {
  context_window: 32_768,
  native_tool_calling: 'unreliable',
  preferred_format: 'fenced-block',
  known_quirks: [],
  recommended_harness: {
    enable_small_model_harness: false,
    max_turns: 20,
    max_tool_calls: undefined,
    inject_format_reminder_every_turn: false,
  },
};

// ── Registry (T-A09 populates this) ────────────────────────────────────────

/**
 * Per-model capabilities registry. Ordered most-specific-first; first match
 * wins. Empty placeholder; T-A09 populates with the ~50–100 model families
 * documented in design §4.
 */
export const REGISTRY: RegistryEntry[] = [];

// ── Module-load validation (T-A10) ─────────────────────────────────────────

/**
 * Validate every registry entry at module load. Catches malformed entries
 * developer-side before they reach production. Cost is negligible (linear
 * Zod parse over ~50–100 records, runs once per process).
 */
for (const entry of REGISTRY) {
  ModelCapabilitiesSchema.parse(entry.capabilities);
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Walk REGISTRY in order; return the first matching entry's capabilities, or
 * null if none match. Patterns are pre-compiled (RegExp at module load) so
 * the per-call cost is linear in the entry count.
 */
function matchRegistry(normalizedId: string): {
  capabilities: ModelCapabilities;
  family: string;
  patternSource: string;
} | null {
  for (const entry of REGISTRY) {
    if (entry.pattern.test(normalizedId)) {
      return {
        capabilities: entry.capabilities,
        family: entry.family,
        patternSource: entry.pattern.source,
      };
    }
  }
  return null;
}

/**
 * Deep-merge a user `ModelOverride` onto a base `ModelCapabilities`. Per
 * design §5 + OQ-6 resolution:
 *   - Primitive fields: override wins if `!== undefined` (last-write-wins).
 *   - `known_quirks`: concat + dedupe via Set.
 *   - `recommended_harness`: field-by-field nested merge.
 */
function deepMerge(
  base: ModelCapabilities,
  override: ModelOverride,
): ModelCapabilities {
  return {
    tier: override.tier ?? base.tier,
    context_window: override.context_window ?? base.context_window,
    native_tool_calling: override.native_tool_calling ?? base.native_tool_calling,
    preferred_format: override.preferred_format ?? base.preferred_format,
    known_quirks: override.known_quirks
      ? Array.from(new Set([...base.known_quirks, ...override.known_quirks]))
      : base.known_quirks,
    recommended_harness: {
      enable_small_model_harness:
        override.recommended_harness?.enable_small_model_harness ??
        base.recommended_harness.enable_small_model_harness,
      max_turns:
        override.recommended_harness?.max_turns ?? base.recommended_harness.max_turns,
      max_tool_calls:
        override.recommended_harness?.max_tool_calls ??
        base.recommended_harness.max_tool_calls,
      inject_format_reminder_every_turn:
        override.recommended_harness?.inject_format_reminder_every_turn ??
        base.recommended_harness.inject_format_reminder_every_turn,
    },
  };
}

/**
 * Module-level state for F-09 deduplication. Records normalized IDs we've
 * already warned about so the warning fires at most once per session per
 * unknown model. Suppressed entirely when an override is set for the model.
 */
const warnedUnknownModels = new Set<string>();

function maybeWarnUnknown(normalizedId: string, hasOverride: boolean): void {
  if (hasOverride) return; // user has explicitly configured this model
  if (warnedUnknownModels.has(normalizedId)) return;
  warnedUnknownModels.add(normalizedId);
  // Exact text required by requirements F-09:
  console.error(
    `[INFO] Unknown model '${normalizedId}'; using safe defaults. ` +
      `See https://github.com/dugleelabs/copair/blob/main/docs/model-capabilities.md ` +
      `to contribute an entry.`,
  );
}

/** Internal — reset the F-09 dedupe set. Test-only export. */
export function _resetCapabilitiesWarningCacheForTests(): void {
  warnedUnknownModels.clear();
}

// ── Config access ──────────────────────────────────────────────────────────

/**
 * Per-process pointer to the loaded config's `model_overrides` map. Set by
 * the config loader via `setModelOverrides`; defaults to empty until the
 * config layer wires it up (T-A06 / T-A07). This indirection avoids
 * `model-capabilities.ts` taking a hard dependency on the config module's
 * shape — the config loader pushes overrides in, this module reads them out.
 */
let _modelOverrides: Record<string, ModelOverride> = {};

/**
 * Replace the active `model_overrides` map. Called by the config loader
 * after parsing + normalizing the user's config. Keys must already be
 * normalized (use `normalizeModelId`) before passing.
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
 *   3. Look up the registry; fall back to `{ tier, ...SAFE_DEFAULTS }` on miss
 *   4. Deep-merge any user `model_overrides[normalizedId]` on top
 *
 * Never throws. Empty / null / undefined `modelId` resolves to the same safe
 * defaults as an unknown ID.
 *
 * Side effect: on a registry miss with no user override, emits a one-time
 * `[INFO]` warning per F-09.
 */
export function getCapabilities(modelId: string | null | undefined): ModelCapabilities {
  const normalized = normalizeModelId(modelId ?? '');
  const { tier } = classifyModel(modelId ?? '');
  const match = matchRegistry(normalized);
  const base: ModelCapabilities = match ? match.capabilities : { tier, ...SAFE_DEFAULTS };
  const override = _modelOverrides[normalized];
  if (!match) {
    maybeWarnUnknown(normalized, override !== undefined);
  }
  return override ? deepMerge(base, override) : base;
}

// ── Diagnostic API (for --explain-model) ───────────────────────────────────

export interface ResolvedCapabilities {
  modelId: string;
  normalizedId: string;
  matchedEntry: { family: string; pattern: string } | null;
  baseCapabilities: ModelCapabilities;
  overrideApplied: ModelOverride | null;
  finalCapabilities: ModelCapabilities;
}

/**
 * Return the full resolution trace for a model ID. Used by the
 * `--explain-model` CLI flag to surface registry decisions for debugging.
 *
 * Unlike `getCapabilities`, this does NOT emit the F-09 warning — it's a
 * diagnostic-only read path, not a production lookup.
 */
export function explainCapabilities(modelId: string): ResolvedCapabilities {
  const normalized = normalizeModelId(modelId ?? '');
  const { tier } = classifyModel(modelId ?? '');
  const match = matchRegistry(normalized);
  const base: ModelCapabilities = match ? match.capabilities : { tier, ...SAFE_DEFAULTS };
  const override = _modelOverrides[normalized] ?? null;
  const final = override ? deepMerge(base, override) : base;
  return {
    modelId,
    normalizedId: normalized,
    matchedEntry: match ? { family: match.family, pattern: match.patternSource } : null,
    baseCapabilities: base,
    overrideApplied: override,
    finalCapabilities: final,
  };
}

// ── Re-exports for downstream consumers ────────────────────────────────────

export { classifyModel, normalizeModelId };
export type { ModelTier };
