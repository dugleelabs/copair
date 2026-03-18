import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AllowRules {
  /** bash entries: exact match, or prefix if the pattern ends with " *" */
  bash: string[];
  /**
   * git entries: matched against the args string.
   * Entry is the subcommand (e.g. "diff") — automatically covers all
   * flags for that subcommand (e.g. "diff --cached", "diff HEAD~1").
   */
  git: string[];
  /**
   * write / edit entries: glob patterns matched against the file path.
   * Supports * (within a segment) and ** (across segments).
   */
  write: string[];
  edit: string[];
}

// ── AllowList ────────────────────────────────────────────────────────────────

export class AllowList {
  private rules: AllowRules;

  constructor(rules: Partial<AllowRules> = {}) {
    this.rules = {
      bash:  rules.bash  ?? [],
      git:   rules.git   ?? [],
      write: rules.write ?? [],
      edit:  rules.edit  ?? [],
    };
  }

  /**
   * Returns true when the operation is explicitly listed and should bypass
   * the approval prompt. Called by ApprovalGate before prompting.
   */
  matches(toolName: string, input: Record<string, unknown>): boolean {
    switch (toolName) {
      case 'bash':  return this.matchBash(input);
      case 'git':   return this.matchGit(input);
      case 'write': return this.matchPath(this.rules.write, input.file_path);
      case 'edit':  return this.matchPath(this.rules.edit,  input.file_path);
      default:      return false;
    }
  }

  // ── Matchers ──────────────────────────────────────────────────────────────

  private matchBash(input: Record<string, unknown>): boolean {
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    for (const pattern of this.rules.bash) {
      if (pattern.endsWith(' *')) {
        // Prefix match: "npm run *" matches "npm run test", "npm run lint", …
        const prefix = pattern.slice(0, -2).trimEnd();
        if (command === prefix || command.startsWith(prefix + ' ')) return true;
      } else {
        // Exact match: "npm test" matches only "npm test"
        if (command === pattern.trim()) return true;
      }
    }
    return false;
  }

  private matchGit(input: Record<string, unknown>): boolean {
    const args = typeof input.args === 'string' ? input.args.trim() : '';
    const subcommand = args.split(/\s+/)[0].toLowerCase();
    return this.rules.git.some((entry) => entry.trim().toLowerCase() === subcommand);
  }

  private matchPath(patterns: string[], filePath: unknown): boolean {
    if (typeof filePath !== 'string') return false;
    return patterns.some((pattern) => globMatch(pattern, filePath));
  }
}

// ── Loader ───────────────────────────────────────────────────────────────────

const ALLOW_FILE = 'allow.yaml';

/**
 * Loads allow.yaml from the global (~/.copair/) and project (.copair/)
 * directories and merges their entries. Project entries are appended to
 * global entries — they extend, never replace.
 */
export function loadAllowList(projectDir?: string): AllowList {
  const globalPath  = resolve(homedir(), '.copair', ALLOW_FILE);
  const projectPath = resolve(projectDir ?? process.cwd(), '.copair', ALLOW_FILE);

  const global  = readAllowFile(globalPath);
  const project = readAllowFile(projectPath);

  return new AllowList({
    bash:  [...(global.bash  ?? []), ...(project.bash  ?? [])],
    git:   [...(global.git   ?? []), ...(project.git   ?? [])],
    write: [...(global.write ?? []), ...(project.write ?? [])],
    edit:  [...(global.edit  ?? []), ...(project.edit  ?? [])],
  });
}

function readAllowFile(filePath: string): Partial<AllowRules> {
  if (!existsSync(filePath)) return {};
  try {
    const raw = parseYaml(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    return {
      bash:  toStringArray(raw.bash),
      git:   toStringArray(raw.git),
      write: toStringArray(raw.write),
      edit:  toStringArray(raw.edit),
    };
  } catch {
    process.stderr.write(`[copair] Warning: could not parse ${filePath}\n`);
    return {};
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

// ── Glob matching ─────────────────────────────────────────────────────────────
// Supports:  *   — any characters except path separator
//            **  — any characters including path separators
// Everything else is treated as a literal.

function globMatch(pattern: string, path: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(path);
}

function globToRegex(pattern: string): RegExp {
  let src = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      src += '.*';
      i += 2;
      // Consume optional trailing slash so "src/**" matches "src/foo/bar"
      if (pattern[i] === '/') i++;
    } else if (pattern[i] === '*') {
      src += '[^/]*';
      i++;
    } else {
      // Escape regex special chars
      src += pattern[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^${src}$`);
}
