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

## Small-model harness (`small_models`)

Tunes the small-model harness. Every key is optional; an omitted key keeps the
current shipped behavior, so an absent `small_models` block changes nothing.

```yaml
small_models:
  tier_overrides:              # model ID → tier ("small" | "large")
    my-finetune: small         # overrides the built-in classifier; loses to --small-model / --no-small-model
  max_tool_calls: 20           # per-turn tool-call limit for small models (default: 20)

  enable_loop_guard: true        # result-aware loop guard (default: true)
  enable_format_repair: true     # tool-call format-error repair loop (default: true)
  max_repair_retries: 2          # format-repair retries before giving up (default: 2)
  enable_inspect_before_act: true # inspect-before-act system-prompt rule (default: true)
  force_format: dsml             # force a formatter: dsml | qwen-xml | fenced-block (default: none)
```

The three boolean toggles (`enable_loop_guard`, `enable_format_repair`,
`enable_inspect_before_act`) and `force_format` are echoed back in headless
runs' `resolved_config`, which makes them the basis of the benchmark ablation
pattern. → [Headless mode](headless.md#toggling-harness-features-ablation)
