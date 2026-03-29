import { execSync } from 'node:child_process';
import { z } from 'zod';
import type { Tool } from './interface.js';

export const BashInputSchema = z.object({
  command: z.string().min(1),
  timeout: z.number().int().positive().optional(),
}).strict();

export const bashTool: Tool = {
  inputSchema: BashInputSchema,
  definition: {
    name: 'bash',
    description: 'Execute a shell command',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 120000)' },
      },
      required: ['command'],
    },
  },
  requiresPermission: true,
  async execute(input) {
    const command = input.command as string;
    const timeout = (input.timeout as number) ?? 120000;

    try {
      const result = execSync(command, {
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
        timeout,
        shell: '/bin/bash',
      });
      return { content: result };
    } catch (err) {
      const execErr = err as { stdout?: string; stderr?: string; status?: number };
      const output = [
        execErr.stdout ?? '',
        execErr.stderr ?? '',
      ]
        .filter(Boolean)
        .join('\n');
      return {
        content: output || `Command failed with exit code ${execErr.status}`,
        isError: true,
      };
    }
  },
};
