import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Tool } from './interface.js';

export const WriteInputSchema = z.object({
  file_path: z.string().min(1),
  content: z.string(),
}).strict();

export const writeTool: Tool = {
  inputSchema: WriteInputSchema,
  definition: {
    name: 'write',
    description: 'Write content to a file (creates parent directories if needed)',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['file_path', 'content'],
    },
  },
  requiresPermission: true,
  async execute(input) {
    const filePath = input.file_path as string;
    const content = input.content as string;

    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf-8');
      return { content: `File written: ${filePath}` };
    } catch (err) {
      return { content: `Error writing file: ${(err as Error).message}`, isError: true };
    }
  },
};
