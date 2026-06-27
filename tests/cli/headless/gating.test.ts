/**
 * Unit tests — headless flag gating (spec 047, T-04 / T-16 regression).
 *
 * The `[task]` positional and every headless-only flag MUST error without
 * `--headless` (US-4: an interactive invocation can never silently acquire
 * headless semantics). These also lock the parser→options wiring.
 */
import { describe, it, expect } from 'vitest';
import { parseArgs, validateHeadlessGating, type CliOptions } from '../../../src/cli/args.js';

/** A minimal valid (interactive) CliOptions with all booleans defaulted off. */
function base(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    verbose: false,
    debug: false,
    headless: false,
    autoApprove: false,
    isolated: false,
    quiet: false,
    ...overrides,
  };
}

describe('validateHeadlessGating — without --headless', () => {
  const offenders: Array<[string, Partial<CliOptions>]> = [
    ['a task argument', { task: 'do the thing' }],
    ['--file', { file: '/tmp/task.txt' }],
    ['--auto-approve', { autoApprove: true }],
    ['--events', { events: '/tmp/e.jsonl' }],
    ['--max-tool-calls', { maxToolCalls: 5 }],
    ['--max-tokens', { maxTokens: 1000 }],
    ['--cwd', { cwd: '/tmp' }],
    ['--isolated', { isolated: true }],
    ['--quiet', { quiet: true }],
  ];

  it.each(offenders)('rejects %s', (label, overrides) => {
    const err = validateHeadlessGating(base(overrides));
    expect(err).not.toBeNull();
    expect(err).toContain('only valid with --headless');
  });

  it('passes a clean interactive invocation', () => {
    expect(validateHeadlessGating(base())).toBeNull();
    expect(validateHeadlessGating(base({ model: 'gpt-4' }))).toBeNull();
  });

  it('lists every offender when several are combined', () => {
    const err = validateHeadlessGating(base({ file: '/t', quiet: true, isolated: true }));
    expect(err).toContain('--file');
    expect(err).toContain('--quiet');
    expect(err).toContain('--isolated');
    expect(err).toContain('are only valid');
  });
});

describe('validateHeadlessGating — with --headless', () => {
  it('accepts the full headless surface', () => {
    const opts = base({
      headless: true,
      task: 'fix the bug',
      autoApprove: true,
      events: '/tmp/e.jsonl',
      maxToolCalls: 10,
      maxTokens: 5000,
      cwd: '/tmp',
      isolated: true,
      quiet: true,
    });
    expect(validateHeadlessGating(opts)).toBeNull();
  });

  it('rejects non-positive / non-integer numeric caps', () => {
    expect(validateHeadlessGating(base({ headless: true, maxToolCalls: 0 }))).toMatch(
      /max-tool-calls/,
    );
    expect(validateHeadlessGating(base({ headless: true, maxTokens: -1 }))).toMatch(/max-tokens/);
    expect(validateHeadlessGating(base({ headless: true, maxTokens: NaN }))).toMatch(/max-tokens/);
  });
});

describe('parseArgs — headless surface wiring', () => {
  const argv = (args: string[]) => ['node', 'copair', ...args];

  it('lands the positional task and sets headless', () => {
    const opts = parseArgs(argv(['--headless', 'fix the bug']));
    expect(opts.headless).toBe(true);
    expect(opts.task).toBe('fix the bug');
  });

  it('parses every headless-only flag', () => {
    const opts = parseArgs(
      argv([
        '--headless',
        '--file',
        '/tmp/t.txt',
        '--auto-approve',
        '--events',
        '/tmp/e.jsonl',
        '--max-tool-calls',
        '7',
        '--max-tokens',
        '2048',
        '--cwd',
        '/work',
        '--isolated',
        '--quiet',
      ]),
    );
    expect(opts).toMatchObject({
      headless: true,
      file: '/tmp/t.txt',
      autoApprove: true,
      events: '/tmp/e.jsonl',
      maxToolCalls: 7,
      maxTokens: 2048,
      cwd: '/work',
      isolated: true,
      quiet: true,
    });
  });

  it('leaves the headless surface unset for a plain interactive invocation', () => {
    const opts = parseArgs(argv([]));
    expect(opts.headless).toBe(false);
    expect(opts.task).toBeUndefined();
    expect(opts.autoApprove).toBe(false);
    expect(opts.isolated).toBe(false);
    expect(opts.quiet).toBe(false);
  });
});
