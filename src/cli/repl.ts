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

    this.rl.on('close', async () => {
      this.running = false;
      await this.callbacks.onExit();
    });

    while (this.running) {
      const input = await this.readline();
      if (input === null) break;

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
  }

  private readline(): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.rl) {
        resolve(null);
        return;
      }
      this.rl.question(this.prompt, (answer) => {
        resolve(answer);
      });
    });
  }

  stop(): void {
    this.running = false;
    this.rl?.close();
  }
}
