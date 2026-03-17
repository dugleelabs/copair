import { createInterface } from 'node:readline';
import chalk from 'chalk';
import type { Tool } from '../tools/interface.js';

export type PermissionMode = 'ask' | 'auto-approve' | 'deny';

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
}

export class PermissionController {
  private mode: PermissionMode;
  private allowList: string[];
  private sessionOverrides = new Map<string, boolean>();

  constructor(mode: PermissionMode = 'ask', allowList: string[] = []) {
    this.mode = mode;
    this.allowList = allowList;
  }

  async check(
    tool: Tool,
    input: Record<string, unknown>,
  ): Promise<PermissionDecision> {
    if (!tool.requiresPermission) return { allowed: true };
    if (this.mode === 'auto-approve') return { allowed: true };
    if (this.mode === 'deny') {
      return { allowed: false, reason: 'Permission mode: deny' };
    }

    // Check allow-list for bash commands
    if (tool.definition.name === 'bash' && this.isAllowListed(input.command)) {
      return { allowed: true };
    }

    // Check session overrides
    const override = this.sessionOverrides.get(tool.definition.name);
    if (override !== undefined) {
      return { allowed: override };
    }

    // Prompt user
    return this.promptUser(tool, input);
  }

  isAllowListed(command: unknown): boolean {
    if (typeof command !== 'string') return false;
    const shellOperators = /[;|&`]|\$\(/;
    if (shellOperators.test(command)) return false;
    const trimmed = command.trim();
    return this.allowList.some((allowed) => trimmed === allowed);
  }

  private async promptUser(
    tool: Tool,
    input: Record<string, unknown>,
  ): Promise<PermissionDecision> {
    const description = this.formatAction(tool, input);

    console.log(chalk.yellow(`\n⚠ Permission required:`));
    console.log(chalk.white(`  Tool: ${tool.definition.name}`));
    console.log(chalk.white(`  ${description}`));

    const answer = await this.askQuestion(
      chalk.yellow('  Allow? [y/n/a(lways)] '),
    );

    const lower = answer.toLowerCase().trim();
    if (lower === 'y' || lower === 'yes') {
      return { allowed: true };
    }
    if (lower === 'a' || lower === 'always') {
      this.sessionOverrides.set(tool.definition.name, true);
      return { allowed: true };
    }
    return { allowed: false, reason: 'User denied' };
  }

  private formatAction(
    tool: Tool,
    input: Record<string, unknown>,
  ): string {
    switch (tool.definition.name) {
      case 'bash':
        return `Command: ${input.command}`;
      case 'write':
        return `Write to: ${input.file_path}`;
      case 'edit':
        return `Edit: ${input.file_path}`;
      case 'git':
        return `Git: ${input.args}`;
      default:
        return `Input: ${JSON.stringify(input)}`;
    }
  }

  private askQuestion(prompt: string): Promise<string> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}
