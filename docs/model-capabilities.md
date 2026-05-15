# Model Capabilities

Copair needs to know things about each model: how much context it accepts, how many output tokens it can produce, whether its native tool calling is reliable, which prompt format it prefers, whether the small-model harness should engage. This doc explains how copair resolves those values — and how you override them when copair is wrong.

## The short version

For every model ID you point copair at, `getCapabilities(modelId)` returns a record like:

```yaml
tier:                          large
context_window:                200000
max_tokens:                    32000
native_tool_calling:           reliable
preferred_format:              native
recommended_harness:
  enable_small_model_harness:  false
  max_turns:                   20
  max_tool_calls:              (falls through to global)
  inject_format_reminder_every_turn: false
```

Most of those values are **derived from generic logic** — copair doesn't carry a per-model table in code. A few values come from a sparse JSON data file shipped with copair. You can override anything via your config.

Run `copair --explain-model <id>` to see exactly where each value came from.

## How values are resolved

Resolution happens in layers. Later layers win:

| Layer | What it provides | Source |
|:---|:---|:---|
| 1. Safe defaults | Conservative fallbacks (context 32k, output 4k, no harness) | `SAFE_DEFAULTS` in `src/core/model-capabilities.ts` |
| 2. Tier classifier | `tier: 'small' \| 'large'` based on model size | Family-prefix regex rules in `src/core/model-tiers.ts` (spec 028 F-24) |
| 3. Family-prefix routing | `preferred_format` and tier-driven `recommended_harness` | Generic startsWith function — Qwen → `qwen-xml`, DeepSeek → `dsml`, Claude/GPT/Gemini → `native`, else → `fenced-block` |
| 4. **Shipped data** | Per-family `context_window` / `max_tokens` / `native_tool_calling` values | `data/model-capabilities.json` |
| 5. **User overrides** | Anything you set per-model in your config | `model_overrides` in `~/.copair/config.yaml` |

Each layer is a deep-merge. Override `max_tokens` for one model? You only need to set that one field — everything else falls through.

## What `--explain-model` shows you

```sh
$ copair --explain-model claude-opus-4-7
Model ID:           claude-opus-4-7
Normalized ID:      claude-opus-4-7

Tier:               large  (source: classifier)
Preferred format:   native  (source: family-prefix)
Context window:     200000
Max output tokens:  32000
Native tool calls:  reliable

Shipped data match: Anthropic Claude Opus (modern)  (pattern: /^claude-opus/)

Recommended harness:
  enable_small_model_harness:        false
  max_turns:                         20
  max_tool_calls:                    (falls through to config.small_models.max_tool_calls)
  inject_format_reminder_every_turn: false

User override applied: none
```

`source` annotations show where the value came from: `classifier`, `family-prefix`, `shipped-data`, or `override`. `--json` outputs the same data as a single JSON line for scripting.

## When to use `model_overrides`

You should write a `model_overrides` entry when:

- **Copair doesn't recognize your model.** A new fine-tune, a custom-named SKU, a private endpoint with a non-standard ID. Without an override, you get safe defaults (32k context, 4k output, no harness) which are usually too conservative.
- **Copair recognizes the model but a value is wrong.** Maybe Anthropic raised Claude's output limit and the shipped data is stale.
- **You want to force a particular formatter or harness flag.** Even when copair's defaults are right, sometimes you want to test alternatives.

### Override syntax

Add a top-level `model_overrides` key to your `~/.copair/config.yaml`:

```yaml
model_overrides:
  # Key: the model ID as you use it. Copair normalises before matching, so
  # Bedrock-prefixed and Ollama-style IDs both resolve correctly.
  qwen.qwen3-coder-480b-a35b-v1:0:
    context_window: 262144
    max_tokens: 32000
    native_tool_calling: unreliable
    preferred_format: qwen-xml
    recommended_harness:
      enable_small_model_harness: true
      max_turns: 50
      inject_format_reminder_every_turn: true

  # All fields are optional. Override only what you need.
  claude-opus-4-7:
    max_tokens: 200      # cap output for cost-sensitive workflows

  # User overrides win over both shipped data and the tier classifier.
  my-custom-finetune:
    tier: small          # forces harness engagement
    preferred_format: qwen-xml
```

### Key normalization — what works cross-host

Copair normalizes override keys at config-load. **Same SKU on different hosts works automatically:**

| You write | Copair normalizes to | Matches at runtime when copair sees |
|:---|:---|:---|
| `qwen.qwen3-coder-480b-a35b-v1:0` (Bedrock) | `qwen3-coder-480b-a35b-v1-0` | `qwen3-coder:480b-a35b-v1:0` (Ollama) ✓ |
| `Qwen/Qwen3-Coder-480B-A35B-Instruct` (HF Together) | `qwen3-coder-480b-a35b-instruct` | Different SKU suffix — different normalized form ✗ |

