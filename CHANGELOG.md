# Changelog

All notable changes to copair are documented here.

## [Unreleased] — Model Capabilities Registry + small-model harness hardening (spec 029)

A single contract — `getCapabilities(modelId)` — replaces ad-hoc per-model substring matches across the codebase. Future Pillar 1 features consult this contract instead of writing `if (modelId.includes('qwen'))` style branches. The reframe established a durable principle: **generic protocol-level logic in code, sparse per-model data in JSON, resilient parsers handle drift on the fly, user `model_overrides` config as the escape hatch.**

The release bundles the foundation (Phases A–D) with five small-model harness improvements (Phases F–J): strict handling of unknown models, a ≤22B-is-small reclassification, a result-aware tool-call loop guard, a tool-call format-error repair loop, and an inspect-before-act prompt rule plus tool-aware output-overflow handling.

### ⚠ Behavior change — unknown models now require a `tier` (F-11)

Previously, a model ID that matched no built-in classifier rule silently fell back to **large**-tier defaults (harness off, 32k/4k safe context). As of this release, an unknown model raises `UnknownModelError` at startup instead of guessing. **If you run a model whose family isn't in copair's shipped rules, add a `model_overrides` entry with at least a `tier`:**

```yaml
model_overrides:
  my-custom-model:
    tier: small   # or large
```

This is a deliberate trade — silently guessing `large` for an unknown small model engaged the wrong harness behavior and burned tokens. Shipped as a **minor** bump (the old silent-large was wrong behavior, not a supported contract); the fix is loud so you can correct config in one line. See `docs/local-models.md` and `docs/model-capabilities.md`.

### Added

