# Changelog

All notable changes to copair are documented here.

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
