import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import type { Tool } from './interface.js';

export const EditInputSchema = z.object({
  file_path: z.string().min(1),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
}).strict();

export const editTool: Tool = {
  inputSchema: EditInputSchema,
  definition: {
    name: 'edit',
    description: 'Replace an exact string in a file. The old_string must be unique in the file.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        old_string: { type: 'string', description: 'Exact text to find and replace' },
        new_string: { type: 'string', description: 'Replacement text' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  requiresPermission: true,
  async execute(input) {
    const filePath = input.file_path as string;
    const oldString = input.old_string as string;
    const newString = input.new_string as string;

    if (!existsSync(filePath)) {
      return { content: `Error: File not found: ${filePath}`, isError: true };
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const occurrences = content.split(oldString).length - 1;

      if (occurrences === 0) {
        return { content: 'Error: old_string not found in file', isError: true };
      }
      if (occurrences > 1) {
        return {
          content: `Error: old_string found ${occurrences} times — must be unique. Provide more context.`,
          isError: true,
        };
      }

      const updated = content.replace(oldString, newString);
      writeFileSync(filePath, updated, 'utf-8');
      return { content: `File edited: ${filePath}` };
    } catch (err) {
      return { content: `Error editing file: ${(err as Error).message}`, isError: true };
    }
  },
};
