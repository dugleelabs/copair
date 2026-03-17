# MCP Servers

Copair supports [Model Context Protocol](https://modelcontextprotocol.io) servers for extending tool capabilities.

## Configuration

```yaml
mcp_servers:
  - name: filesystem
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]

  - name: github
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
```

## How It Works

MCP servers start in the background after the REPL launches (lazy initialization). Their tools appear in the agent's tool registry namespaced as `server-name:tool-name` to avoid collisions with built-in tools.

MCP tools require the same permission checks as built-in tools.
