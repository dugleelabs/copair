import { execSync } from 'node:child_process';
import { z } from 'zod';
import type { Tool, ToolEvent } from './interface.js';

/**
 * spec 029 (F-15b): default for `max_results` when the model doesn't pass one.
 * Tunable via `config.tools.grep.default_max_results`; the model can also pass
 * an explicit `max_results` per call.
 */
let GREP_DEFAULT_MAX_RESULTS = 50;

export function setGrepDefaultMaxResults(n: number): void {
  GREP_DEFAULT_MAX_RESULTS = n;
}

export const GrepInputSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1).optional(),
  glob: z.string().min(1).optional(),
  max_results: z.number().int().positive().optional(),
}).strict();

export const grepTool: Tool = {
  inputSchema: GrepInputSchema,
  definition: {
    name: 'grep',
    description: 'Search for a regex pattern in files',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'File or directory to search in (defaults to cwd)' },
        glob: { type: 'string', description: 'Glob pattern to filter files (e.g., "*.ts")' },
        max_results: { type: 'number', description: 'Maximum results to return (default: 50)' },
      },
      required: ['pattern'],
    },
  },
  requiresPermission: false,
  async execute(input) {
    const pattern = input.pattern as string;
    const searchPath = (input.path as string) ?? '.';
    const glob = input.glob as string | undefined;
    const maxResults = (input.max_results as number) ?? GREP_DEFAULT_MAX_RESULTS;

    try {
      // spec 029 (F-15b): ask grep for one extra line to detect overflow
      // without scanning the whole tree. `-m N` works on GNU and BSD grep.
      const args = ['-rn', '--color=never'];
      if (glob) args.push(`--include=${glob}`);
      args.push('-m', String(maxResults + 1));
      args.push('-E', pattern, searchPath);

      const result = execSync(`grep ${args.map((a) => `'${a}'`).join(' ')}`, {
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        timeout: 10000,
      });

      const lines = result.split('\n').filter(Boolean);
      const overflowed = lines.length > maxResults;
      const shown = overflowed ? lines.slice(0, maxResults) : lines;
      const output = shown.join('\n');

      if (overflowed) {
        const events: ToolEvent[] = [
          { kind: 'grep_overflow', pattern, maxResults },
        ];
        return {
          // isError stays unset — capped results are still actionable.
          content:
            output +
            `\n\n[overflow] More than ${maxResults} matches found (showing first ${maxResults}). ` +
            'Narrow your pattern or pass a higher `max_results`.',
          events,
        };
      }
      return { content: output || 'No matches found.' };
    } catch (err) {
      const exitCode = (err as { status?: number }).status;
      if (exitCode === 1) return { content: 'No matches found.' };
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
  },
};
