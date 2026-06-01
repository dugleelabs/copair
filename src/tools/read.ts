import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import type { Tool, ToolEvent } from './interface.js';

/**
 * Spec 029 F-15b (design §21.2.1): the maximum file size, in lines, that
 * `read` will surface without an explicit `limit` arg. When exceeded, read
 * returns a structured `[overflow]` error instead of silent partial content —
 * lying about what the model received causes premature task_complete on
 * missing info. Tunable via `config.tools.read.overflow_lines` (T-J07)
 * through `setReadOverflowLines`.
 */
let READ_OVERFLOW_LINES = 1500;

export function setReadOverflowLines(n: number): void {
  READ_OVERFLOW_LINES = n;
}

export const ReadInputSchema = z.object({
  file_path: z.string().min(1),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
}).strict();

export const readTool: Tool = {
  inputSchema: ReadInputSchema,
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

      // Spec 029 F-15b: refuse to surface a large file without an explicit
      // `limit`. Returns a model-readable `[overflow]` error so the model
      // gets a clear "retry with a range" signal instead of silent partial
      // content. With an explicit `limit`, honour it — never refuse beyond
      // what the user asked for.
      if (limit === undefined && lines.length > READ_OVERFLOW_LINES) {
        const events: ToolEvent[] = [
          { kind: 'read_overflow', filePath, lineCount: lines.length },
        ];
        return {
          content:
            `[overflow] File "${filePath}" has ${lines.length} lines, which exceeds the read overflow threshold (${READ_OVERFLOW_LINES}). ` +
            `Pass \`limit\` (and optionally \`offset\`) to read a range — e.g. ` +
            '`{ limit: 500 }` or `{ offset: 1000, limit: 500 }`.',
          isError: true,
          events,
        };
      }

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
