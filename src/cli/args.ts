import { Command } from 'commander';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve package.json relative to this file at runtime (works for both src/ and dist/)
const _dir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = (() => {
  // Try parent dirs until we find package.json
  for (const rel of ['../package.json', '../../package.json']) {
    try { return require(resolve(_dir, rel)); } catch { /* skip */ }
  }
  return { name: 'copair', version: process.env['COPAIR_VERSION'] ?? '0.0.0-dev' };
})();

export interface CliOptions {
  model?: string;
  config?: string;
  verbose: boolean;
  debug: boolean;
  resume?: string | true;
  /** Explicit small-model override: true = force on, false = force off, undefined = auto-detect. */
  smallModel?: boolean;
  /** Spec 029: when set, print resolved model capabilities and exit. */
  explainModel?: string;
  /** Companion flag for --explain-model; emits single-line JSON instead of pretty-print. */
  json?: boolean;

  // ── Headless mode (spec 047) ──
  /** Run non-interactively: prompt in, structured result JSON out, no TTY. */
  headless: boolean;
  /** Task prompt positional. Legal only with --headless (gated below). */
  task?: string;
  /** Read the task prompt from a file (headless-only). */
  file?: string;
  /** Approve ALL tool actions without prompting (headless-only, sandbox use). */
  autoApprove: boolean;
  /** Write the mechanism-event JSONL stream to this path (headless-only). */
  events?: string;
  /** Cap tool calls for the run (headless-only). */
  maxToolCalls?: number;
  /** Cap total tokens for the run (headless-only). */
  maxTokens?: number;
  /** Working directory for the run (headless-only). */
  cwd?: string;
  /** Ignore global + project config; defaults + -c + flags only (headless-only). */
  isolated: boolean;
  /** Suppress human-readable streaming on stderr (headless-only). */
  quiet: boolean;
}

/** Parse an integer CLI option value; returns NaN on bad input (gating validates). */
function parseIntArg(value: string): number {
  return Number.parseInt(value, 10);
}

export function parseArgs(argv: string[] = process.argv, versionString?: string): CliOptions {
  const program = new Command();

  program
    .name('copair')
    .description('Model-agnostic AI coding agent for the terminal')
    .version(versionString ?? pkg.version, '-v, --version')
    .option('-m, --model <name>', 'Model to use (overrides config default)')
    .option('-c, --config <path>', 'Path to config file')
    .option('--verbose', 'Enable verbose logging (WARN + INFO)', false)
    .option('--debug', 'Enable debug logging (all levels)', false)
    .option('--resume [identifier]', 'Resume a previous session (use "latest" for most recent)')
    .option('--small-model', 'Force small-model mode on for this session')
    .option('--no-small-model', 'Force small-model mode off for this session')
    .option(
      '--explain-model <id>',
      'Print resolved capabilities for a model ID and exit (does not start a session)',
    )
    .option('--json', 'When used with --explain-model, emit single-line JSON instead of pretty-print')
    // ── Headless mode (spec 047) ──
    .argument('[task]', 'Task prompt for headless mode (requires --headless)')
    .option('--headless', 'Run non-interactively: prompt in, result JSON out, no TTY', false)
    .option('-f, --file <path>', 'Read the task prompt from a file (headless-only)')
    .option('--auto-approve', 'Approve all tool actions without prompting (headless-only; sandbox use)', false)
    .option('--events <path>', 'Write mechanism-event JSONL to this path (headless-only)')
    .option('--max-tool-calls <n>', 'Cap tool calls for the run (headless-only)', parseIntArg)
    .option('--max-tokens <n>', 'Cap total tokens for the run (headless-only)', parseIntArg)
    .option('--cwd <path>', 'Working directory for the run (headless-only)')
    .option('--isolated', 'Ignore global + project config; defaults + -c + flags only (headless-only)', false)
    .option('--quiet', 'Suppress human-readable streaming on stderr (headless-only)', false)
    .parse(argv);

  const opts = program.opts();
  // `.argument('[task]')` lands the operand in processedArgs; fall back to the
  // raw operand list for commander versions that don't populate it without an
  // action handler.
  const task = (program.processedArgs?.[0] ?? program.args?.[0]) as string | undefined;

  // commander sets smallModel=true for --small-model, false for --no-small-model,
  // and undefined when neither flag is given.
  let smallModel: boolean | undefined;
  if (opts.smallModel === true) smallModel = true;
  else if (opts.smallModel === false) smallModel = false;

  return {
    model: opts.model,
    config: opts.config,
    verbose: opts.verbose || opts.debug,
    debug: opts.debug || process.env.DEBUG === 'copair',
    resume: opts.resume,
    smallModel,
    explainModel: opts.explainModel,
    json: opts.json,
    headless: opts.headless === true,
    task,
    file: opts.file,
    autoApprove: opts.autoApprove === true,
    events: opts.events,
    maxToolCalls: opts.maxToolCalls,
    maxTokens: opts.maxTokens,
    cwd: opts.cwd,
    isolated: opts.isolated === true,
    quiet: opts.quiet === true,
  };
}

/**
 * Flag-gating guard (spec 047, T-04). The headless-only surface — the `[task]`
 * positional and every headless-only flag — is illegal without `--headless`.
 * Returns a human-readable error string when the combination is invalid, or
 * `null` when it's fine. Kept pure (no process.exit) so it's unit-testable;
 * the caller decides how to surface the error.
 *
 * This preserves US-4: an interactive invocation can never silently acquire
 * headless semantics, and a headless-only flag never silently no-ops.
 */
export function validateHeadlessGating(opts: CliOptions): string | null {
  if (opts.headless) {
    // Numeric flags must be positive integers when supplied.
    for (const [name, value] of [
      ['--max-tool-calls', opts.maxToolCalls],
      ['--max-tokens', opts.maxTokens],
    ] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
        return `${name} requires a positive integer`;
      }
    }
    return null;
  }

  const offenders: string[] = [];
  if (opts.task !== undefined) offenders.push('a task argument');
  if (opts.file !== undefined) offenders.push('--file');
  if (opts.autoApprove) offenders.push('--auto-approve');
  if (opts.events !== undefined) offenders.push('--events');
  if (opts.maxToolCalls !== undefined) offenders.push('--max-tool-calls');
  if (opts.maxTokens !== undefined) offenders.push('--max-tokens');
  if (opts.cwd !== undefined) offenders.push('--cwd');
  if (opts.isolated) offenders.push('--isolated');
  if (opts.quiet) offenders.push('--quiet');

  if (offenders.length > 0) {
    return `${offenders.join(', ')} ${offenders.length === 1 ? 'is' : 'are'} only valid with --headless`;
  }
  return null;
}
