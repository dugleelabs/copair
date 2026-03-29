import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfigSchema } from '../config/schema.js';
import type { z } from 'zod';
import { logger } from '../core/logger.js';

type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

/**
 * Thrown when an MCP tool call exceeds its timeout.
 * Caught in ToolExecutor and returned as a structured error to the agent.
 */
export class McpTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpTimeoutError';
  }
}

export interface McpClient {
  name: string;
  client: Client;
}

export class McpClientManager {
  private clients = new Map<string, Client>();
  /** Servers that have timed out — subsequent calls fail immediately. */
  private degraded = new Set<string>();

  async initialize(servers: McpServerConfig[]): Promise<void> {
    for (const server of servers) {
      await this.connectServer(server);
    }
  }

  private async connectServer(server: McpServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: server.env as Record<string, string> | undefined,
    });

    const client = new Client(
      { name: 'copair', version: '0.1.0' },
      { capabilities: {} },
    );

    await client.connect(transport);
    this.clients.set(server.name, client);
  }

  /**
   * Call a tool on the named MCP server with a timeout.
   * If the server has previously timed out, throws immediately without making
   * a network call. On timeout, marks the server as degraded.
   *
   * @param serverName  The MCP server name (as registered).
   * @param toolName    The tool name to call.
   * @param args        Tool arguments.
   * @param timeoutMs   Timeout in milliseconds (default: 30s).
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> {
    if (this.degraded.has(serverName)) {
      throw new McpTimeoutError(
        `MCP server "${serverName}" is degraded (previous timeout) — skipping`,
      );
    }

    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server "${serverName}" not connected`);
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMs);

    try {
      const result = await client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal: timeoutSignal },
      );
      return result as { content: Array<{ type: string; text?: string }>; isError?: boolean };
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        this.degraded.add(serverName);
        logger.warn('mcp', `Timeout on tool "${toolName}" from server "${serverName}" — server marked degraded`);
        throw new McpTimeoutError(`MCP tool "${toolName}" timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  }

  getClient(name: string): Client | undefined {
    return this.clients.get(name);
  }

  getAll(): Map<string, Client> {
    return this.clients;
  }

  async shutdown(): Promise<void> {
    const shutdowns = Array.from(this.clients.values()).map((client) =>
      client.close().catch(() => {}),
    );
    await Promise.all(shutdowns);
    this.clients.clear();
    this.degraded.clear();
  }
}
