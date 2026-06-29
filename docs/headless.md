# Headless mode

`copair --headless` runs a single task non-interactively: a prompt goes in, a
structured JSON result comes out on stdout, and no TTY / REPL is ever started.
It is the surface the benchmark harness drives.

```sh
copair --headless "fix the failing test in src/foo.ts" --model qwen-7b
```

The machine-readable contracts are committed as JSON Schema (draft 2020-12)
under [`schemas/`](../schemas/) and are versioned independently of the package:

| Contract | Schema | Version field |
| --- | --- | --- |
| stdout result document | [`schemas/headless-result.schema.json`](../schemas/headless-result.schema.json) | `schema_version` |
| `--events` JSONL line | [`schemas/headless-event.schema.json`](../schemas/headless-event.schema.json) | `v` |

Both versions are currently `1`. A breaking change to either shape bumps its
version; consumers should pin against a specific version.

## Flags

Headless mode is enabled by `--headless`. The task positional and the flags
marked *headless-only* below are **rejected with exit 1** if passed without
`--headless` (they never silently no-op).

| Flag | Effect |
| --- | --- |
| `--headless` | Enable headless mode. |
| `[task]` | Task prompt (positional). *headless-only.* |
| `-f, --file <path>` | Read the task prompt from a file. *headless-only.* |
| `--events <path>` | Write the mechanism-event JSONL stream to this path. *headless-only.* |
| `--auto-approve` | Approve every tool action without prompting. *headless-only.* See [Approvals](#approvals). |
| `--max-tool-calls <n>` | Cap tool calls for the run (positive integer). *headless-only.* |
| `--max-tokens <n>` | Cap total tokens for the run (positive integer). *headless-only.* |
| `--cwd <path>` | Working directory for the run (applied before any path resolves). *headless-only.* |
| `--isolated` | Ignore global + project config; use defaults + `-c` + flags only. *headless-only.* See [Config resolution](#config-resolution). |
| `--quiet` | Suppress the human-readable model-text stream on stderr. *headless-only.* |
| `-m, --model <name>` | Model alias (overrides `default_model`). |
| `-c, --config <path>` | Explicit config file path. |

`--max-tool-calls` and `--max-tokens` must be positive integers; a non-integer
or `<= 0` value fails with exit 1 before the run starts.

## Task resolution

The task prompt is resolved in this precedence order; the first non-empty source
wins:

1. the `[task]` positional argument
2. `-f, --file <path>` (file contents)
3. stdin — read **only when stdin is piped** (not a TTY)

If none of the three yields a non-empty string, the run is never started: it
writes an error to stderr and exits 1.

```sh
echo "summarize src/index.ts" | copair --headless --model qwen-7b
copair --headless -f task.md --model qwen-7b
```

## Output streams

The three streams are strictly separated:

- **stdout** — exactly one JSON result document, newline-terminated, written
  once at exit. Nothing else is ever written to stdout. Parse stdout as a single
  JSON object.
- **stderr** — the model's streaming text (unless `--quiet`), plus operational
  notes and pre-result error messages. `--quiet` suppresses only the model-text
  stream; operational notes and error messages are still written.
- **`--events <path>`** — the mechanism-event JSONL stream (see
  [Event stream](#event-stream)). Omitted when `--events` is not passed; the
  result document's `events_file` is then `null`.

## Exit codes

The exit code is binary and reflects **whether a result document was produced**:

| Code | Meaning |
| --- | --- |
| `0` | A result document was written to stdout. This includes runs where the agent itself errored — the error is carried in the result's `error` field with `termination_reason: "error"`. |
| `1` | A pre-result failure: nothing was written to stdout, and a message was written to stderr. |

A `1` is produced by (in order of where it can occur):

- an illegal flag combination (a headless-only flag without `--headless`, or a
  non-positive-integer `--max-tool-calls` / `--max-tokens`)
- `--cwd` pointing at a directory that cannot be entered
- no task provided
- a config load/validation error
- model / provider resolution failure (including an unknown model)

Once the agent loop starts, the run always ends with exit 0 and a result
document — agent-level failures are reported *in* the JSON, not via the exit
code.

## Result document (stdout)

Validated against [`schemas/headless-result.schema.json`](../schemas/headless-result.schema.json).
Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | `1` | Result schema version. |
| `run.task_source` | `"arg" \| "file" \| "stdin"` | Where the prompt came from. |
| `run.cwd` | string | Working directory of the run. |
| `run.started_at` | string | ISO-8601 timestamp. |
| `run.duration_ms` | integer ≥ 0 | Wall-clock duration. |
| `termination_reason` | enum | See [Termination reasons](#termination-reasons). |
| `turns.tool_calls` | integer ≥ 0 | Count of tool-start events. |
| `turns.assistant_messages` | integer ≥ 0 | Count of provider responses (one per `usage` event). |
| `usage.input_tokens` | integer ≥ 0 | Summed from the token tracker. |
| `usage.output_tokens` | integer ≥ 0 | Summed from the token tracker. |
| `usage.estimated_cost_usd` | number ≥ 0, or `null` | `null` when the tracked cost is `0` (e.g. no pricing for the model). |
| `resolved_config` | object | The settings actually in force — see below. |
| `events_file` | string or `null` | The `--events` path, or `null` if unset. |
| `session_id` | string | The session created for this run. |
| `error` | `{ message: string }` or `null` | Non-null only when `termination_reason` is `"error"`. |

### `resolved_config`

The post-resolution view of what the run used:

| Field | Type | Notes |
| --- | --- | --- |
| `model` | string | Resolved model alias. |
| `provider` | string | Provider name. |
| `tier` | `"small" \| "large" \| "unknown"` | `small` when the small-model harness is active for this model. |
| `formatter` | `"dsml" \| "qwen-xml" \| "fenced-block" \| "native"` | `native` for models that use provider-native tool calling; otherwise the resolved text formatter. |
| `toggles` | object | `loop_guard`, `format_repair`, `inspect_before_act`, `truncation` (booleans) — the harness features that took effect. |
| `permissions` | `"headless-terminate" \| "headless-auto-approve"` | `headless-auto-approve` only with `--auto-approve`. |
| `limits.max_tool_calls` | integer or `null` | The `--max-tool-calls` value, or `null`. |
| `limits.max_tokens` | integer or `null` | The `--max-tokens` value, or `null`. |
| `config_sources` | string[] | Config layers that contributed, low→high precedence (see [Config resolution](#config-resolution)). |

> `toggles.truncation` is always `true`. Output truncation has no per-run toggle
> — it is always on — so this field reports the current behavior rather than a
> configurable switch. The three config-driven toggles are `loop_guard`,
> `format_repair`, and `inspect_before_act`.

## Termination reasons

`termination_reason` (in the result) and the final `run_terminated.reason` (in
the event stream) draw from one enum:

| Reason | Meaning |
| --- | --- |
| `completed` | The agent called the `task_complete` tool. |
| `model-declared-done` | The turn ended without a `task_complete` call. |
| `approval-required` | A tool needed approval and the run was in terminate-mode (see [Approvals](#approvals)). |
| `context-exhausted` | The context limit was reached. Headless never compacts — it aborts. |
| `max-tool-calls` | The `--max-tool-calls` cap was hit. |
| `max-tokens` | The `--max-tokens` cap was hit. |
| `aborted` | The loop guard halted the run, or format-repair was exhausted. The event stream disambiguates which (`loop_halt` vs `format_repair_exhausted`). |
| `error` | A thrown error ended the run; see the result's `error.message`. |

## Event stream

When `--events <path>` is set, every mechanism event is appended as one JSON
line (JSONL). The file is truncated at the start of the run, and each line is
flushed synchronously — so a `kill -9` mid-run still leaves a valid, parseable
partial stream. Validated against
[`schemas/headless-event.schema.json`](../schemas/headless-event.schema.json).

Every event carries an envelope: `v` (schema version), `seq` (monotonic,
starting at 0), and `ts` (ISO-8601). The `event` field discriminates the type:

| `event` | Payload (beyond the envelope) |
| --- | --- |
| `turn_started` | `turn_index` |
| `turn_completed` | `turn_index` |
| `tool_call_parsed` | `valid`, `formatter`, `tool?` |
| `format_repair` | `specific_issue?` |
| `format_repair_exhausted` | `specific_issue?` |
| `loop_nudge` | — |
| `loop_halt` | `reason` |
| `output_truncated` | `tool` (`"bash" \| "read" \| "grep"`) |
| `tool_started` | `tool` |
| `tool_completed` | `tool`, `ok`, `denied?` |
| `approval_required` | `tool` |
| `usage` | `input_tokens`, `output_tokens` |
| `run_terminated` | `reason` (a [termination reason](#termination-reasons)) |

Turn boundaries are driven by `usage`: each provider response opens a turn
(`turn_started`), and the next response (or run end) closes it
(`turn_completed`). The stream always ends with `run_terminated`, which is
preceded by the close of any open turn.

### Counting semantics

- **`tool_call_parsed`** is emitted once per parse *attempt*. Format-validity is
  `valid ÷ attempts`. A format-repair retry adds another attempt.
- **Known limitation:** on the native tool-calling path each parsed call emits
  one `tool_call_parsed`. On the large-model / format-repair-off text path the
  parser has no strict valid/invalid signal, so it emits `valid: true`
  unconditionally — first-try validity cannot be read from that path. The
  success-rate metrics are unaffected.

## Approvals

Headless never prompts. The approval policy is decided entirely by the
`--auto-approve` flag — the config `permissions.mode` does **not** govern
headless tool decisions.

- **Default (terminate-mode)** — every approval request is denied. An
  `approval_required` event is emitted, the run ends, and `termination_reason`
  is `approval-required`. `resolved_config.permissions` is `headless-terminate`.
- **`--auto-approve`** — every request is approved (per request, including
  always-ask carve-outs such as web search and cross-repo access).
  `resolved_config.permissions` is `headless-auto-approve`.

> **Run `--auto-approve` only in a sandbox.** It approves *every* tool action,
> including file writes and shell commands, with no confirmation. Use a
> disposable working copy / container.

Two interactive callbacks are also short-circuited so a run can never block:

- a context-limit decision resolves to *abort* (→ `context-exhausted`); headless
  never compacts.
- an interactive input request is answered with an empty string, and a note is
  written to stderr.

## Config resolution

Config layers are deep-merged in precedence order (later wins), and the layers
that contributed are reported in the result's `resolved_config.config_sources`.

**Normal:**

```
defaults  →  ~/.copair/config.yaml (global)  →  <cwd>/.copair/config.yaml (project)  →  -c <path>
```

`config_sources` example: `["defaults","global","project"]`, or
`["defaults","global","project","-c:/abs/path"]` when `-c` is also supplied.

**`--isolated`:**

```
defaults  →  -c <path>   (global + project are ignored)
```

`config_sources` example: `["defaults"]`, or `["defaults","-c:/abs/path"]`.

Environment-variable interpolation (e.g. `${OPENAI_API_KEY}`) is applied to the
merged config.

## Toggling harness features (ablation)

The small-model harness features are configured under `small_models` (see
[configuration.md](configuration.md)). There are two ways to flip a toggle for a
run, with different reproducibility guarantees.

**Overlay (quick, not isolated).** A `-c` file layers on top of your global +
project config (see [Config resolution](#config-resolution)), so the model stays
resolvable from your existing config and only the toggle changes:

```yaml
# ablate-no-loop-guard.yaml
version: 1
small_models:
  enable_loop_guard: false
```

```sh
copair --headless -c ablate-no-loop-guard.yaml \
  --events run.jsonl --model qwen-7b "…task…"
```

`config_sources` will then include `global` / `project` — your ambient config
also contributed, so this is convenient but not a clean, reproducible run.

**Isolated (reproducible).** `--isolated` ignores global + project config, so the
`-c` file must be **self-contained**: it has to define the `providers` entry for
the model — and, because the strict-unknowns guard also runs without your config,
any `model_overrides` the alias needs. copair ships **no** built-in providers, so
an isolated `-c` that omits the provider fails with *"Model … not found in any
provider."* before the run starts.

```yaml
# ablate-no-loop-guard.isolated.yaml
version: 1
default_model: qwen-7b
providers:
  ollama:
    type: openai-compatible
    base_url: http://localhost:11434/v1
    models:
      qwen-7b:
        id: qwen2.5:7b
        supports_tool_calling: false
        context_window: 131072
model_overrides:       # required when the alias isn't a built-in family
  qwen-7b:
    tier: small
    preferred_format: qwen-xml
    context_window: 131072
    max_tokens: 4096
    native_tool_calling: unreliable
small_models:
  enable_loop_guard: false   # the ablation
```

```sh
copair --headless --isolated -c ablate-no-loop-guard.isolated.yaml \
  --events run.jsonl --model qwen-7b "…task…"
```

`config_sources` is then `["defaults","-c:<abs path>"]` — nothing ambient
contributed. This is the form a reproducible benchmark run should use.

The config-driven toggles and their defaults:

| Key (under `small_models`) | Default | `resolved_config.toggles` field |
| --- | --- | --- |
| `enable_loop_guard` | `true` | `loop_guard` |
| `enable_format_repair` | `true` | `format_repair` |
| `enable_inspect_before_act` | `true` | `inspect_before_act` |
| `force_format` | none | reflected in `resolved_config.formatter` |
| `max_repair_retries` | `2` | — |

`resolved_config.toggles` echoes back which features took effect, so a consumer
can confirm a `-c` override actually applied.

> `small_models.max_tool_calls` (default 20) is the **per-turn** tool-call limit
> for small models — distinct from the `--max-tool-calls` flag, which caps tool
> calls for the **whole run**.

## Schema versioning

The result and event shapes each carry a version (`schema_version` / `v`), both
currently `1`. The committed [`schemas/`](../schemas/) artifacts are generated
from the source schemas and are guarded against drift in CI. Pin against a
version; a breaking change bumps it.
