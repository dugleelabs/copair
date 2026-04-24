import { execSync } from 'node:child_process';
import { z } from 'zod';
import type { Tool } from './interface.js';

/**
 * Paths that, when referenced in a bash command, warrant a visible warning
 * before the approval prompt. These are credential or system paths outside
 * the project root that the user should consciously approve.
 */
export const SENSITIVE_PATH_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: '~/.ssh/', pattern: /~\/\.ssh\b/ },
  { name: '~/.aws/', pattern: /~\/\.aws\b/ },
  { name: '~/.gnupg/', pattern: /~\/\.gnupg\b/ },
  { name: '/etc/', pattern: /\/etc\// },
  { name: '/private/', pattern: /\/private\// },
  { name: '~/.config/', pattern: /~\/\.config\b/ },
  { name: '~/.netrc', pattern: /~\/\.netrc\b/ },
  { name: '~/.npmrc', pattern: /~\/\.npmrc\b/ },
  { name: '~/.pypirc', pattern: /~\/\.pypirc\b/ },
];

/**
 * Regex that captures path-like tokens from a bash command string.
 * Matches tokens starting with /, ./, ../, or ~/ that are not followed by
 * shell metacharacters. Intentionally heuristic — false positives result in
 * a gate prompt, not a silent bypass.
 */
const PATH_TOKEN_RE = /(?:^|\s)((?:\/|\.\.?\/|~\/)[^\s'";&|<>]+)/g;

/**
 * Extract path-like tokens from a bash command string.
 * Used by the tool executor to check whether a bash command references
 * paths outside the project root before the approval gate fires.
 */
export function extractPathTokens(command: string): string[] {
  const tokens: string[] = [];
  PATH_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_TOKEN_RE.exec(command)) !== null) {
    tokens.push(m[1]);
  }
  return tokens;
}

/**
 * Scan a bash command string for references to sensitive system paths.
 * Returns the names of all matched patterns (empty array = no matches).
 */
export function detectSensitivePaths(command: string): string[] {
  return SENSITIVE_PATH_PATTERNS
    .filter(({ pattern }) => pattern.test(command))
    .map(({ name }) => name);
}

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
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
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
