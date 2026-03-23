import { globSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Tool } from './interface.js';

export const globTool: Tool = {
  definition: {
    name: 'glob',
    description: 'Find files matching a glob pattern',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts")' },
        path: { type: 'string', description: 'Directory to search in (defaults to cwd)' },
      },
      required: ['pattern'],
    },
  },
  requiresPermission: false,
  async execute(input) {
    const pattern = input.pattern as string;
    const cwd = (input.path as string) ?? process.cwd();

    try {
      const matches = globSync(pattern, { cwd }).filter((m) => {
        try { return !statSync(resolve(cwd, m)).isDirectory(); } catch { return true; }
      });
      if (matches.length === 0) {
        return { content: `No files found matching "${pattern}" in ${cwd}` };
      }
      // Return absolute paths so models can pass them directly to read/edit
      const absolute = matches.map((m) => resolve(cwd, m)).sort();
      return { content: absolute.join('\n') };
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
  },
};
