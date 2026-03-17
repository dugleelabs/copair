import { execSync } from 'node:child_process';
import type { AgentContext } from './interface.js';

/**
 * Interpolates {{varName}} template expressions in a string.
 *
 * Variable sources (in resolution order):
 * 1. args — command arguments passed by the user
 * 2. env.VAR_NAME — environment variables
 * 3. Context variables: {{model}}, {{cwd}}, {{branch}}
 */
export async function interpolate(
  template: string,
  args: Record<string, string>,
  context: AgentContext,
): Promise<string> {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const trimmed = key.trim();

    // env.VAR_NAME
    if (trimmed.startsWith('env.')) {
      const envKey = trimmed.slice(4);
      return process.env[envKey] ?? '';
    }

    // Context variables
    if (trimmed === 'model') return context.model;
    if (trimmed === 'cwd') return context.cwd;
    if (trimmed === 'branch') return context.branch ?? detectBranch(context.cwd);

    // Command arguments
    if (trimmed in args) return args[trimmed];

    // Unresolved — leave as-is
    return _match;
  });
}

function detectBranch(cwd: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}
