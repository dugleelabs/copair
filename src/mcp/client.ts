import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfigSchema } from '../config/schema.js';
import type { z } from 'zod';

type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export interface McpClient {
  name: string;
  client: Client;
}

export class McpClientManager {
  private clients = new Map<string, Client>();

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
  }
}
