import { resolve as resolvePath } from 'node:path';
import chalk from 'chalk';
import type { AllowList } from './allow-list.js';
import type { AgentBridge, ApprovalAnswer } from '../cli/ui/agent-bridge.js';
import { readFromTty } from '../cli/tty-prompt.js';
import { logger } from './logger.js';
import type { AuditLog } from './audit-log.js';

export type RiskLevel = 'safe' | 'needs-approval' | 'always-ask';
export type GateMode = 'ask' | 'auto-approve' | 'deny';

/**
 * Files that must never bypass the approval gate even when they reside inside
 * a trusted directory (e.g. .copair/).  A prompt injection must not be able to
 * escalate agent permissions by writing these files through the trusted-path
 * shortcut.
 */
const PERMISSION_SENSITIVE_FILES = ['config.yaml', 'allow.yaml', 'audit.jsonl'];

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

  // ── Web search: always prompt even in auto-approve (network + token cost) ──
  web_search: (): RiskLevel => 'always-ask',

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
  // Trusted path prefixes — file mutations under these paths skip approval
  private trustedPaths = new Set<string>();
  // Optional bridge for ink-based approval UI
  private bridge: AgentBridge | null = null;
  private auditLog: AuditLog | null = null;
  // Pending approval context for bridge-based flow
  private pendingIndex = 0;
  private pendingTotal = 0;

  constructor(mode: GateMode = 'ask', allowList: AllowList | null = null) {
    this.mode = mode;
    this.allowList = allowList;
  }

  /** Set the bridge for ink-based approval prompts. */
  setBridge(bridge: AgentBridge): void {
    this.bridge = bridge;
  }

  setAuditLog(log: AuditLog): void {
    this.auditLog = log;
  }

  /** Set context for batch approval counting. */
  setApprovalContext(index: number, total: number): void {
    this.pendingIndex = index;
    this.pendingTotal = total;
  }

  /** Register a path as trusted. File mutations under/at this path skip approval. */
  addTrustedPath(path: string): void {
    this.trustedPaths.add(resolvePath(path));
  }

  /** Check if a tool call targets a trusted path. Only applies to write/edit tools. */
  isTrustedPath(toolName: string, input: Record<string, unknown>): boolean {
    if (toolName !== 'write' && toolName !== 'edit') return false;
    const filePath = input.file_path;
    if (typeof filePath !== 'string') return false;
    const abs = resolvePath(filePath);
    for (const trusted of this.trustedPaths) {
      // Exact match (e.g., .copair.yaml) or directory prefix (e.g., .copair/)
      if (abs === trusted || abs.startsWith(trusted + '/')) {
        // Permission-sensitive files are NEVER auto-trusted — even inside .copair/.
        // An agent (or injected prompt) must not be able to escalate its own
        // permissions by writing the allow-list or project config.
        if (PERMISSION_SENSITIVE_FILES.some((name) => abs.endsWith('/' + name))) {
          return false;
        }
        return true;
      }
    }
    return false;
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
    // Trusted paths bypass even deny mode — scaffolding writes must always work
    if (this.isTrustedPath(toolName, input)) return true;

    if (this.mode === 'deny') {
      void this.auditLog?.append({ event: 'denial', tool: toolName, outcome: 'denied', detail: 'deny mode' });
      return false;
    }

    const risk = this.classify(toolName, input);
    if (risk === 'safe') return true;

    // 'always-ask' bypasses auto-approve — these tools always require human confirmation
    if (this.mode === 'auto-approve' && risk !== 'always-ask') {
      void this.auditLog?.append({ event: 'approval', tool: toolName, approved_by: 'auto', outcome: 'allowed' });
      return true;
    }

    // File-based allow list — pre-approved operations bypass the prompt
    if (this.allowList?.matches(toolName, input)) {
      void this.auditLog?.append({ event: 'approval', tool: toolName, approved_by: 'allow_list', outcome: 'allowed' });
      return true;
    }

    const key = sessionKey(toolName, input);
    if (this.alwaysAllow.has(key)) {
      void this.auditLog?.append({ event: 'approval', tool: toolName, approved_by: 'user', outcome: 'allowed' });
      return true;
    }

    // Bridge-based approval (ink UI): approve-all-for-turn check
    if (this.bridge?.approveAllForTurn) {
      void this.auditLog?.append({ event: 'approval', tool: toolName, approved_by: 'user', outcome: 'allowed' });
      return true;
    }

    const defaultAllow = risk === 'always-ask';

    // Bridge-based approval via ink ApprovalHandler
    if (this.bridge) {
      return this.bridgePrompt(toolName, input, key);
    }

    // Legacy fallback: /dev/tty prompt (synchronous, not stdin)
    return Promise.resolve(this.legacyPrompt(toolName, input, key, defaultAllow));
  }

  /** Bridge-based approval: emit event and await response from ink UI. */
  private bridgePrompt(
    toolName: string,
    input: Record<string, unknown>,
    key: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const summary = formatSummary(toolName, input);

      this.bridge!.emit('approval-request', {
        toolName,
        input,
        summary,
        index: this.pendingIndex,
        total: this.pendingTotal,
      }, (answer: ApprovalAnswer) => {
        switch (answer) {
          case 'allow':
            void this.auditLog?.append({ event: 'approval', tool: toolName, approved_by: 'user', outcome: 'allowed' });
            resolve(true);
            break;
          case 'always':
            this.alwaysAllow.add(key);
            void this.auditLog?.append({ event: 'approval', tool: toolName, approved_by: 'user', outcome: 'allowed', detail: 'always' });
            resolve(true);
            break;
          case 'all':
            this.bridge!.approveAllForTurn = true;
            void this.auditLog?.append({ event: 'approval', tool: toolName, approved_by: 'user', outcome: 'allowed', detail: 'approve-all' });
            resolve(true);
            break;
          case 'similar': {
            // Extract directory-level key for similar operations
            const similarKey = similarSessionKey(toolName, input);
            this.alwaysAllow.add(similarKey);
            void this.auditLog?.append({ event: 'approval', tool: toolName, approved_by: 'user', outcome: 'allowed', detail: 'similar' });
            resolve(true);
            break;
          }
          case 'deny':
          default:
            void this.auditLog?.append({ event: 'denial', tool: toolName, outcome: 'denied', detail: 'user denied' });
            resolve(false);
            break;
        }
      });
    });
  }

  /** Legacy approval prompt: reads from /dev/tty directly (not stdin).
   *
   * @param defaultAllow  When true (used for `always-ask` tools like web_search),
   *   pressing Enter without typing confirms the action.  For all other tools the
   *   safe default is to deny on empty input.
   */
  private legacyPrompt(
    toolName: string,
    input: Record<string, unknown>,
    key: string,
    defaultAllow = false,
  ): boolean {
    const summary = formatSummary(toolName, input);
    const boxWidth = Math.max(summary.length + 6, 56);
    const topBar = '\u2500'.repeat(boxWidth);
    const pad = ' '.repeat(Math.max(0, boxWidth - summary.length - 2));

    const allowLabel = defaultAllow ? chalk.green('[y/\u23ce]') : chalk.green('[y]');

    process.stdout.write('\n');
    process.stdout.write(chalk.yellow(`  \u250C\u2500 \u26A0  Approval required ${'\u2500'.repeat(Math.max(0, boxWidth - 23))}\u2510\n`));
    process.stdout.write(chalk.yellow('  \u2502  ') + chalk.white.bold(summary) + chalk.yellow(`${pad}  \u2502\n`));
    process.stdout.write(chalk.yellow(`  \u2514${topBar}\u2518\n`));
    process.stdout.write(
      `  ${allowLabel} allow   ${chalk.cyan('[a]')} always   ${chalk.red('[n]')} deny  ${chalk.yellow('\u203A')} `,
    );

    const answer = readFromTty();
    if (answer === null) {
      logger.info('approval', 'TTY unavailable — treating as CI mode (deny)');
      process.stdout.write(chalk.red('\n  \u2717 Denied (CI mode — no TTY).\n\n'));
      void this.auditLog?.append({ event: 'denial', tool: toolName, outcome: 'denied', detail: 'CI mode — no TTY' });
      return false;
    }

    const trimmed = answer.toLowerCase().trim();

    if (trimmed === 'a' || trimmed === 'always') {
      this.alwaysAllow.add(key);
      process.stdout.write(chalk.green('  \u2713 Always allowed.\n\n'));
      void this.auditLog?.append({ event: 'approval', tool: toolName, approved_by: 'user', outcome: 'allowed', detail: 'always' });
      return true;
    }

    if (trimmed === 'y' || trimmed === 'yes' || (trimmed === '' && defaultAllow)) {
      process.stdout.write(chalk.green('  \u2713 Allowed.\n\n'));
      void this.auditLog?.append({ event: 'approval', tool: toolName, approved_by: 'user', outcome: 'allowed' });
      return true;
    }

    // Empty Enter on non-defaultAllow tools, or explicit 'n'/'no' → deny
    process.stdout.write(chalk.red('  \u2717 Denied.\n\n'));
    void this.auditLog?.append({ event: 'denial', tool: toolName, outcome: 'denied', detail: 'user denied' });
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

/**
 * Directory-level session key for "approve similar" — approves the same
 * tool in the same directory.
 */
function similarSessionKey(toolName: string, input: Record<string, unknown>): string {
  const filePath = input.file_path ?? input.path;
  if (typeof filePath === 'string') {
    const dir = filePath.replace(/\/[^/]*$/, '/');
    return `${toolName}:${dir}`;
  }
  return sessionKey(toolName, input);
}

/**
 * Build a human-readable summary for the approval prompt.
 * NO truncation — the ink UI handles wrapping. The legacy prompt adapts
 * the box width to fit.
 */
export function formatSummary(toolName: string, input: Record<string, unknown>): string {
  let raw: string;
  switch (toolName) {
    case 'bash':       raw = `bash  ${input.command}`; break;
    case 'git':        raw = `git   ${input.args}`; break;
    case 'write':      raw = `write ${input.file_path}`; break;
    case 'edit':       raw = `edit  ${input.file_path}`; break;
    case 'web_search': raw = `Copair web search  "${input.query}"`; break;
    default:           raw = `${toolName}  ${JSON.stringify(input)}`; break;
  }
  // Collapse newlines but do NOT truncate — full command visible
  return raw.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

