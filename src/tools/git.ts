import { execSync } from 'node:child_process';
import type { Tool } from './interface.js';

export const gitTool: Tool = {
  definition: {
    name: 'git',
    description: 'Execute a git command (status, diff, log, commit, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        args: { type: 'string', description: 'Git arguments (e.g., "status", "diff --cached")' },
        cwd: { type: 'string', description: 'Working directory (defaults to cwd)' },
      },
      required: ['args'],
    },
  },
  requiresPermission: true,
  async execute(input) {
    const args = input.args as string;
    const cwd = (input.cwd as string) ?? process.cwd();

    try {
      const result = execSync(`git ${args}`, {
        encoding: 'utf-8',
        cwd,
        maxBuffer: 5 * 1024 * 1024,
        timeout: 30000,
      });
      return { content: result };
    } catch (err) {
      const execErr = err as { stdout?: string; stderr?: string; status?: number };
      const output = [execErr.stdout ?? '', execErr.stderr ?? '']
        .filter(Boolean)
        .join('\n');
      return { content: output || `git ${args} failed`, isError: true };
    }
  },
};
