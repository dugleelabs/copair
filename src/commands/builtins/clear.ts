import type { Command, AgentContext } from '../interface.js';

export const clearCommand: Command = {
  definition: {
    name: 'clear',
    description: 'Clear conversation history',
    source: 'builtin',
  },
  async execute(_args: Record<string, string>, _context: AgentContext): Promise<void> {
    // Actual clear is handled by the REPL/agent — this is a marker command
    console.log('Conversation cleared.');
  },
};
