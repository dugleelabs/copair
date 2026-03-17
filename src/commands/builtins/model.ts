import type { Command, AgentContext } from '../interface.js';

export const modelCommand: Command = {
  definition: {
    name: 'model',
    description: 'Show current model',
    source: 'builtin',
  },
  async execute(_args: Record<string, string>, context: AgentContext): Promise<void> {
    console.log(`Current model: ${context.model}`);
  },
};
