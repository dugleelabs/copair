import { execSync } from 'node:child_process';
import { z } from 'zod';
import type { Tool, ToolEvent } from './interface.js';
import { truncateMiddle } from './truncate.js';

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

/**
 * spec 029 (F-15b): token budget at which bash stdout/stderr gets head+tail
 * truncated. Tunable via `config.tools.bash.overflow_tokens`.
 */
let BASH_OVERFLOW_TOKENS = 4000;

export function setBashOverflowTokens(n: number): void {
  BASH_OVERFLOW_TOKENS = n;
}

/**
 * Truncate and label one stream. On truncation, append a recovery hint
 * (`head`/`tail`/`sed`/`grep`) — without it, small models proceed past the
 * marker as if it didn't matter. Returns `{ text, truncated }` so the caller
 * can emit a `bash_truncated` event.
 */
function maybeTruncateBashStream(
  text: string,
  label: 'stdout' | 'stderr',
): { text: string; truncated: boolean } {
  if (!text) return { text: '', truncated: false };
  const truncated = truncateMiddle(text, BASH_OVERFLOW_TOKENS);
  if (truncated === text) {
    return { text: `[${label}]\n${text}`, truncated: false };
  }
  return {
    text:
      `[${label}]\n${truncated}\n\n` +
      `[hint] ${label} exceeded ${BASH_OVERFLOW_TOKENS} tokens. Middle sections truncated. ` +
      `To see specific ranges, re-run with \`head -n N <cmd>\`, \`tail -n N <cmd>\`, ` +
      `\`<cmd> | sed -n 'A,Bp'\`, or pipe through \`grep\` to filter.`,
    truncated: true,
  };
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
      // spec 029 (F-15b): truncate the success path's stdout if over budget.
      const out = maybeTruncateBashStream(result, 'stdout');
      const events: ToolEvent[] = [];
      if (out.truncated) {
        events.push({ kind: 'bash_truncated', label: 'stdout', originalTokens: Math.round(result.length / 4) });
      }
      return { content: out.text || result, events: events.length ? events : undefined };
    } catch (err) {
      const execErr = err as { stdout?: string; stderr?: string; status?: number };
      // spec 029 (F-15b): truncate stdout and stderr independently so a huge
      // stderr can't squeeze out early stdout. Each emits its own event.
      const rawStdout = execErr.stdout ?? '';
      const rawStderr = execErr.stderr ?? '';
      const outPart = maybeTruncateBashStream(rawStdout, 'stdout');
      const errPart = maybeTruncateBashStream(rawStderr, 'stderr');
      const events: ToolEvent[] = [];
      if (outPart.truncated) {
        events.push({ kind: 'bash_truncated', label: 'stdout', originalTokens: Math.round(rawStdout.length / 4) });
      }
      if (errPart.truncated) {
        events.push({ kind: 'bash_truncated', label: 'stderr', originalTokens: Math.round(rawStderr.length / 4) });
      }
      const combined = [outPart.text, errPart.text].filter(Boolean).join('\n');
      return {
        content: combined || `Command failed with exit code ${execErr.status}`,
        isError: true,
        events: events.length ? events : undefined,
      };
    }
  },
};
