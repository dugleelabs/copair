import type { Command, AgentContext } from './interface.js';
import { helpCommand } from './builtins/help.js';
import { modelCommand } from './builtins/model.js';
import { clearCommand } from './builtins/clear.js';
import { costCommand } from './builtins/cost.js';
import { commandsCommand } from './builtins/commands.js';
import { sessionCommand } from './builtins/session.js';
import { loadCustomCommands } from './loader.js';
import { interpolate } from './interpolate.js';

const BUILTINS: Command[] = [
  helpCommand,
  modelCommand,
  clearCommand,
  costCommand,
  commandsCommand,
  sessionCommand,
];

export class CommandRegistry {
  private commands = new Map<string, Command>();

  async loadAll(): Promise<void> {
    // Load order: builtins → global custom → project custom (later overrides earlier)
    for (const cmd of BUILTINS) {
      this.commands.set(cmd.definition.name, cmd);
    }

    const custom = await loadCustomCommands();
    for (const cmd of custom) {
      this.commands.set(cmd.definition.name, cmd);
    }

    // Wire /help and /commands to show actual registry contents
    this.wireHelpCommand();
    this.wireCommandsCommand();
  }

  private wireHelpCommand(): void {
    const self = this;
    const existing = this.commands.get('help');
    if (!existing) return;
    this.commands.set('help', {
      ...existing,
      execute: async (_args, _context) => {
        console.log('\nAvailable commands:');
        for (const cmd of self.commands.values()) {
          console.log(`  /${cmd.definition.name.padEnd(15)} ${cmd.definition.description}`);
        }
        console.log('');
      },
    });
  }

  private wireCommandsCommand(): void {
    const self = this;
    const existing = this.commands.get('commands');
    if (!existing) return;
    this.commands.set('commands', {
      ...existing,
      execute: async (_args, _context) => {
        const custom = Array.from(self.commands.values()).filter(
          (c) => c.definition.source !== 'builtin',
        );
        if (custom.length === 0) {
          console.log('No custom commands found.');
          console.log('Add .md files to ~/.copair/commands/ or .copair/commands/');
        } else {
          console.log('\nCustom commands:');
          for (const cmd of custom) {
            console.log(`  /${cmd.definition.name.padEnd(15)} ${cmd.definition.description} [${cmd.definition.source}]`);
          }
          console.log('');
        }
      },
    });
  }

  resolve(input: string): { command: Command; args: Record<string, string> } | null {
    // input is like "review focus=security" or just "help"
    const parts = input.trim().split(/\s+/);
    const name = parts[0];
    const command = this.commands.get(name);
    if (!command) return null;

    // Parse key=value args + capture positional text as ARGUMENTS
    const args: Record<string, string> = {};
    const positional: string[] = [];
    for (const part of parts.slice(1)) {
      const eqIdx = part.indexOf('=');
      if (eqIdx !== -1) {
        const key = part.slice(0, eqIdx);
        args[key] = part.slice(eqIdx + 1);
      } else {
        positional.push(part);
      }
    }
    if (positional.length > 0) {
      args['ARGUMENTS'] = positional.join(' ');
    }

    return { command, args };
  }

  async execute(input: string, context: AgentContext): Promise<{ handled: true; prompt?: string } | false> {
    const resolved = this.resolve(input);
    if (!resolved) return false;

    const { command, args } = resolved;

    // Fill in defaults from arg definitions
    if (command.definition.args) {
      for (const argDef of command.definition.args) {
        if (!(argDef.name in args) && argDef.default !== undefined) {
          args[argDef.name] = argDef.default;
        }
      }
    }

    const result = await command.execute(args, context);
    return { handled: true, prompt: typeof result === 'string' ? result : undefined };
  }

  getCompletions(partial: string): string[] {
    const names = Array.from(this.commands.keys());
    return names.filter((n) => n.startsWith(partial)).map((n) => `/${n}`);
  }

  getAll(): Command[] {
    return Array.from(this.commands.values());
  }
}
