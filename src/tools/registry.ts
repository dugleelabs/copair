import type { Tool, ToolDefinition } from './interface.js';

export class ToolRegistry {
  private builtinTools = new Map<string, Tool>();
  private mcpTools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.builtinTools.set(tool.definition.name, tool);
  }

  registerMcpTools(serverName: string, tools: Tool[]): void {
    for (const tool of tools) {
      const namespacedName = `${serverName}:${tool.definition.name}`;
      const namespacedTool: Tool = {
        ...tool,
        definition: { ...tool.definition, name: namespacedName },
      };
      this.mcpTools.set(namespacedName, namespacedTool);
    }
  }

  get(name: string): Tool | undefined {
    return this.builtinTools.get(name) ?? this.mcpTools.get(name);
  }

  getAllDefinitions(): ToolDefinition[] {
    const defs: ToolDefinition[] = [];
    for (const tool of this.builtinTools.values()) {
      defs.push(tool.definition);
    }
    for (const tool of this.mcpTools.values()) {
      defs.push(tool.definition);
    }
    return defs;
  }
}
