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
  const resolve = (key: string): string | null => {
    // env.VAR_NAME
    if (key.startsWith('env.')) {
      return process.env[key.slice(4)] ?? '';
    }

    // Context variables
    if (key === 'model') return context.model;
    if (key === 'cwd') return context.cwd;
    if (key === 'branch') return context.branch ?? detectBranch(context.cwd);

    // Command arguments
    if (key in args) return args[key];

    return null;
  };

  // Replace {{var}} syntax (copair native)
  let result = template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    return resolve(key.trim()) ?? _match;
  });

  // Replace $VAR syntax (Claude Code convention) — uppercase + underscore identifiers only
  result = result.replace(/\$([A-Z][A-Z0-9_]*)/g, (_match, key: string) => {
    return resolve(key) ?? _match;
  });

  return result;
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