- **`ModelCapabilities` contract + `getCapabilities(modelId)` lookup API** — `src/core/model-capabilities.ts` defines a Zod-validated record with `tier`, `context_window`, `max_tokens`, `native_tool_calling`, `preferred_format`, and `recommended_harness` fields. The lookup pipeline is purely generic: normalize the model ID (spec 028 F-24's `normalizeModelId`) → derive tier via `classifyModel` → derive `preferred_format` via family-prefix function (Qwen → `qwen-xml`, DeepSeek → `dsml`, Claude/GPT/Gemini → `native`, else → `fenced-block`) → derive `recommended_harness` from tier → layer shipped JSON data → layer user `model_overrides`. Each step is documented and inspectable. Never throws; null/undefined/empty model IDs resolve to safe defaults.

- **Sparse `data/model-capabilities.json` shipped with copair** — ~60 family-prefix entries covering frontier cloud (Claude, GPT, Gemini, Grok, Kimi K2, MiniMax, etc.), frontier open-weight (Qwen3-Coder 480B/30B/Next, Qwen3-Max, DeepSeek V3.x/R1, Llama 4 Scout/Maverick, Codestral, Magistral, Mistral Large, Mixtral, GLM 4.5+, gpt-oss, AI21 Jamba, Amazon Nova Pro, Cohere Aya Expanse, BigCode StarCoder2), and small open-weight (Qwen 7B/14B, Qwen3 small, Llama 3.x small, Phi-3/4, Gemma 2/3, Mistral Nemo, Ministral, GLM-4 9B, Granite, Nemotron, Yi-Coder, Reka). Each entry ships only the fields that meaningfully differ from safe defaults — typically `context_window`, `max_tokens`, and `native_tool_calling: 'reliable'` for frontier-cloud. Adding a new model family is a one-line JSON PR with no TypeScript review required. Values are conservative when uncertain — never claim more than the model actually supports.

- **`model_overrides` config field** — Top-level optional field in `~/.copair/config.yaml`. Deep-partial entries deep-merge over base capabilities; users override any field per-model. Keys normalized at config-load via `normalizeModelId` so the same SKU on different hosts resolves correctly without separate entries. See `docs/model-capabilities.md` for full syntax + examples.

- **`--explain-model <id>` CLI flag** — Resolves capabilities for any model ID and prints the trace (or `--json` for a single-line ResolvedCapabilities-shape JSON). Short-circuits before agent-loop init; no provider auth needed; loads config so user overrides are reflected. Output annotates the *source* of each field (`classifier`, `family-prefix`, `shipped-data`, `override`) so users can debug "why did copair pick X for my model?" without grepping source.

- **`docs/model-capabilities.md` user guide** — Covers how `getCapabilities` resolves values (5-layer table), when to write `model_overrides`, override syntax with examples, honest cross-host vs cross-SKU limitations, `tier_overrides` backwards-compat, the shipped data file with "this is not a comprehensive registry" framing, schema-evolution contract.

- **Result-aware tool-call loop guard (F-13, Phase H)** — `src/core/loop-guard.ts` detects when the model re-issues an identical `(tool, args, result)` tuple. On the 2nd identical tuple it injects a `[SYSTEM]` nudge ("try a different approach or call task_complete"); on the 3rd it halts the turn with a synthetic tool result and returns partial output instead of looping forever. Bounded memory (deque of 3), per-turn reset, keys canonicalized so `{a:1,b:2}` and `{b:2,a:1}` hash identically. Surfaced via `Renderer.showLoopNudge` / `showLoopHalt` (spec 040 hook points).

- **Tool-call format-error repair loop (F-14, Phase I)** — When a small model emits malformed tool-call markup (invalid JSON, missing `name`, unclosed tag), copair now diagnoses the specific failure and asks the model to retry with a structured `[SYSTEM]` repair message + a correct example, instead of silently dropping the call. Each built-in formatter (qwen-xml, dsml, fenced-block) gains a non-throwing `parseStrict` returning a typed `ParseError`; third-party formatters degrade gracefully via `parseWithStrictFallback`. Capped at 2 retries per turn (small-tier only — large models with reliable native tool calling keep the legacy path). Surfaced via `Renderer.showFormatRepair` / `showFormatRepairExhausted` (spec 040 hook points).

- **Inspect-before-act prompt rule (F-15a, Phase J)** — A 5th rule added to the small-model system prompt: "Before editing a file, read it first. Before calling a tool with a path, id, or name, verify it exists via list/search. Never invent identifiers."

- **Tool-aware output-overflow handling (F-15b, Phase J)** — Per-tool strategies matched to each tool's semantics instead of one blunt truncator:
  - `bash`: head+tail truncation (`truncateMiddle`) on both success and failure paths, stdout/stderr independently, each with a `[stdout]`/`[stderr]` label and a recovery hint (`head`/`tail`/`sed`/`grep`). Default 4000-token budget.
  - `read`: refuses a >1500-line file when no `limit` is passed, returning a structured `[overflow]` error asking the model to chunk — never silent partial content. Explicit `limit` is always honored.
  - `grep`: detects overflow via `-m (max+1)` and appends an `[overflow]` tail message; result stays non-error since a capped set is still actionable. Default 50 results.
  - Per-tool thresholds are tunable via the new `tools.{read,bash,grep}` config section. Tools surface declarative events dispatched to `Renderer.showBashTruncated` / `showReadOverflow` / `showGrepOverflow` (spec 040 hook points).

### Changed

- **`resolveFormatter` consumes `getCapabilities`** — `src/core/formats/index.ts` no longer substring-matches `modelId.includes('qwen')` etc. The family-prefix routing lives in `resolvePreferredFormat` inside the capabilities module — one source of truth. `'native'` (frontier cloud) falls back to `fenced-block` inside the text-extraction path (native tool calling goes through provider SDKs, not text formatters).

- **`SmallModelHarness` reads from `getCapabilities`** — `src/core/small-model-harness.ts` constructor now consults the capabilities lookup for `enable_small_model_harness` and other harness flags. The spec 028 `tier_overrides` config path is preserved as a backwards-compat fast-path for callers that don't route through the config loader (e.g. unit tests). Production paths route through `loadConfig` which folds `tier_overrides` into `model_overrides` automatically — both paths produce equivalent behavior.

- **`max_tool_calls` resolution chain** — Now a four-layer fallback: `model_overrides[id].recommended_harness.max_tool_calls` → shipped-data tier-derived value (currently always undefined, so fall-through) → `config.small_models.max_tool_calls` (spec 028 global, preserved) → hardcoded 20. Critical: tier-derived default is `undefined` (not `20`) so users who set `config.small_models.max_tool_calls: N` globally keep seeing N apply — setting it to 20 would have silently shadowed the global.

- **Spec 028 F-23 Hermes envelope fallback reframed as always-on resilient parsing** — `src/core/formats/qwen-xml.ts` Hermes envelope fallback was already unconditional in code (good); only the framing changed. JSDoc reframes it as a property of the *format* ("the qwen-xml format permits two output shapes — clean JSON or Hermes envelope; the parser tries JSON first and falls back to the envelope on parse failure"), not a Qwen3-Coder-specific bug. Any model whose output uses qwen-xml format gets the resilient parser. This is the reference pattern for future format-drift work: solve generically, not per-model.

- **Unknown-model classification is now strict (F-11, Phase F)** — `classifyModel` returns `{ tier: null, family: 'unknown', matched: null }` for IDs that match no rule (instead of defaulting to `large`). `classifyModel` itself stays infallible; `getCapabilities` enforces strictness by throwing `UnknownModelError` unless a `model_overrides` entry or shipped-data row claims the ID. See the behavior-change callout at the top of this entry. *Type note:* `ClassificationResult.tier` widened from `'small' | 'large'` to `'small' | 'large' | null` — any external caller destructuring it as non-null would break at compile time (no external callers known today).

- **≤22B models reclassified as small (F-12, Phase G)** — The tier boundary is now an explicit "≤22B ⇒ small (needs the harness)" proxy. Models at the boundary moved from `large` to `small`: Mistral-Small 3 (22B), DeepSeek-R1 distill 14B, Phi-4 14B. The generic size-suffix catch-all rules were deleted — guessing tier by size without knowing the family conflicts with the strict-unknowns principle (F-11), so unmatched families now error rather than size-guess.

### Architecture

The full implementation was reframed mid-session from "ship a 50-100 entry TypeScript registry with `known_quirks` typed union" to "ship a contract + generic logic + sparse JSON + user escape hatch." The reframe principle now lives as a durable architectural rule:

> Generic protocol-level logic in code; per-model data in JSON config only when genuinely needed; resilient parsers handle drift on the fly; user `model_overrides` is the escape hatch for everything else. **Code never branches on specific model IDs.**

This deliberately limits the registry's growth surface — every per-model patch is a sustainability trap. Adding a model family is one JSON line. Adding a new quirk is reframing it as protocol resilience. Adding a custom fine-tune is a user-config override. The codebase carries zero per-model branches by design.

### Test coverage

- **900/900 tests passing** locally (was 757 pre-spec-029; +143 net across Phases A–J).
- **31-assertion parity test suite** (`tests/core/parity-spec-029.test.ts`) verifies every shipped formatter routing and harness engagement preserved across the subsumption refactor; Qwen3-Coder 480B Hermes regression check (spec 028 F-23) still passes.
- **6-case E2E tests** for `--explain-model` (`tests/e2e/explain-model.test.ts`) spawn the real built binary and validate output (pretty + JSON shape against ResolvedCapabilities Zod schema, cross-host normalization, missing arg → non-zero exit).
- **Harness hardening tests (Phases F–J):** strict-unknowns + reclassification (`tests/core/model-capabilities-strict.test.ts`, `model-tiers-reclassify.test.ts`); loop guard unit + agent integration (`tests/core/loop-guard.test.ts`, `tests/integration/agent-loop-guard.test.ts`); format-repair unit + integration (`tests/core/format-repair.test.ts`, 22 cases); overflow handling (`tests/tools/truncate.test.ts` + `tests/tools/overflow.test.ts`, 18 cases).
- **Perf benchmark** (`tests/perf/model-capabilities.bench.ts`) — vitest-bench, local-only (not CI-gated). Target <0.5ms median; actual ~1μs typical (claude-opus-4-7 mean 0.6μs, p99 1.3μs). **~500× faster than budget; no caching needed.**

---

## [Unreleased] — Workflow Engine Correctness and Documentation (spec 028 Phase C)

### Fixed

- **`on_max_iterations` uses configured step id (F-17)** — The workflow engine previously hardcoded `'report'` as the fallback step when a loop reached max iterations. It now reads `step.on_max_iterations` and looks up the configured step id in `stepsById`, so any step name can serve as the max-iterations handler.

- **`on_max_iterations` fires exactly once (F-18)** — When a loop exits early because `loop_until` is satisfied before max iterations, the `on_max_iterations` handler step was still being executed sequentially in the normal step flow. The engine now tracks whether the handler already fired (`onMaxFired`) and skips it if the loop exited cleanly, printing `[step N/total] stepId [skipped]` in the console. When the loop does reach max iterations, the handler fires exactly once and sequential flow resumes from the step after it.

- **Skipped-step rendering for condition jumps (F-19)** — `condition` steps that jump forward by more than one position now print `[step N/total] stepId [skipped]` for each intermediate step that was bypassed. Adjacent jumps and backward jumps are unaffected. This makes the full step sequence visible in the console regardless of which branch was taken.

- **qwen-xml formatter accepts Hermes envelope (F-23)** — Qwen3-Coder served via AWS Bedrock's OpenAI-compatible endpoint relapses from the prescribed JSON-in-tag tool-call format to its native Hermes function/parameter XML envelope (`<tool_call><function=NAME><parameter=KEY>VALUE</parameter></function></tool_call>`) after one successful round-trip. The previous parser called `JSON.parse` on the inner content, dropped Hermes calls silently, and froze the agent on an empty input prompt. `QwenXmlFormatter.parse()` now falls back to a Hermes envelope parser when JSON parsing fails, and `buildSystemPrompt()` includes an explicit anti-format rule to reduce relapse frequency. Verified against `qwen.qwen3-coder-480b-a35b-v1:0` on Bedrock `ap-south-1`.

- **Built-in model tier classifier (F-24)** — `SmallModelHarness` previously substring-matched the model ID against a six-entry default list (`['qwen', 'llama-3.1-8b', 'llama-3.2-1b', 'llama-3.2-3b', 'mistral-7b', 'phi-3', 'deepseek-coder-1.3b']`) to decide whether to engage. Substring matching is fundamentally broken for family-name substrings: `'qwen'` matched `qwen.qwen3-coder-480b-a35b-v1:0` (a 480B-parameter MoE coder), causing the agent to terminate via `task_complete` instead of producing analysis output and burn 220K input tokens per request on per-turn format-reminder noise. Replaced with a built-in model tier classifier (`src/core/model-tiers.ts`) operating on the canonical model identity. Tier is binary: `small` (harness on) or `large` (harness off). The classifier first normalizes the model ID across hosting platforms (strips Bedrock vendor and regional prefixes such as `qwen.`, `anthropic.`, `us.`, `eu.`; strips OpenRouter and Hugging Face `org/path/`; collapses delimiters), then walks an ordered rule list of regexes (most-specific first) to assign a tier. Coverage spans ~250 model variants across 22 provider families: Anthropic, OpenAI, Google Gemini and Gemma, Meta Llama 3/4, Alibaba Qwen 2.5/3 (including Coder, VL, Next), DeepSeek V3/V4/R1/R2 and distilled variants, Mistral (Large/Medium/Small/Mixtral/Codestral/Magistral/Pixtral/Ministral/Nemo), Microsoft Phi-3/3.5/4, xAI Grok 1–5, Amazon Nova, IBM Granite 3/4, NVIDIA Llama-Nemotron, Cohere Command, AI21 Jamba, Reka Core/Flash/Edge, Moonshot Kimi K2, Z.ai GLM 4.5+/5, MiniMax M1/M2, 01.AI Yi, TII Falcon, OpenAI gpt-oss. Default for unmatched IDs is `large` — the safer choice, since the harness is invasive and unknown frontier models shouldn't be crippled by it.

- **Streaming filter resets between agent loop iterations (F-25)** — `StreamingMarkupFilter` (`src/core/formats/index.ts`) carries three pieces of internal state (`buffer`, `suppressing`, `matchSeen`) intended to scope to one model response. The agent reused one filter instance across the entire session, so once any turn produced a `<tool_call>` block the `matchSeen` flag flipped to true permanently and every subsequent stream chunk was discarded by the `suppressAfterMatch` guard. Symptom: after F-23/F-24 enabled multi-turn Qwen-on-Bedrock sessions, the agent's final-turn analysis text (1454 output tokens of plain prose, `tool_calls: []` in the API debug log) silently dropped on the floor — the user saw an apparently-frozen UI on a blank input prompt. Added `StreamingMarkupFilter.reset()` and now call it at the top of each agent-loop iteration before `activeProvider.chat()`. The `suppressAfterMatch` semantics (originally designed to discard hallucinated trailing junk after `</tool_call>` within a single response) are preserved within each response.

### Changed (BREAKING)

- **`small_models.model_ids` config field removed (F-24)** — The substring-list field is replaced by per-model `small_models.tier_overrides: Record<string, 'small' | 'large'>`. Old configs with `model_ids` are silently dropped by Zod's default object behavior. The narrow population of users who customized the substring list should migrate to `tier_overrides` if they need to flag a custom fine-tune as small or opt a known-small model out of the harness. Most users never need this — automatic classification handles the common case.

### Added

- **Colored workflow step renderer (T-C12)** — Workflow output now uses a consistent visual format: a header line on workflow start (`Workflow  <name>  ·  N steps`), `▷ [N/total] id  badge  · attempt K/M` on step start, `✓ [N/total] id  badge  Xms` on completion, and `─ [N/total] id  [skipped]` for skipped steps. Type badges are color-coded: `sh` (blue), `ai` (magenta), `cmd` (cyan), `if` (yellow), `out` (dim).

- **`workflow:` frontmatter dispatch for command files (T-C13)** — A command `.md` file can now declare `workflow: <name>` in its frontmatter to run a named workflow as its primary action. If the command body is non-empty, it is sent to the model as a follow-up prompt after the workflow completes. Commands with only `workflow:` and no body act as pure workflow aliases.

- **Workflow reference documentation (F-20)** — `docs/workflows.md` now contains the full workflow reference: step-type field tables (`prompt`, `shell`, `command`, `condition`, `output`), the complete variable resolution order (`{{steps.id.field}}` → inputs/captures → context variables), loop-and-retry patterns with `max_iterations` + `loop_until` + `on_max_iterations`, the pre-push worked example with Mermaid flow diagram, step-by-step walkthrough of all execution paths, and the full annotated YAML. The corresponding page is live at [copair.dugleelabs.io/docs/workflows](https://copair.dugleelabs.io/docs/workflows).

---

## [Unreleased] — Small Model Harness and Command Adoption (spec 028 Phase B)

### Added

- **`SmallModelHarness` (F-08/F-12/F-15)** — New `SmallModelHarness` class auto-detects whether the active model is a small/local model by matching its ID against a default list (`qwen`, `llama-3.x`, `mistral-7b`, `phi-3`, `deepseek-coder-1.3b`) and can be forced on/off via `--small-model` / `--no-small-model` CLI flags or the new `small_models.model_ids` config block. When active, injects a 4-rule system prompt addition, a per-turn reminder, and per-turn tool-call format examples to improve instruction-following on resource-constrained models.

- **`ask_user` tool (F-09)** — Small models can now call `ask_user(question)` when they need clarification before proceeding. The tool call is intercepted in the agent (never reaches the executor), the question is written to stdout, the user's answer is read from tty, and the answer is fed back as a tool result. The tool is only advertised to small models; large models already handle ambiguity without it.

- **`task_complete` tool (F-10)** — Small models signal task completion by calling `task_complete(summary)` instead of relying on the host to infer termination. The agent intercepts the call, shows a green `✓ Task complete: …` message, stubs tool results for any co-batched calls, and breaks the turn loop cleanly. This removes the need for the host to guess when a small model has finished.

- **`UNCLEAR:` uncertainty signal (F-10)** — If a small model emits a line starting with `UNCLEAR: `, the agent picks it up after rendering and calls `renderer.showUnclearSignal()`, which displays a yellow `⚠ Model uncertainty: …` line. This surfaces model uncertainty explicitly rather than leaving the user to interpret a confused response.

- **Max-turn guard (F-11)** — A per-session tool-call counter now enforces `small_models.max_tool_calls` (default 20) for small models. On breach, a yellow warning is shown and the turn loop terminates, preventing infinite loops caused by small models repeatedly emitting malformed tool calls.

- **Per-turn tool-call format reinforcement (F-12)** — All `ToolCallFormatter` implementations (`qwen-xml`, `dsml`, `fenced-block`) now expose `exampleCall()` returning a minimal, self-contained tool call example. `SmallModelHarness.getFormatHint()` calls this to prepend a `Format reminder` to each user message turn, reducing format drift mid-session.

- **Sequential intake for slash commands (F-13)** — `CommandRegistry.dispatchWithIntake()` collects any missing *required* args via a tty `collector` callback before dispatching the command. This applies to all model sizes, so `feature_context` and similar required args are never left as unsubstituted `{{placeholders}}` in the rendered prompt.

- **`argument-hint` compatibility shim (F-14)** — Legacy commands using the old `argument-hint: <hint>` frontmatter now work without modification. The loader synthesizes a non-required `ArgDefinition` from the hint text so the command continues to function. Authors should migrate to the explicit `args:` contract (see below).

- **Command authoring contract (F-14)** — Commands can now declare named arguments in frontmatter:
  ```yaml
  args:
    - name: feature_context
      description: "Brief context about the feature"
      required: true
  ```
  Use `{{arg_name}}` in the command body; `!`shell command`` executes at dispatch time and injects live values. See `docs/command-authoring.md` in `claude-spec-driven-sdlc` for the full guide.

- **New config keys**:
  ```yaml
  small_models:
    model_ids: [qwen, my-custom-model]  # replaces (not extends) defaults
    max_tool_calls: 20                   # cap before max-turn warning fires
  ```

### Fixed

- **Truncation heuristic false positive** — `detectContextLimit()`'s mid-sentence truncation heuristic now requires the response to be at least 500 characters before triggering. Short completion messages (e.g. "Run `/spec:approve requirements` when ready") no longer falsely trigger a context-limit warning.

- **`promptContextLimitAction()` bridge hang** — Added a 30-second safety timeout to the bridge-mode context-limit action prompt. Previously, if no Ink UI listener was registered for `context-limit-action`, the promise would hang indefinitely; it now resolves to `'abort'` after 30 seconds.

- **Required arg substitution for all model sizes** — `dispatchWithIntake()` previously skipped arg collection for large models, leaving required args unsubstituted. It now collects missing required args regardless of model size. Optional args are never collected.

---

## [Unreleased] — Bug Fixes, Security, and UX Polish (spec 028 Phase A)

### Security

- **New-file creation gate (F-01)** — Files can no longer be written to disk before the user approves them. Previously, `write` calls could create new files that the approval gate would then process after the fact. Now, allow-list entries for `write` do not bypass approval when the target file does not yet exist — new file creation always requires explicit user confirmation. Additionally, shell steps in workflow YAML files now pass through the approval gate before executing.

- **Session key path-specificity (F-01)** — Clicking "always allow" for a write or read operation now scopes the session permission to that specific file path, not to the tool name. Previously, "always allow write" would silently approve writes to any file in the session.

- **Cross-repository gate hardened (F-02)** — Bash commands that reference paths outside the project root (via `../`, absolute paths, or `~/`) are now detected before the approval gate fires and escalated to `always-ask`. This enforcement is code-level: no model can talk its way past it by choosing different argument phrasing. A red warning is shown in both the legacy prompt and the Ink approval UI before the user sees the approval box.

### Changed

- **Tiered read approval (F-04)** — Reads to files inside the project root are now auto-allowed (no approval prompt). Cross-repository reads (`read`/`glob`/`grep` targeting paths outside the project root) still require explicit approval. Reads of sensitive files (`.env*`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `.git/config`, credentials, secrets) require approval even inside the project root.

- **Diff shown at approval prompt (F-03)** — Unified diffs for `write` and `edit` tool calls are now computed and displayed at the approval prompt, before execution. Legacy terminal mode shows the diff as plain text; the Ink UI uses the `SimpleDiff` component. Post-execution diff display has been removed.

### Added

- **Context limit detection (F-05)** — copair now detects when a small/local model (e.g. Qwen) silently stops responding due to context limits. Two signals are checked: (1) input tokens reaching ≥ 90% of the model's context window, and (2) a truncation heuristic (text-only response ending mid-word with no tool calls). On detection, a yellow warning is shown and the user is offered compact or abort.

- **Rolling thinking summary (F-06)** — The thinking spinner now shows a rolling preview of the model's streaming text during inference, so long waits feel transparent. The spinner stays alive until a tool call arrives (or the response completes), then stops cleanly.

- **Git branch in REPL prompt (F-07)** — The legacy REPL prompt now shows the current git branch in green, e.g. `copair (claude-3-5-sonnet) (main) >`. The branch refreshes after each turn to reflect branch switches made during the session.

## [Unreleased] — P0 Security Foundation (spec 022)

### Security

- **Prompt injection hardening** — All user-supplied content injected into the system prompt (knowledge files, file content, tool results) is now wrapped in typed XML context blocks (`<knowledge source="user">`, `<file path="...">`, `<tool_result tool="...">`). An `INJECTION_PREAMBLE` is prepended to every session's system prompt, explicitly instructing the model to treat content inside these blocks as inert data and never follow instructions found within them.

- **Zod tool input validation (FR-02)** — All built-in tools now declare a Zod schema (`inputSchema`). `ToolExecutor` validates every tool call against its schema before anything else runs — before the approval gate, before path checks. Invalid input returns a structured error immediately; the tool is never executed. MCP tools (dynamically discovered) skip validation (passthrough), as their schemas are not statically known.

- **Repository boundary enforcement / path traversal defense (FR-03)** — A new `PathGuard` class is the single enforcer of the project boundary. It is instantiated once at session start (with the git root or cwd as the project root) and injected into `ToolExecutor`. All file-touching tool calls (`read`, `write`, `edit`, `glob`, `grep`) pass their path fields through `PathGuard.check()` before execution. `realpathSync` is used to resolve symlinks, preventing symlink escape attacks. Paths outside the project root are denied in `strict` mode (default). The agent receives only a generic "Access denied" error — no path details are leaked. **Note:** the `bash` tool is not subject to path guard — it accepts arbitrary shell commands and can access any file the user's OS account can read. The approval gate is the enforcement point for bash calls; sensitive-path warnings are tracked in T-35.

- **Centralized secrets redaction (FR-04)** — A new `src/core/redactor.ts` module is the single source of truth for all secret patterns. Logger, session writer, and tool result pipeline all import `redact()` from this module. Secrets are redacted at write time before they can be persisted or returned to the agent. Supported patterns: Anthropic keys (`sk-ant-`), OpenAI keys (`sk-`), GitHub tokens (`ghp_`, `github_pat_`), AWS access keys (`AKIA`), Linear keys (`lin_api_`), Google API keys (`AIza`), Bearer tokens. Opt-in high-entropy base64 redaction is also available via `security.redact_high_entropy: true`.

- **`/dev/tty` approval isolation (FR-07)** — All interactive approval prompts (tool approval gates, init prompts, knowledge setup) now read from `/dev/tty` directly via synchronous `readSync`, bypassing `process.stdin`. This prevents keystroke injection attacks that attempt to pre-approve tool calls by piping crafted input to stdin. When `/dev/tty` is unavailable (CI environments), prompts return `null`, which is treated as CI-mode deny throughout the codebase.

- **Terminal ANSI injection sanitization (FR-08)** — A new `src/cli/ansi-sanitizer.ts` module strips dangerous terminal control sequences from raw LLM text output before it is written to stdout. Blocked sequences include: private mode set/reset (`?[hl]`), bracketed paste mode, OSC sequences (hyperlinks, window title), application keypad mode, DCS, PM, SS2/SS3. Safe display sequences (SGR colors, cursor movement) are preserved.

- **Tool result context wrapping** — All tool results returned to the agent are now wrapped in `<tool_result tool="name">` XML blocks so the `INJECTION_PREAMBLE` instruction applies: the model is explicitly told these blocks are inert data, not instructions. For `read` tool results, the file content is additionally wrapped in `<file path="...">` inside the tool result block, providing path context and a clear content boundary.

- **MCP server timeout and degraded-server flag (FR-09)** — `McpClientManager.callTool()` now wraps all MCP tool calls with `AbortSignal.timeout(30s)`. On timeout, the server is marked as `degraded` and all subsequent calls to that server fail immediately without making a network call. `McpTimeoutError` is caught by `ToolExecutor` and returned as a structured error to the agent, not rethrown. Per-server `timeout_ms` can now be set in config to override the global 30s default.

- **File mode hardening** — `.copair/` directories are now created with mode `0o700` (owner-only) and config files with `0o600`. This prevents other users on a shared machine from reading API keys or session data.

- **Network timeouts** — Web search adapters now use `AbortSignal.timeout()` (default 15s, configurable via `network.web_search_timeout_ms`). Provider clients (Anthropic, OpenAI) are initialized with a `timeout` option (default 120s, configurable via `network.provider_timeout_ms`).

### New config keys

```yaml
security:
  path_validation: strict   # 'strict' (default) or 'warn'
  redact_high_entropy: false # opt-in high-entropy base64 redaction

network:
  web_search_timeout_ms: 15000   # fetch timeout for web search adapters
  provider_timeout_ms: 120000    # LLM provider client timeout

# Per MCP server (in mcp_servers array):
mcp_servers:
  - name: my-server
    command: npx
    args: [my-mcp-server]
    timeout_ms: 10000  # overrides the global 30s default for this server
```

### Performance

Schema validation + path resolution overhead: **p50 0.03ms, p99 0.10ms, max 0.13ms** (measured over 100 consecutive tool calls, well under the 5ms NFR-01 budget).

### New files

- `src/core/redactor.ts` — centralized secret redaction
- `src/core/context-wrapper.ts` — XML context block wrapping + `INJECTION_PREAMBLE`
- `src/cli/tty-prompt.ts` — `/dev/tty` based prompt reader
- `src/cli/ansi-sanitizer.ts` — terminal control sequence sanitizer
- `src/core/path-guard.ts` — repository boundary enforcement

### Tests

405 tests across 47 files. New test coverage includes:

- `tests/core/redactor.test.ts` — all 8 secret patterns, ordering, high-entropy opt-in
- `tests/core/path-guard.test.ts` — boundary enforcement, symlink escape, traversal, warn mode
- `tests/cli/tty-prompt.test.ts` — `/dev/tty` mock, null handling, CRLF stripping
- `tests/cli/ansi-sanitizer.test.ts` — all blocked sequences, SGR preservation, attack vectors
- `tests/core/tool-executor-schema.test.ts` — Zod validation, gate ordering, MCP passthrough
- `tests/integration/security-attack-paths.test.ts` — 6 attack vectors end-to-end
- `tests/integration/security-perf.test.ts` — NFR-01 p99 < 5ms benchmark
