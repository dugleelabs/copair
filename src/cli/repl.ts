import { createInterface, type Interface } from 'node:readline';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { printBanner } from './banner.js';
import { detectGitContext } from '../core/git-context.js';

const HISTORY_FILE = join(homedir(), '.copair', 'history');
const MAX_HISTORY = 500;

export interface ReplCallbacks {
  onMessage: (input: string) => Promise<void>;
  onSlashCommand: (command: string, args: string) => Promise<void>;
  onExit: () => Promise<void>;
}

export class Repl {
  private rl: Interface | null = null;
  private callbacks: ReplCallbacks;
  private modelName: string;
  private running = false;
  private exited = false;
  private ctrlCCount = 0;
  private ctrlCTimer: ReturnType<typeof setTimeout> | null = null;
  private history: string[] = [];
  private sessionIdentifier: string | null = null;
  private branch: string | null = null;
  private cwd: string;

  constructor(callbacks: ReplCallbacks, modelName: string, cwd = process.cwd()) {
    this.callbacks = callbacks;
    this.modelName = modelName;
    this.cwd = cwd;
    this.history = loadHistory();
    this.branch = this.detectBranch();
  }

  setBranch(branch: string | null): void {
    this.branch = branch;
  }

  private detectBranch(): string | null {
    const ctx = detectGitContext(this.cwd);
    if (!ctx.isGitRepo || !ctx.branch) return null;
    return ctx.branch === 'HEAD' ? '(HEAD detached)' : ctx.branch;
  }

  setModel(name: string): void {
    this.modelName = name;
  }

  setSessionIdentifier(id: string): void {
    this.sessionIdentifier = id;
  }

  private get prompt(): string {
    const session = this.sessionIdentifier ? ` [${this.sessionIdentifier}]` : '';
    const branchSuffix = this.branch ? chalk.green(` (${this.branch})`) : '';
    return chalk.cyan(`copair (${this.modelName})`) + chalk.dim(session) + branchSuffix + chalk.gray(' > ');
  }

  async start(): Promise<void> {
    this.running = true;

    this.rl = this.createRL();

    printBanner(this.modelName);
    this.attachHandlers();

    while (this.running) {
      const input = await this.readline();
      if (input === null) {
        // readline was destroyed — loop will re-check this.running
        continue;
      }

      const trimmed = input.trim();
      if (!trimmed) continue;

      // Persist to history
      this.history.unshift(trimmed);
      if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;
      saveHistory(this.history);

      if (trimmed.startsWith('/')) {
        const spaceIdx = trimmed.indexOf(' ');
        const command = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
        const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
        await this.callbacks.onSlashCommand(command, args);
      } else {
        await this.callbacks.onMessage(trimmed);
      }
      this.branch = this.detectBranch();
    }

    await this.doExit();
  }

  stop(): void {
    this.running = false;
    this.clearCtrlCTimer();
    this.rl?.close();
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private attachHandlers(): void {
    if (!this.rl) return;

    // ── Ctrl+C: require 2 presses within 2s ───────────────────────────
    this.rl.on('SIGINT', () => {
      this.ctrlCCount++;
      if (this.ctrlCCount >= 2) {
        this.clearCtrlCTimer();
        process.stdout.write('\n');
        this.stop();
        return;
      }
      process.stdout.write(chalk.yellow('\n  Press Ctrl+C again to exit (or /exit)\n'));
      this.rl?.prompt();
      this.resetCtrlCTimer();
    });

    // ── Ctrl+D / EOF: same two-press behaviour ────────────────────────
    this.rl.on('close', () => {
      if (!this.running) return; // intentional stop() — don't interfere
      this.ctrlCCount++;
      if (this.ctrlCCount >= 2) {
        this.clearCtrlCTimer();
        this.running = false;
        return;
      }
      process.stdout.write(chalk.yellow('\n  Press Ctrl+C or Ctrl+D again to exit (or /exit)\n'));
      // Re-create readline so the REPL keeps running
      this.rl = this.createRL();
      this.attachHandlers();
      this.resetCtrlCTimer();
    });
  }

  private resetCtrlCTimer(): void {
    this.clearCtrlCTimer();
    this.ctrlCTimer = setTimeout(() => {
      this.ctrlCCount = 0;
    }, 2000);
  }

  private clearCtrlCTimer(): void {
    if (this.ctrlCTimer) {
      clearTimeout(this.ctrlCTimer);
      this.ctrlCTimer = null;
    }
  }

  private async doExit(): Promise<void> {
    if (this.exited) return;
    this.exited = true;
    await this.callbacks.onExit();
  }

  private createRL(): Interface {
    return createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      history: [...this.history],
      historySize: MAX_HISTORY,
    });
  }

  private readline(): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.rl || !this.running) {
        resolve(null);
        return;
      }
      this.rl.question(this.prompt, (answer) => {
        resolve(answer);
      });
    });
  }
}

// ── History persistence ─────────────────────────────────────────────────────

function loadHistory(): string[] {
  try {
    return readFileSync(HISTORY_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function saveHistory(history: string[]): void {
  try {
    mkdirSync(join(homedir(), '.copair'), { recursive: true });
    writeFileSync(HISTORY_FILE, history.join('\n') + '\n');
  } catch {
    // Non-critical — silently ignore
  }
}
