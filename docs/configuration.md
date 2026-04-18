# Configuration

Config is loaded from two locations and merged (project overrides global):

```
~/.copair/config.yaml     # Global
./.copair.yaml            # Project-level
```

## Full Schema

```yaml
version: 1                  # Required. Must be 1.
default_model: claude-sonnet

providers:
  <name>:
    api_key: ${ENV_VAR}     # Supports env var interpolation
    base_url: https://...   # Optional. Override API endpoint.
    type: openai-compatible # Required for non-standard providers.
    models:
      <alias>:
        id: <model-id>            # Provider's model identifier
        max_tokens: 8192          # Max output tokens
        context_window: 200000    # Max input context
        supports_tool_calling: true
        supports_streaming: true
        supports_system_role: true    # Set false for gateways that reject role:"system"

permissions:
  mode: ask                 # ask | auto-approve | deny
  allow_commands:           # Auto-approved bash commands (exact match, no shell operators)
    - git status
    - git diff
    - npm test

feature_flags:
  model_routing: false

mcp_servers:
  - name: filesystem
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    env:
      MY_VAR: value

web_search:
  provider: tavily          # tavily | serper | searxng
  api_key: ${TAVILY_API_KEY}
  max_results: 5
```

## Permission Modes

- **ask** — Prompts before each tool execution. You can approve once or always-allow for the session.
- **auto-approve** — Executes all tools without prompting.
- **deny** — Blocks all tool execution.

The `allow_commands` list auto-approves exact bash commands. Commands with shell operators (`;`, `&&`, `|`, etc.) never match the allow-list.

## Model Capability Flags

Each entry under `models.<alias>` accepts these optional booleans:

- `supports_tool_calling` (default `true`) — set `false` for models without native OpenAI tool-calling; Copair falls back to XML-based prompt tool extraction.
- `supports_streaming` (default `true`) — set `false` if the gateway rejects streamed requests or the `stream_options` field.
- `supports_system_role` (default `true`) — set `false` for OpenAI-compatible gateways that reject `role: "system"` messages (seen on some Qwen distills and hosted deploys with pinned server-side prompts). When `false`, Copair folds the system prompt into the first user message instead.

## Environment Variables

Any config value can reference an env var with `${VAR_NAME}` syntax. Unresolved vars produce a load-time error.
