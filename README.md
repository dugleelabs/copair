<p align="center">
  <img src="https://assets.dugleelabs.com/Copair_Logo_cc1a297c94.png" width="160" alt="Copair Logo" />
</p>

A model-agnostic AI coding agent for the terminal. Works like Claude Code but supports any LLM provider — commercial APIs, open source models, or self-hosted instances.

```
npm install -g copair
copair
```

## Providers

| Provider | Type |
|----------|------|
| Anthropic (Claude) | Native |
| OpenAI (GPT-4o, o1, etc.) | Native |
| Google Gemini (incl. 2.0/3.0 thought signatures) | Native |
| Ollama, vLLM, LM Studio, etc. | OpenAI-compatible |

Switch models mid-session with `/model <name>`. Context is summarized automatically before switching.

## Quick Setup

Create `~/.copair/config.yaml`:

```yaml
version: 1
default_model: claude-sonnet

providers:
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
    models:
      claude-sonnet:
        id: claude-sonnet-4-20250514

  openai:
    api_key: ${OPENAI_API_KEY}
    models:
      gpt-4o:
        id: gpt-4o

  ollama:
    type: openai-compatible
    base_url: http://localhost:11434/v1
    models:
      llama3:
        id: llama3.1:8b
        supports_tool_calling: false
```

```
copair                    # start with default model
upcopair --model gpt-4o     # start with a specific model
copair --verbose          # show INFO/WARN logs
copair --debug            # show all logs including DEBUG
```

→ [Full configuration reference](docs/configuration.md)  
→ [Local models setup (Qwen 3.5, etc.)](docs/local-models.md)

## Built-in Tools

The agent has direct access to your codebase:

| Tool | Description |
|------|-------------|
| `Read` | Read file contents with line offset/limit |
| `Write` | Write file contents, creates parent dirs |
| `Edit` | Exact string replacement (errors on non-unique match) |
| `Grep` | Regex search across files |
| `Glob` | File pattern matching |
| `Bash` | Execute shell commands with timeout |
| `Git` | git status, diff, log, commit |
| `WebSearch` | Search via Tavily, Serper, or SearXNG |

For models without native tool calling, Copair falls back to prompt-based tool extraction.

## Permissions

```yaml
permissions:
  mode: ask          # ask | auto-approve | deny
  allow_commands:    # bash commands that skip the prompt
    - git status
    - git diff
    - npm test
```

In `ask` mode you can approve once or always-allow for the session. Shell operators (`;`, `&&`, `|`, etc.) are never auto-approved even if the base command matches.

→ [Permission docs](docs/configuration.md#permission-modes)

## Token Tracking

After each response:
```
[tokens: 1,234 in / 567 out | session: 5,678 in / 2,345 out | ~$0.12]
```

On exit, a per-model cost breakdown is shown. Supports all OpenAI, Anthropic, and Google pricing. Falls back to tiktoken estimation when the API doesn't report usage.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | List all available commands |
| `/model <name>` | Switch model mid-session |
| `/clear` | Clear conversation history |
| `/cost` | Show session token usage and cost |
| `/workflow <name>` | Run a workflow |
| `/commands` | List custom commands |

Custom commands are markdown files with frontmatter — drop them in `~/.copair/commands/` or `.copair/commands/`. Commands support nesting, positional arguments, and `$VAR` / `{{var}}` interpolation. They return their expanded markdown directly to the agent. → [Custom commands](docs/commands.md)

## Workflows

Multi-step YAML workflows that combine agent prompts, shell commands, and branching logic.

```
/workflow test-fix
/workflow test-fix test_command=pytest
```

Workflows support: `prompt`, `shell`, `command`, `condition`, and `output` step types. Ctrl+C cancels at any step. → [Workflow docs](docs/workflows.md)

## MCP Servers

Extend the agent with any [Model Context Protocol](https://modelcontextprotocol.io) server. MCP tools are discovered at startup and namespaced as `server-name:tool-name`.

```yaml
mcp_servers:
  - name: filesystem
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
```

→ [MCP docs](docs/mcp.md)

## Web Search

Supports Tavily, Serper, and self-hosted SearXNG. Anthropic models use native built-in search automatically.

```yaml
web_search:
  provider: tavily
  api_key: ${TAVILY_API_KEY}
```

→ [Web search docs](docs/web-search.md)

## License

MIT
