/**
 * Model tier classifier (F-24).
 *
 * Decides whether the small-model harness should engage for a given model ID.
 * Tier is binary: 'small' (harness on) or 'large' (harness off). The harness
 * has no mid-tier dispatch, so any "mid" model folds into one of the two.
 *
 * Classification operates on the canonical model identity, not on the alias
 * substring. The same model is hosted across many platforms with different ID
 * conventions (Bedrock `qwen.qwen3-coder-480b-a35b-v1:0`, OpenRouter
 * `qwen/qwen3-coder-480b`, Ollama `qwen3-coder:480b`, Together `Qwen/...`).
 * `normalizeModelId()` collapses these into one form before regex matching.
 *
 * Spec 029 F-11 (strict unknowns) reshapes the result: an unmatched ID returns
 * `{ tier: null, family: 'unknown', matched: null }` instead of defaulting to
 * `large`. `classifyModel` itself remains infallible — callers decide what to
 * do with the null sentinel. `getCapabilities` enforces strictness by throwing
 * `UnknownModelError` unless the user supplied a `model_overrides` entry or a
 * shipped-data row claims the ID.
 */

export type ModelTier = 'small' | 'large';

/**
 * Result of classifying a model ID. Discriminated union: a successful match
 * carries a non-null `tier`, `family`, and `matched` regex source. An
 * unmatched ID carries `tier: null`, `family: 'unknown'`, `matched: null`.
 *
 * ⚠ Breaking type change (spec 029 F-11, 2026-05-18). Previously `tier` was
 * always `'small' | 'large'` (large was the unknown default). External
 * callers that destructure `tier` as non-null break at compile time. No
 * external callers known today; flagged in spec 029 CHANGELOG.
 */
export type ClassificationResult =
  | { tier: ModelTier; family: string; matched: string }
  | { tier: null; family: 'unknown'; matched: null };

interface TierRule {
  pattern: RegExp;
  tier: ModelTier;
  family?: string;
}

/**
 * Normalize a model ID across hosting platforms so a single regex per family
 * matches all variants. All `.`, `_`, `:`, `/`, `@` collapse to `-`, so
 * regex rules below should match the dash-separated form (no dots in patterns).
 *
 * Examples:
 *   "qwen.qwen3-coder-480b-a35b-v1:0"           → "qwen3-coder-480b-a35b-v1-0"
 *   "Qwen/Qwen3-Coder-480B-A35B-Instruct"       → "qwen3-coder-480b-a35b-instruct"
 *   "us.anthropic.claude-sonnet-4-6-20260201"   → "claude-sonnet-4-6-20260201"
 *   "anthropic/claude-sonnet-4-6"               → "claude-sonnet-4-6"
 *   "qwen3-coder:30b-a3b-q4_0"                  → "qwen3-coder-30b-a3b-q4-0"
 *   "qwen2.5-coder:7b"                          → "qwen2-5-coder-7b"
 *   "llama-3.1-405b"                            → "llama-3-1-405b"
 */
export function normalizeModelId(id: string): string {
  return id
    .toLowerCase()
    // Bedrock regional prefix (us. eu. ap. ca. sa. me. af.)
    .replace(/^(?:us|eu|ap|ca|sa|me|af)\./, '')
    // Bedrock vendor prefix
    .replace(
      /^(?:anthropic|amazon|cohere|meta|mistral(?:-?ai)?|ai21|stability|writer|qwen|deepseek|moonshot(?:ai)?|openai|microsoft|google|gemini|nvidia|reka|01-ai|zai(?:-org)?|minimax(?:ai)?|ibm-granite|granite|tii|together|huggingface)\./,
      '',
    )
    // OpenRouter / Hugging Face `org/path/`
    .replace(/^(?:[a-z0-9_-]+\/)+/, '')
    // Delimiter unification: . _ : / @ → -
    .replace(/[._:/@]/g, '-')
    // Collapse repeated dashes
    .replace(/-{2,}/g, '-')
    // Trim leading/trailing dashes
    .replace(/^-+|-+$/g, '');
}

