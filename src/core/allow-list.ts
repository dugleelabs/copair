import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, normalize, sep } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Path-level permissions — model-agnostic.
 * Applies regardless of which tool the model uses (read, bash cat, grep, etc.).
 * write permission implies read.
 */
export interface PathPermissions {
  read:  string[];
  write: string[];
}

export interface AllowRules {
  /** bash entries: exact match, or prefix if the pattern ends with " *" */
  bash: string[];
  /**
   * git entries: matched against the args string.
   * Entry is the subcommand (e.g. "diff") — covers all flags for that subcommand.
   */
  git: string[];
  /**
   * Tool-specific read/write/edit entries (kept for backward-compat and
   * fine-grained tool control). For multi-model setups, prefer `paths:`.
   */
  read:  string[];
  write: string[];
  edit:  string[];
  /**
   * Path-level permissions — the preferred way to allow cross-repo access.
   * Works regardless of which tool the model chooses to use for an operation.
   *
   * Example allow.yaml:
   *   paths:
   *     read:
   *       - "../../other-repo/**"
   *     write:
   *       - "../../shared-output/**"
   */
  paths: PathPermissions;
}

// ── AllowList ────────────────────────────────────────────────────────────────

export class AllowList {
  private rules: AllowRules;

  constructor(rules: Partial<AllowRules> = {}) {
    this.rules = {
      bash:  rules.bash  ?? [],
      git:   rules.git   ?? [],
      read:  rules.read  ?? [],
      write: rules.write ?? [],
      edit:  rules.edit  ?? [],
      paths: {
        read:  rules.paths?.read  ?? [],
        write: rules.paths?.write ?? [],
      },
    };
  }

  /**
   * Returns true when the operation is explicitly listed and should bypass
   * the approval prompt. Called by ApprovalGate before prompting.
   *
   * Check order per tool:
   *   1. Tool-specific entries (bash:, git:, read:, write:, edit:) — fine-grained
   *   2. Path-level entries (paths.read / paths.write) — model-agnostic
   */
  matches(toolName: string, input: Record<string, unknown>): boolean {
    switch (toolName) {
      case 'bash':
        // Tool-specific entries checked first, then path-level
        return this.matchBash(input) || this.matchBashByPath(input);

      case 'git':
        return this.matchGit(input);

      case 'read':
      case 'glob':
      case 'grep': {
        const filePath = input.file_path ?? input.path ?? input.pattern;
        // Tool-specific read entries
        if (this.matchPath(this.rules.read, filePath)) return true;
        // Path-level: paths.read + paths.write (write implies read)
        return this.matchPathAgainstPermissions('read', filePath);
      }

      case 'write':
        if (this.matchPath(this.rules.write, input.file_path)) return true;
        return this.matchPathAgainstPermissions('write', input.file_path);

      case 'edit':
        if (this.matchPath(this.rules.edit, input.file_path)) return true;
        return this.matchPathAgainstPermissions('write', input.file_path);

      default:
        return false;
    }
  }

  // ── Matchers ──────────────────────────────────────────────────────────────

  private matchBash(input: Record<string, unknown>): boolean {
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    for (const pattern of this.rules.bash) {
      if (pattern.endsWith(' *')) {
        const prefix = pattern.slice(0, -2).trimEnd();
        if (command === prefix || command.startsWith(prefix + ' ')) return true;
      } else {
        if (command === pattern.trim()) return true;
      }
    }
    return false;
  }

  /**
   * Path-level bash matching: extract path tokens from the command, classify
   * as read or write intent, then check against paths.read / paths.write.
   * All path tokens in the command must be covered for the check to pass.
   */
  private matchBashByPath(input: Record<string, unknown>): boolean {
    const command = typeof input.command === 'string' ? input.command : '';
    if (!command) return false;

    const tokens = extractBashPathTokens(command);
    if (tokens.length === 0) return false;

    const isWrite = isBashWriteCommand(command);
    const cwd = process.cwd();

    return tokens.every((token) => {
      const abs = resolveWithRealpath(token, cwd);
      return isWrite
        ? this.rules.paths.write.some((p) => globMatch(resolveWithRealpath(p, cwd), abs))
        : [...this.rules.paths.read, ...this.rules.paths.write]
            .some((p) => globMatch(resolveWithRealpath(p, cwd), abs));
    });
  }

  private matchGit(input: Record<string, unknown>): boolean {
    const args = typeof input.args === 'string' ? input.args.trim() : '';
    const subcommand = args.split(/\s+/)[0].toLowerCase();
    return this.rules.git.some((entry) => entry.trim().toLowerCase() === subcommand);
  }

  private matchPath(patterns: string[], filePath: unknown): boolean {
    if (typeof filePath !== 'string') return false;
    const cwd = process.cwd();
    const absPath = resolveWithRealpath(filePath, cwd);
    return patterns.some((pattern) => globMatch(resolveWithRealpath(pattern, cwd), absPath));
  }