**Honest limitation:** cross-SKU is an exact match. A Bedrock SKU ending in `-v1:0` doesn't match a Together SKU ending in `-instruct`, even though they're conceptually the same model. If you switch hosts and the SKU suffix differs, you'll need a second entry — or use a less specific key that catches both.

## Backwards compatibility with `tier_overrides`

If you have entries under `small_models.tier_overrides` from before spec 029, they continue to work unchanged:

```yaml
small_models:
  tier_overrides:
    my-finetune: small         # still works
  max_tool_calls: 50           # still respected as global default
```

At config-load, `tier_overrides` entries are folded into `model_overrides`. If both fields are set for the same model with conflicting values, **`model_overrides` wins** (newer, more expressive field).

## The shipped data file

`data/model-capabilities.json` ships with copair. It contains ~60 entries covering most popular model families:

- Frontier cloud: Claude (Opus/Sonnet/Haiku/3.x), GPT (5/5-mini/4o/4/o-series), Gemini (2.x/2.5+), Grok, Kimi K2, MiniMax
- Frontier open-weight: Qwen3-Coder 480B / 30B / Next, Qwen3 235B / Max, DeepSeek V3.x / R1, Llama 4 Scout/Maverick, Llama 3.x 70B+, Codestral, Magistral, Mistral Large, Mixtral, GLM 4.5+, gpt-oss, AI21 Jamba, Amazon Nova Pro, Cohere Aya Expanse
- Small open-weight: Qwen 7B/14B, Qwen3 small, DeepSeek small variants, Llama 3.x small, Phi-3/4, Gemma 2/3, Mistral Nemo, Ministral, GLM-4 9B, Granite, Nemotron, Yi-Coder, Reka, BigCode StarCoder2

Each entry is a regex pattern + a partial capabilities record. Entries ship only the fields that meaningfully differ from `SAFE_DEFAULTS` — typically `context_window`, `max_tokens`, and `native_tool_calling: 'reliable'` for frontier-cloud.

**This is not a comprehensive registry.** Copair deliberately doesn't try to know about every model on the planet. Instead:
- Common families get sensible defaults so most users don't need to touch their config
- Anything specific or new lives in *your* `model_overrides`
- Adding a model to the shipped JSON is a one-line PR — open one if you want a model upstreamed

### Why JSON, not TypeScript

Per [`feedback_no_per_model_code.md`](../README.md), copair deliberately avoids per-model code branches. The reasoning:

> Every new model = TypeScript PR with review, test, compile. Generic protocol-level logic scales; per-model code doesn't.

JSON keeps the data layer separate from the logic layer. Adding a new family is a JSON edit; updating context windows when Anthropic raises Claude's limit is a JSON edit. No TypeScript review required.

## How harness defaults are derived

`recommended_harness` is **tier-driven**, not per-model:

| Tier | enable_small_model_harness | max_turns | max_tool_calls | inject_format_reminder_every_turn |
|:---|:---:|:---:|:---:|:---:|
| `small` | true | 30 | (falls through) | true |
| `large` | false | 20 | (falls through) | false |

User overrides flip individual fields. If you set `tier: 'small'` for a model the classifier sees as `large`, the harness engages with small-tier defaults automatically — you don't need to also set `enable_small_model_harness: true`.

### `max_tool_calls` resolution chain

`max_tool_calls` resolution is a 4-layer fallback, in order:

1. `model_overrides[id].recommended_harness.max_tool_calls` (per-model override)
2. Shipped data's `recommended_harness.max_tool_calls` (currently always undefined)
3. `config.small_models.max_tool_calls` (global; spec 028 backwards-compat)
4. Hardcoded fallback: 20

This means setting `small_models.max_tool_calls: 50` globally keeps working as you'd expect — the tier-derived default doesn't shadow it.

## Why the shipped data is conservative

Where exact context windows or output limits are uncertain, the shipped data uses **smaller values** by design. Reasons:

- Claiming more than the model actually supports gets you silent truncation or API errors at the worst moment
- Most providers have multiple SKUs of the same family with different limits; conservative covers all of them
- Stale-and-conservative is better than stale-and-aggressive

When the actual limit is higher than what copair ships, your user config overrides — and you've made an explicit decision rather than relying on stale defaults.

## Schema evolution

`ModelCapabilities` is intentionally additive-compatible. Future additions to the schema must be:

- Optional with a documented default value (so existing configs keep parsing), **or**
- Gated behind a schema-version bump with a migration path

Removing or renaming fields is a breaking change requiring a major version bump and a deprecation overlap.

## See also

- [`configuration.md`](./configuration.md) — full copair config schema
- [`local-models.md`](./local-models.md) — running open-weight models locally
- Spec 029 — [`copair-model-capabilities-registry`](https://github.com/dugleelabs/copair) for the design rationale (private repo)