// Ordered MOST-SPECIFIC FIRST. First match wins. All patterns are written
// against the post-normalization form (dashes only, no dots).
const TIER_RULES: TierRule[] = [
  // ── Frontier proprietary ─────────────────────────────────────────
  { pattern: /^claude-/, tier: 'large', family: 'Claude' },
  { pattern: /^gpt-(?:3-5|4|5)/, tier: 'large', family: 'GPT' },
  { pattern: /^o[134](?:-mini|-pro)?\b/, tier: 'large', family: 'OpenAI o-series' },
  { pattern: /^gemini-[23]/, tier: 'large', family: 'Gemini' },
  { pattern: /^grok-[1-9]/, tier: 'large', family: 'Grok' },
  { pattern: /^kimi-k2/, tier: 'large', family: 'Kimi K2' },
  { pattern: /^minimax-m[1-9]/, tier: 'large', family: 'MiniMax' },

  // ── Cohere Command (large vs small split — small most specific first) ──
  { pattern: /^command-r7b/, tier: 'small', family: 'Command R7B' },
  { pattern: /^command-(?:a|r-plus)/, tier: 'large', family: 'Command A / R+' },
  { pattern: /^command-r/, tier: 'large', family: 'Command R' },
  { pattern: /^command(?!-)/, tier: 'large', family: 'Command' },

  // ── GLM (small most specific first to avoid `4-9` collision) ─────
  { pattern: /^glm-4-9b/, tier: 'small', family: 'GLM-4 9B' },
  { pattern: /^glm-(?:[5-9]|4-[5-9])/, tier: 'large', family: 'GLM 4.5+' },

  // ── Mistral & relatives ──────────────────────────────────────────
  { pattern: /^(?:mistral|pixtral)-large/, tier: 'large', family: 'Mistral/Pixtral Large' },
  { pattern: /^magistral-medium/, tier: 'large', family: 'Magistral Medium' },
  { pattern: /^mistral-medium/, tier: 'large', family: 'Mistral Medium' },
  { pattern: /^mistral-small-[34]/, tier: 'large', family: 'Mistral Small 3+' },
  { pattern: /^codestral/, tier: 'large', family: 'Codestral' },
  { pattern: /^mixtral-8x(?:7|22)b/, tier: 'large', family: 'Mixtral' },
  { pattern: /^magistral-small/, tier: 'large', family: 'Magistral Small' },
  { pattern: /^mistral-7b/, tier: 'small', family: 'Mistral 7B' },
  { pattern: /^mistral-nemo/, tier: 'small', family: 'Mistral Nemo 12B' },
  { pattern: /^ministral-(?:3|7|14)b/, tier: 'small', family: 'Ministral' },

  // ── Qwen (most-specific large patterns first) ────────────────────
  { pattern: /^qwen3-coder-480b/, tier: 'large', family: 'Qwen3-Coder 480B' },
  { pattern: /^qwen3-(?:vl-)?235b/, tier: 'large', family: 'Qwen3 235B' },
  { pattern: /^qwen-?max/, tier: 'large', family: 'Qwen-Max' },
  { pattern: /^qwen3-next-80b/, tier: 'large', family: 'Qwen3-Next 80B' },
  { pattern: /^qwen3-coder-30b/, tier: 'large', family: 'Qwen3-Coder 30B' },
  { pattern: /^qwen3-(?:vl-)?(?:30b-a3b|32b)/, tier: 'large', family: 'Qwen3 32B/30B' },
  { pattern: /^qwen2(?:-5)?-(?:coder-)?(?:32b|72b)/, tier: 'large', family: 'Qwen 32B/72B' },
  { pattern: /^qwen3-5-(?:122b|35b)/, tier: 'large', family: 'Qwen3.5 mid' },
  { pattern: /^qwen-plus/, tier: 'large', family: 'Qwen-Plus' },
  { pattern: /^qwen-turbo/, tier: 'small', family: 'Qwen-Turbo' },
  { pattern: /^qwen3-(?:vl-)?(?:0-6|1-7|4|8|14)b/, tier: 'small', family: 'Qwen3 small' },
  { pattern: /^qwen2(?:-5)?-(?:coder-)?(?:0-5|1-5|3|7|14)b/, tier: 'small', family: 'Qwen 0.5–14B' },

  // ── Llama (use `(?:-\d+)*` to skip variable-length version segments) ──
  { pattern: /^llama-?[34](?:-\d+)*-405b/, tier: 'large', family: 'Llama 405B' },
  { pattern: /^llama-?4-(?:maverick|behemoth|scout)/, tier: 'large', family: 'Llama 4 family' },
  { pattern: /^llama-?[34](?:-\d+)*-(?:70b|72b|90b)/, tier: 'large', family: 'Llama 70B class' },
  { pattern: /^llama-?[34](?:-\d+)*-(?:1b|3b|7b|8b|11b)/, tier: 'small', family: 'Llama small' },

  // ── DeepSeek ─────────────────────────────────────────────────────
  { pattern: /^deepseek-(?:v[34]|r[12])(?!.*-distill)/, tier: 'large', family: 'DeepSeek frontier' },
  { pattern: /^deepseek-(?:chat|reasoner)/, tier: 'large', family: 'DeepSeek API alias' },
  { pattern: /^deepseek-r1.*?-(?:1-5|7|8)b/, tier: 'small', family: 'DeepSeek R1 distill ≤8B' },
  { pattern: /^deepseek-r1.*?-(?:14|32|70)b/, tier: 'large', family: 'DeepSeek R1 distill ≥14B' },
  { pattern: /^deepseek-coder-1-3b/, tier: 'small', family: 'DeepSeek Coder 1.3B' },

  // ── Phi (small suffixes first; phi-4 bare = 14B = large) ─────────
  { pattern: /^phi-?3(?:-5)?-(?:mini|small|vision)/, tier: 'small', family: 'Phi-3 small' },
  { pattern: /^phi-?4-(?:mini|multimodal)/, tier: 'small', family: 'Phi-4 small' },
  { pattern: /^phi-?3(?:-5)?-(?:medium|moe)/, tier: 'large', family: 'Phi-3 mid+' },
  { pattern: /^phi-?4(?:-14b)?\b/, tier: 'large', family: 'Phi-4 14B' },

  // ── Gemma ────────────────────────────────────────────────────────
  { pattern: /^gemma-?[234]-?(?:9|12|26|27|31)b/, tier: 'large', family: 'Gemma 9B+' },
  { pattern: /^gemma-?[234]-?(?:270m|1b|2b|4b|e2b|e4b)/, tier: 'small', family: 'Gemma small' },

  // ── IBM Granite ──────────────────────────────────────────────────
  { pattern: /^granite-?[34](?:-\d+)*-30b/, tier: 'large', family: 'Granite 30B' },
  { pattern: /^granite-?[34](?:-\d+)*-(?:2|3|8)b/, tier: 'small', family: 'Granite small' },

  // ── NVIDIA Nemotron ──────────────────────────────────────────────
  {
    pattern: /^(?:llama-?[34](?:-\d+)*-)?nemotron-?(?:ultra|3-ultra|253b|super|49b|70b|3-super|120b)/,
    tier: 'large',
    family: 'Nemotron mid+',
  },
  {
    pattern: /^(?:llama-?[34](?:-\d+)*-)?nemotron-?(?:nano|8b|3-nano)/,
    tier: 'small',
    family: 'Nemotron Nano',
  },

  // ── AI21 Jamba ───────────────────────────────────────────────────
  { pattern: /^jamba-?(?:large|2-?large|mini|2-?mini)/, tier: 'large', family: 'Jamba Large/Mini' },
  { pattern: /^jamba-?(?:reasoning-?3b|2-?3b)/, tier: 'small', family: 'Jamba 3B' },

  // ── Reka ─────────────────────────────────────────────────────────
  { pattern: /^reka-(?:core|flash)/, tier: 'large', family: 'Reka Core/Flash' },
  { pattern: /^reka-edge/, tier: 'small', family: 'Reka Edge' },

  // ── Amazon Nova ──────────────────────────────────────────────────
  { pattern: /^nova-(?:pro|premier|lite)/, tier: 'large', family: 'Nova Pro/Premier/Lite' },
  { pattern: /^nova-micro/, tier: 'small', family: 'Nova Micro' },

  // ── Yi (01.AI) ───────────────────────────────────────────────────
  { pattern: /^yi-(?:large|lightning|1-5-?34b)/, tier: 'large', family: 'Yi large/lightning/34B' },
  { pattern: /^yi-coder-(?:1-5|9)b/, tier: 'small', family: 'Yi-Coder small' },
  { pattern: /^yi-1-5-(?:6|9)b/, tier: 'small', family: 'Yi 1.5 small' },

  // ── TII Falcon ───────────────────────────────────────────────────
  { pattern: /^falcon-?(?:3|h1r|mamba)?-?(?:1|3|7|10)b/, tier: 'small', family: 'Falcon ≤10B' },

  // ── OpenAI open-weights ──────────────────────────────────────────
  { pattern: /^gpt-?oss-?(?:20|120)b/, tier: 'large', family: 'gpt-oss' },

  // ── Generic local-model heuristics (last resort) ─────────────────
  { pattern: /-(?:0-5|0-6|1|1-5|1-7|3|3-8|4|7|8)b\b/, tier: 'small', family: 'generic ≤8B' },
  {
    pattern: /-(?:13|14|22|27|30|32|34|49|65|70|72|80|90|120|180|235|405|480|671)b\b/,
    tier: 'large',
    family: 'generic ≥13B',
  },
];

