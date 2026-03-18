import chalk from 'chalk';
import type { AllowList } from './allow-list.js';

export type RiskLevel = 'safe' | 'needs-approval';
export type GateMode = 'ask' | 'auto-approve' | 'deny';

/**
 * Static risk classification table.
 *
 * This is the source of truth for what requires approval. It lives here,
 * not in tool definitions, not in the agent, not anywhere the model can
 * reach. The agent cannot read this table, cannot influence it, and has
 * no signal about whether a call will be gated before it is submitted.
 */
const RISK_TABLE: Record<string, (input: Record<string, unknown>) => RiskLevel> = {
  // ── Read-only: never need approval ──────────────────────────────────────
  read: () => 'safe',
  glob: () => 'safe',
  grep: () => 'safe',

  // ── File mutations: always need approval ────────────────────────────────
  write: () => 'needs-approval',
  edit: () => 'needs-approval',

  // ── Arbitrary shell: always needs approval ──────────────────────────────
  bash: () => 'needs-approval',

  // ── Git: split by subcommand ────────────────────────────────────────────
  git: (input) => {
    const args = (typeof input.args === 'string' ? input.args : '').trim();
    const sub = args.split(/\s+/)[0].toLowerCase();
    // Read-only subcommands
    if (['status', 'diff', 'log', 'show', 'blame', 'shortlog',
         'describe', 'ls-files', 'remote'].includes(sub)) {
      return 'safe';
    }
    return 'needs-approval';
  },
};

export class ApprovalGate {
  private mode: GateMode;
  // Session-scoped always-allow overrides keyed by operation signature,
  // NOT by tool name alone — prevents "always allow git diff" from also
  // allowing "git commit".
  private alwaysAllow = new Set<string>();
  private allowList: AllowList | null;

  constructor(mode: GateMode = 'ask', allowList: AllowList | null = null) {
    this.mode = mode;
    this.allowList = allowList;
  }

  classify(toolName: string, input: Record<string, unknown>): RiskLevel {
    const fn = RISK_TABLE[toolName];
    // Unknown tool → conservative: require approval
    return fn ? fn(input) : 'needs-approval';
  }

  /**
   * Gate check. Called unconditionally before every tool execution.
   * Returns true if execution may proceed, false if denied.
   *
   * The agent never calls this. ToolExecutor calls it. The agent only
   * sees the resulting ExecutionResult.
   */
  async allow(toolName: string, input: Record<string, unknown>): Promise<boolean> {
    if (this.mode === 'deny') return false;
    if (this.classify(toolName, input) === 'safe') return true;
    if (this.mode === 'auto-approve') return true;

    // File-based allow list — pre-approved operations bypass the prompt
    if (this.allowList?.matches(toolName, input)) return true;

    const key = sessionKey(toolName, input);
    if (this.alwaysAllow.has(key)) return true;

    return this.prompt(toolName, input, key);
  }

  private async prompt(
    toolName: string,
    input: Record<string, unknown>,
    key: string,
  ): Promise<boolean> {
    const summary = formatSummary(toolName, input);
    const boxWidth = 56;
    const topBar = '─'.repeat(boxWidth);
    const pad = ' '.repeat(Math.max(0, boxWidth - summary.length - 2));

    process.stdout.write('\n');
    process.stdout.write(chalk.yellow(`  ┌─ ⚠  Approval required ${'─'.repeat(Math.max(0, boxWidth - 23))}┐\n`));
    process.stdout.write(chalk.yellow('  │  ') + chalk.white.bold(summary) + chalk.yellow(`${pad}  │\n`));
    process.stdout.write(chalk.yellow(`  └${topBar}┘\n`));
    process.stdout.write(
      `  ${chalk.green('[y]')} allow   ${chalk.cyan('[a]')} always   ${chalk.red('[n]')} deny  ${chalk.yellow('›')} `,
    );

    const answer = await ask();
    if (answer === null) {
      // Stream closed or Ctrl+C during prompt — treat as deny
      process.stdout.write(chalk.red('\n  ✗ Denied (interrupted).\n\n'));
      return false;
    }

    const trimmed = answer.toLowerCase().trim();

    if (trimmed === 'a' || trimmed === 'always') {
      this.alwaysAllow.add(key);
      process.stdout.write(chalk.green('  ✓ Always allowed.\n\n'));
      return true;
    }

    if (trimmed === 'y' || trimmed === 'yes') {
      process.stdout.write(chalk.green('  ✓ Allowed.\n\n'));
      return true;
    }

    // Any other input (including 'n', 'no', empty Enter) → deny
    process.stdout.write(chalk.red('  ✗ Denied.\n\n'));
    return false;
  }
}

// ── Helpers (module-private) ─────────────────────────────────────────────────

/**
 * Operation-level session key so that "always allow git diff" does not
 * carry over to "always allow git commit".
 */
function sessionKey(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'bash') {
    const prog = (typeof input.command === 'string' ? input.command : '').trim().split(/\s+/)[0];
    return `bash:${prog}`;
  }
  if (toolName === 'git') {
    const sub = (typeof input.args === 'string' ? input.args : '').trim().split(/\s+/)[0];
    return `git:${sub}`;
  }
  return toolName;
}

function formatSummary(toolName: string, input: Record<string, unknown>): string {
  let raw: string;
  switch (toolName) {
    case 'bash':  raw = `bash  ${input.command}`; break;
    case 'git':   raw = `git   ${input.args}`; break;
    case 'write': raw = `write ${input.file_path}`; break;
    case 'edit':  raw = `edit  ${input.file_path}`; break;
    default:      raw = `${toolName}  ${JSON.stringify(input)}`; break;
  }
  // Collapse newlines and truncate to fit within the approval box
  const flat = raw.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  const maxLen = 52;
  if (flat.length > maxLen) return flat.slice(0, maxLen - 1) + '…';
  return flat;
}

/**
 * Read one line from stdin for the approval prompt.
 *
 * Reads raw bytes directly from process.stdin instead of creating a
 * second readline interface. Creating another readline on the same stdin
 * that the REPL owns causes the REPL's readline to receive spurious
 * `close` events when the approval readline is destroyed, which kills
 * the entire process.
 */
function ask(): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    let buf = '';

    const done = (value: string | null) => {
      if (resolved) return;
      resolved = true;
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      // Restore the REPL's readline — it needs stdin paused so it can
      // call .resume() on its own terms. Without this, the REPL's
      // readline may never get another 'data' event.
      if (wasRaw !== undefined) process.stdin.setRawMode(wasRaw);
      resolve(value);
    };

    const onData = (chunk: Buffer) => {
      const str = chunk.toString();
      for (const ch of str) {
        // Ctrl+C (ETX)
        if (ch === '\x03') {
          process.stdout.write('\n');
          done(null);
          return;
        }
        // Ctrl+D (EOT) on empty buffer
        if (ch === '\x04') {
          process.stdout.write('\n');
          done(null);
          return;
        }
        // Enter
        if (ch === '\r' || ch === '\n') {
          process.stdout.write('\n');
          done(buf);
          return;
        }
        // Backspace
        if (ch === '\x7f' || ch === '\b') {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        // Regular character — echo it
        buf += ch;
        process.stdout.write(ch);
      }
    };

    const onEnd = () => done(null);

    // Switch stdin to raw mode so we get individual keystrokes
    let wasRaw: boolean | undefined;
    if (typeof process.stdin.setRawMode === 'function') {
      wasRaw = process.stdin.isRaw;
      process.stdin.setRawMode(true);
    }

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    // Ensure stdin is flowing
    process.stdin.resume();
  });
}
