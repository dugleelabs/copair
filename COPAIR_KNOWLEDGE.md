# Copair — Project Knowledge

## Overview
- **Package**: `@dugleelabs/copair` v1.0.2 — model-agnostic AI coding agent CLI
- **Entry point**: `src/index.ts` → `dist/index.js` (bin: `copair`)
- **Runtime**: Node ≥ 20, ESM, TypeScript 5, built with `tsup`
- **Package manager**: `pnpm@10.18.3` (workspace)

## Architecture

### Top-level `src/` modules
| Directory | Responsibility |
|-----------|---------------|
| `cli/` | CLI arg parsing, banner, markdown renderer, ink UI components |
| `cli/ui/` | Ink (React) UI: `app.tsx` is root, `agent-bridge.ts` is the event bus between agent and UI |
| `commands/` | Slash-command system — builtins + user-defined markdown commands |
| `config/` | Config schema (Zod), loader (merges `~/.copair/config.yaml` + `.copair/config.yaml`), pricing |
| `core/` | Agent loop, conversation, context window, session, approval gate, tool executor, git context |
| `init/` | First-run flows: `GlobalInitManager`, `ProjectInitManager`, `GitignoreManager` |
| `knowledge/` | `KnowledgeManager` (load/inject `COPAIR_KNOWLEDGE.md`), `KnowledgeSetupFlow` |
| `mcp/` | MCP client + bridge (registers MCP tools into the tool registry) |
| `providers/` | Provider adapters: `openai`, `anthropic`, `google`, `openai-compatible`; `ProviderRegistry` |
| `tools/` | Built-in tools: `read`, `write`, `edit`, `grep`, `glob`, `bash`, `git`, `web-search`, `update-knowledge` |
| `utils/` | `environmentUtils.ts` (CI detection, etc.) |
| `workflows/` | YAML workflow engine — step types: `prompt`, `shell`, `command`, `condition`, `output` |

### Key classes / files
- `src/core/agent.ts` — `Agent`: orchestrates provider ↔ tools ↔ conversation loop
- `src/core/conversation.ts` — `ConversationManager`: message history
- `src/core/context-window.ts` — `ContextWindowManager`: token budget / summarization triggers
- `src/core/session.ts` — `SessionManager`: persist/resume sessions in `.copair/sessions/`
- `src/core/approval-gate.ts` — `ApprovalGate`: ask/auto-approve/deny permission modes
- `src/core/tool-executor.ts` — `ToolExecutor`: runs tools through the gate
- `src/core/formats/` — Fallback tool-call formats for non-native models: `dsml`, `qwen-xml`, `fenced-block`
- `src/cli/ui/agent-bridge.ts` — `AgentBridge`: EventEmitter connecting agent events to ink UI
- `src/cli/ui/app.tsx` — Root ink component; renders output pane, status bar, input
- `src/config/schema.ts` — Zod schemas for all config (`CopairConfigSchema`, `ProviderConfigSchema`, etc.)
- `src/providers/interface.ts` — `Provider` interface all adapters implement

## Config
- Global: `~/.copair/config.yaml`; project override: `.copair/config.yaml` (gitignored)
- Key top-level keys: `version`, `default_model`, `providers`, `permissions`, `mcp_servers`, `web_search`, `identity`, `context`, `knowledge`, `ui`
- Permissions modes: `ask` (default) | `auto-approve` | `deny`
- `context.max_sessions` defaults to 1; `knowledge.warn_size_kb` = 8, `max_size_kb` = 16

## Providers
Supported types: `anthropic`, `openai`, `google`, `openai-compatible`
- Provider type is inferred from the key name (`anthropic`, `openai`, `google`/`gemini`) or explicit `type:` field
- API keys support `${ENV_VAR}` interpolation
- Per-model flags: `supports_tool_calling`, `supports_streaming`, `tool_call_format`

## Sessions
- Stored in `.copair/sessions/<uuid>/` — `session.json`, `messages.jsonl`, optional `summary.md`
- Auto-named from git branch + first message + files touched (`src/core/session-identifier.ts`)
- On exit: summarized via `SessionSummarizer` (uses configured `summarization_model` or active model)
- Resume: `--resume` flag or interactive picker on startup

## Knowledge Base
- `COPAIR_KNOWLEDGE.md` in project root — injected into system prompt via `KnowledgeManager`
- Written by agent via `update_knowledge` tool (`src/tools/update-knowledge.ts`)
- Size budget: warn at 8 KB, hard cap at 16 KB

## Tooling / Build
- Build: `pnpm build` (tsup, outputs `dist/index.js`)
- Test: `pnpm test` (vitest, `tests/smoke.test.ts`)
- Lint: `pnpm lint` (ESLint + typescript-eslint)
- Dev: `pnpm dev` (tsup --watch)
- Publish gate: `prepublishOnly` runs lint → test → build

## Release
- Semantic release via `.releaserc.json`; changelog/version bumped automatically on merge to `main`
- CI config: `.github/pull_request.yaml` (inferred from badge)
