import type { Command, AgentContext } from '../interface.js';

export const costCommand: Command = {
  definition: {
    name: 'cost',
    description: 'Show token usage and cost summary for this session',
    source: 'builtin',
  },
  async execute(_args: Record<string, string>, _context: AgentContext): Promise<void> {
    // Actual cost display is handled by the REPL which has TokenTracker access
    console.log('Cost summary is shown on session exit. Use /exit to see it now.');
  },
};
