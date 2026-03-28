# Copair Knowledge Base

## Directory Map
- `src/` — all TypeScript source
- `src/index.ts` — main entry point and session bootstrap
- `src/cli/` — argument parsing, banner, UI (Ink-based)
- `src/commands/` — slash commands (`/session`, `/workflow`, etc.)
- `src/config/` — config schema (Zod), loader with global+project merge
- `src/core/` — agent loop, approval gate, session manager, git context
- `src/init/` — startup managers: GlobalInitManager, ProjectInitManager, GitignoreManager
- `src/knowledge/` — KnowledgeManager (load/inject/evaluate), KnowledgeSetupFlow
- `src/mcp/` — MCP client and bridge for external tool servers
- `src/providers/` — provider adapters: Anthropic, OpenAI, Google, OpenAI-compatible
- `src/tools/` — built-in tools (bash, read, edit, write, glob, grep, git, web-search)
- `src/utils/` — shared utilities (environmentUtils: isCI)
- `src/workflows/` — multi-step workflow engine
- `tests/` — co-located unit/integration/e2e tests (vitest)
- `dist/` — build output (generated, do not edit)
- `docs/` — user-facing documentation

## Tech Stack
- Language: TypeScript (Node.js 20+)
- Package manager: pnpm
- Build: tsup → `dist/index.js` (ESM)
- Test runner: vitest
- UI: Ink (React for CLI)
- Config format: YAML (parsed with `yaml` package)
- Schema validation: Zod

## Naming Conventions
- Files: camelCase for modules (`session.ts`), PascalCase for class files (`KnowledgeManager.ts`)
- Tests: co-located under `tests/`, `.test.ts` suffix
- Commit style: `<type>(<scope>): <imperative subject>` (feat, fix, chore, refactor, test, docs)
- Branch style: `<type>/<kebab-desc>`

## Entry Points
- `src/index.ts` — CLI entry point and full startup sequence
- `src/core/agent.ts` — main agent loop (tool calls, conversation, streaming)
- `.copair/config.yaml` — project config (overrides `~/.copair/config.yaml`)
- `~/.copair/config.yaml` — global config (API keys, default model, UI preferences)
- `COPAIR_KNOWLEDGE.md` — this file; navigation map for the agent

## Off-Limits
- `dist/` — generated output; never edit directly
- `pnpm-lock.yaml` — managed by pnpm; do not edit manually
- `node_modules/` — do not touch
