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

## Environment Variables

Any config value can reference an env var with `${VAR_NAME}` syntax. Unresolved vars produce a load-time error.
