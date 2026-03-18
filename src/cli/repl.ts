import { createInterface, type Interface } from 'node:readline';
import chalk from 'chalk';
import { printBanner } from './banner.js';

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

  constructor(callbacks: ReplCallbacks, modelName: string) {
    this.callbacks = callbacks;
    this.modelName = modelName;
  }

  setModel(name: string): void {
    this.modelName = name;
  }

  private get prompt(): string {
    return chalk.cyan(`copair (${this.modelName})`) + chalk.gray(' > ');
  }

  async start(): Promise<void> {
    this.running = true;

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

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

      if (trimmed.startsWith('/')) {
        const spaceIdx = trimmed.indexOf(' ');
        const command = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
        const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
        await this.callbacks.onSlashCommand(command, args);
      } else {
        await this.callbacks.onMessage(trimmed);
      }
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
      this.rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
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
