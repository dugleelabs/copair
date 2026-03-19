import { readFileSync, existsSync } from 'node:fs';
import type { Tool } from './interface.js';

export const readTool: Tool = {
  definition: {
    name: 'read',
    description: 'Read the contents of a file',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        offset: { type: 'number', description: 'Line number to start reading from (1-based)' },
        limit: { type: 'number', description: 'Number of lines to read' },
      },
      required: ['file_path'],
    },
  },
  requiresPermission: false,
  async execute(input) {
    const filePath = input.file_path as string;
    const offset = (input.offset as number) ?? 1;
    const limit = input.limit as number | undefined;

    if (!existsSync(filePath)) {
      return { content: `Error: File not found: ${filePath}. Working directory is ${process.cwd()}/ — use absolute paths.`, isError: true };
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const startIdx = Math.max(0, offset - 1);
      const sliced = limit ? lines.slice(startIdx, startIdx + limit) : lines.slice(startIdx);

      const numbered = sliced
        .map((line, i) => `${(startIdx + i + 1).toString().padStart(6)}  ${line}`)
        .join('\n');

      return { content: numbered };
    } catch (err) {
      return { content: `Error reading file: ${(err as Error).message}`, isError: true };
    }
  },
};
