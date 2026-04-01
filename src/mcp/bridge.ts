import type { Tool, ToolResult } from '../tools/interface.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { McpClientManager } from './client.js';

export class McpBridge {
  constructor(
    private manager: McpClientManager,
    private registry: ToolRegistry,
  ) {}

  async registerAll(): Promise<void> {
    for (const [serverName, client] of this.manager.getAll()) {
      await this.registerServer(serverName, client);
    }
  }

  private async registerServer(serverName: string, client: { listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }> }): Promise<void> {
    const response = await client.listTools();
    const tools: Tool[] = response.tools.map((mcpTool) => {
      const tool: Tool = {
        definition: {
          name: mcpTool.name,
          description: mcpTool.description ?? '',
          inputSchema: (mcpTool.inputSchema as Record<string, unknown>) ?? {
            type: 'object',
            properties: {},
          },
        },
        requiresPermission: true,
        execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
          try {
            const result = await this.manager.callTool(serverName, mcpTool.name, input);
            const content = result.content
              .map((block) =>
                block.type === 'text' ? (block.text ?? '') : JSON.stringify(block),
              )
              .join('\n');
            return { content, isError: result.isError === true };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: `MCP tool error: ${message}`, isError: true };
          }
        },
      };
      return tool;
    });

    this.registry.registerMcpTools(serverName, tools);
  }
}
