import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { Tool } from '../../src/tools/interface.js';

function mockTool(name: string): Tool {
  return {
    definition: {
      name,
      description: `Mock ${name} tool`,
      inputSchema: { type: 'object', properties: {} },
    },
    requiresPermission: false,
    async execute() {
      return { content: 'ok' };
    },
  };
}

describe('ToolRegistry', () => {
  it('registers and retrieves a tool', () => {
    const registry = new ToolRegistry();
    registry.register(mockTool('read'));
    expect(registry.get('read')?.definition.name).toBe('read');
  });

  it('returns undefined for unknown tool', () => {
    const registry = new ToolRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('lists all tool definitions', () => {
    const registry = new ToolRegistry();
    registry.register(mockTool('read'));
    registry.register(mockTool('write'));
    const defs = registry.getAllDefinitions();
    expect(defs).toHaveLength(2);
    expect(defs.map((d) => d.name)).toEqual(['read', 'write']);
  });

  it('registers MCP tools with namespace prefix', () => {
    const registry = new ToolRegistry();
    registry.registerMcpTools('fs', [mockTool('list'), mockTool('read')]);

    expect(registry.get('fs:list')?.definition.name).toBe('fs:list');
    expect(registry.get('fs:read')?.definition.name).toBe('fs:read');
    expect(registry.get('list')).toBeUndefined();
  });

  it('includes MCP tools in getAllDefinitions', () => {
    const registry = new ToolRegistry();
    registry.register(mockTool('bash'));
    registry.registerMcpTools('fs', [mockTool('list')]);

    const defs = registry.getAllDefinitions();
    expect(defs).toHaveLength(2);
    expect(defs.map((d) => d.name)).toContain('bash');
    expect(defs.map((d) => d.name)).toContain('fs:list');
  });
});