/**
 * Lowercased, deduped list of family names from TIER_RULES. Used by spec 029
 * F-11's did-you-mean candidate set (see `suggestDidYouMean` in
 * model-capabilities.ts). Excludes the generic-size catch-all rules whose
 * family labels are not meaningful suggestions for users.
 */
export const TIER_RULE_FAMILIES: string[] = (() => {
  const seen = new Set<string>();
  for (const rule of TIER_RULES) {
    if (!rule.family) continue;
    if (rule.family.startsWith('generic')) continue;
    seen.add(rule.family.toLowerCase());
  }
  return [...seen];
})();

/**
 * Raw regex pattern sources from TIER_RULES, excluding generic-size
 * catch-all rules. Consumed by spec 029 F-11's `suggestDidYouMean` which
 * expands each into typeable model-ID stems for did-you-mean suggestions.
 */
export const TIER_RULE_PATTERN_SOURCES: string[] = (() => {
  return TIER_RULES.filter((r) => !r.family?.startsWith('generic')).map(
    (r) => r.pattern.source,
  );
})();

/**
 * Classify a model ID into a tier (small or large).
 *
 * Resolution order:
 *   1. Per-model override from config (`tier_overrides[modelId]`)
 *   2. Built-in rule list against the normalized model ID
 *   3. Sentinel `{ tier: null, family: 'unknown', matched: null }` — callers
 *      (notably `getCapabilities` per spec 029 F-11) decide whether to error
 *      or fall through to user-supplied overrides / shipped data.
 *
 * Stays infallible by design: non-CLI callers (tests, telemetry) depend on
 * being able to ask the classifier about any string without try/catch.
 */
export function classifyModel(
  modelId: string,
  overrides?: Record<string, ModelTier>,
): ClassificationResult {
  if (overrides?.[modelId]) {
    return { tier: overrides[modelId], family: 'override', matched: 'override' };
  }
  const normalized = normalizeModelId(modelId);
  for (const rule of TIER_RULES) {
    if (rule.pattern.test(normalized)) {
      return {
        tier: rule.tier,
        family: rule.family ?? 'unknown',
        matched: rule.pattern.source,
      };
    }
  }
  return { tier: null, family: 'unknown', matched: null };
}
