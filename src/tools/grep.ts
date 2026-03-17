import { execSync } from 'node:child_process';
import type { Tool } from './interface.js';

export const grepTool: Tool = {
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
    const maxResults = (input.max_results as number) ?? 50;

    try {
      const args = ['-rn', '--color=never'];
      if (glob) args.push(`--include=${glob}`);
      args.push('-m', String(maxResults));
      args.push('-E', pattern, searchPath);

      const result = execSync(`grep ${args.map((a) => `'${a}'`).join(' ')}`, {
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        timeout: 10000,
      }).trim();

      return { content: result || 'No matches found.' };
    } catch (err) {
      const exitCode = (err as { status?: number }).status;
      if (exitCode === 1) return { content: 'No matches found.' };
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
  },
};
