import type { Command, AgentContext } from '../interface.js';

export const commandsCommand: Command = {
  definition: {
    name: 'commands',
    description: 'List all available commands',
    source: 'builtin',
  },
  async execute(_args: Record<string, string>, _context: AgentContext): Promise<void> {
    // The registry calls this but overrides the output — placeholder
    console.log('Use /help to see all commands.');
  },
};
