import { execSync } from 'node:child_process';
import { z } from 'zod';
import type { Tool } from './interface.js';
import type { IdentityConfig } from '../config/schema.js';

export const GitInputSchema = z.object({
  args: z.string().min(1),
  cwd: z.string().min(1).optional(),
}).strict();

const DEFAULT_IDENTITY: IdentityConfig = {
  name: 'Copair',
  email: 'copair[bot]@noreply.dugleelabs.io',
};

/**
 * For commit operations, append a Co-authored-by trailer so that Copair is
 * credited alongside the original commit author. Uses `git commit --trailer`
 * (Git 2.32+). Idempotent — skips if the trailer is already present.
 */
function addCoAuthorTrailer(args: string, identity: IdentityConfig): string {
  if (!/^commit\b/.test(args.trim())) return args;
  if (args.includes('Co-authored-by:')) return args;
  return `${args} --trailer "Co-authored-by: ${identity.name} <${identity.email}>"`;
}

/** Strip unsafe flags that models sometimes hallucinate. */
function sanitizeArgs(args: string): string {
  return args
    .replace(/--no-verify\b/g, '')
    .replace(/--no-gpg-sign\b/g, '')
    .replace(/--force\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createGitTool(identity: IdentityConfig = DEFAULT_IDENTITY): Tool {
  return {
    inputSchema: GitInputSchema,
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
      const args = sanitizeArgs(addCoAuthorTrailer(input.args as string, identity));
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
}

/** Convenience singleton with default identity — used when no config is available. */
export const gitTool: Tool = createGitTool();