  /**
   * Check filePath against paths.read or paths.write (write implies read).
   */
  private matchPathAgainstPermissions(
    operation: 'read' | 'write',
    filePath: unknown,
  ): boolean {
    if (typeof filePath !== 'string') return false;
    const cwd = process.cwd();
    const absPath = resolveWithRealpath(filePath, cwd);

    const patterns =
      operation === 'read'
        ? [...this.rules.paths.read, ...this.rules.paths.write]
        : this.rules.paths.write;

    return patterns.some((p) => globMatch(resolveWithRealpath(p, cwd), absPath));
  }
}

// ── Bash helpers (module-private) ────────────────────────────────────────────

const BASH_PATH_TOKEN_RE = /(?:^|\s)((?:\/|\.\.?\/|~\/)[^\s'";&|<>]+)/g;

/** Extract filesystem path tokens from a bash command string. */
function extractBashPathTokens(command: string): string[] {
  const tokens: string[] = [];
  BASH_PATH_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BASH_PATH_TOKEN_RE.exec(command)) !== null) tokens.push(m[1]);
  return tokens;
}

/**
 * Heuristic: does this bash command perform a write operation?
 * Covers output redirection, common write-class commands, and in-place edits.
 */
function isBashWriteCommand(command: string): boolean {
  if (/(?<![<])[>]/.test(command)) return true;
  if (/\b(tee|mv|cp|rm|rmdir|mkdir|touch|chmod|chown|install|rsync|patch)\b/.test(command)) return true;
  if (/\bsed\b[^|&;]*-i\b/.test(command)) return true;
  return false;
}

// ── Path helpers (module-private) ────────────────────────────────────────────

/**
 * Resolve `raw` to an absolute path and follow symlinks on the existing
 * directory prefix. For glob patterns, only the prefix up to the first
 * wildcard is realpath'd — the glob tail is preserved verbatim.
 */
function resolveWithRealpath(raw: string, cwd: string): string {
  // normalize() collapses `..` and `.` segments lexically so that paths like
  // "/cwd/proj/../sibling/file" become "/cwd/sibling/file" before we attempt
  // realpathSync. This is critical for models (e.g. Qwen) that construct
  // absolute paths via cwd + relative traversal without pre-normalizing.
  const abs = normalize(resolve(cwd, raw));
  const globIndex = abs.search(/[*?]/);
  if (globIndex < 0) {
    try { return realpathSync(abs); } catch { return abs; }
  }
  const sepBeforeGlob = abs.lastIndexOf(sep, globIndex);
  if (sepBeforeGlob <= 0) return abs;
  const basePath = abs.slice(0, sepBeforeGlob);
  const tail = abs.slice(sepBeforeGlob);
  try { return realpathSync(basePath) + tail; } catch { return abs; }
}

// ── Glob matching ─────────────────────────────────────────────────────────────

function globMatch(pattern: string, path: string): boolean {
  // Normalize path separators to '/' so [^/] in the regex correctly excludes
  // segment boundaries on both POSIX and Windows. realpathSync/resolve return
  // backslash-separated paths on Windows; without normalization, '*' would
  // match across directory boundaries (e.g. 'src/*.ts' matching 'src\foo\bar.ts').
  return globToRegex(pattern.replace(/\\/g, '/')).test(path.replace(/\\/g, '/'));
}

function globToRegex(pattern: string): RegExp {
  let src = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      src += '.*';
      i += 2;
      if (pattern[i] === '/') i++;
    } else if (pattern[i] === '*') {
      src += '[^/]*';
      i++;
    } else {
      src += pattern[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^${src}$`);
}

// ── Loader ───────────────────────────────────────────────────────────────────

const ALLOW_FILE = 'allow.yaml';

export function loadAllowList(projectDir?: string): AllowList {
  const globalPath  = resolve(homedir(), '.copair', ALLOW_FILE);
  const projectPath = resolve(projectDir ?? process.cwd(), '.copair', ALLOW_FILE);

  const global  = readAllowFile(globalPath);
  const project = readAllowFile(projectPath);

  return new AllowList({
    bash:  [...(global.bash  ?? []), ...(project.bash  ?? [])],
    git:   [...(global.git   ?? []), ...(project.git   ?? [])],
    read:  [...(global.read  ?? []), ...(project.read  ?? [])],
    write: [...(global.write ?? []), ...(project.write ?? [])],
    edit:  [...(global.edit  ?? []), ...(project.edit  ?? [])],
    paths: {
      read:  [...(global.paths?.read  ?? []), ...(project.paths?.read  ?? [])],
      write: [...(global.paths?.write ?? []), ...(project.paths?.write ?? [])],
    },
  });
}

function readAllowFile(filePath: string): Partial<AllowRules> {
  if (!existsSync(filePath)) return {};
  try {
    const raw = parseYaml(readFileSync(filePath, 'utf-8'));
    if (raw == null || typeof raw !== 'object') return {};
    const rules = raw as Record<string, unknown>;
    const pathsRaw =
      rules.paths != null && typeof rules.paths === 'object'
        ? (rules.paths as Record<string, unknown>)
        : {};
    return {
      bash:  toStringArray(rules.bash),
      git:   toStringArray(rules.git),
      read:  toStringArray(rules.read),
      write: toStringArray(rules.write),
      edit:  toStringArray(rules.edit),
      paths: {
        read:  toStringArray(pathsRaw.read),
        write: toStringArray(pathsRaw.write),
      },
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
