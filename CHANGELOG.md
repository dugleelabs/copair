# Changelog

All notable changes to copair are documented here.

## [Unreleased] — P0 Security Foundation (spec 022)

### Security

- **Prompt injection hardening** — All user-supplied content injected into the system prompt (knowledge files, file content, tool results) is now wrapped in typed XML context blocks (`<knowledge source="user">`, `<file path="...">`, `<tool_result tool="...">`). An `INJECTION_PREAMBLE` is prepended to every session's system prompt, explicitly instructing the model to treat content inside these blocks as inert data and never follow instructions found within them.

- **Zod tool input validation (FR-02)** — All built-in tools now declare a Zod schema (`inputSchema`). `ToolExecutor` validates every tool call against its schema before anything else runs — before the approval gate, before path checks. Invalid input returns a structured error immediately; the tool is never executed. MCP tools (dynamically discovered) skip validation (passthrough), as their schemas are not statically known.

- **Repository boundary enforcement / path traversal defense (FR-03)** — A new `PathGuard` class is the single enforcer of the project boundary. It is instantiated once at session start (with the git root or cwd as the project root) and injected into `ToolExecutor`. All file-touching tool calls pass their path fields through `PathGuard.check()` before execution. `realpathSync` is used to resolve symlinks, preventing symlink escape attacks. Paths outside the project root are denied in `strict` mode (default). The agent receives only a generic "Access denied" error — no path details are leaked.

- **Centralized secrets redaction (FR-04)** — A new `src/core/redactor.ts` module is the single source of truth for all secret patterns. Logger, session writer, and tool result pipeline all import `redact()` from this module. Secrets are redacted at write time before they can be persisted or returned to the agent. Supported patterns: Anthropic keys (`sk-ant-`), OpenAI keys (`sk-`), GitHub tokens (`ghp_`, `github_pat_`), AWS access keys (`AKIA`), Linear keys (`lin_api_`), Google API keys (`AIza`), Bearer tokens. Opt-in high-entropy base64 redaction is also available via `security.redact_high_entropy: true`.

- **`/dev/tty` approval isolation (FR-07)** — All interactive approval prompts (tool approval gates, init prompts, knowledge setup) now read from `/dev/tty` directly via synchronous `readSync`, bypassing `process.stdin`. This prevents keystroke injection attacks that attempt to pre-approve tool calls by piping crafted input to stdin. When `/dev/tty` is unavailable (CI environments), prompts return `null`, which is treated as CI-mode deny throughout the codebase.

- **Terminal ANSI injection sanitization (FR-08)** — A new `src/cli/ansi-sanitizer.ts` module strips dangerous terminal control sequences from raw LLM text output before it is written to stdout. Blocked sequences include: private mode set/reset (`?[hl]`), bracketed paste mode, OSC sequences (hyperlinks, window title), application keypad mode, DCS, PM, SS2/SS3. Safe display sequences (SGR colors, cursor movement) are preserved.

- **MCP server timeout and degraded-server flag (FR-09)** — `McpClientManager.callTool()` now wraps all MCP tool calls with `AbortSignal.timeout(30s)`. On timeout, the server is marked as `degraded` and all subsequent calls to that server fail immediately without making a network call. `McpTimeoutError` is caught by `ToolExecutor` and returned as a structured error to the agent, not rethrown.

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
