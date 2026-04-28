import { z } from 'zod';
import type { Tool } from './interface.js';

export const AskUserInputSchema = z.object({
  question: z.string().min(1),
}).strict();

export const askUserTool: Tool = {
  inputSchema: AskUserInputSchema,
  definition: {
    name: 'ask_user',
    description:
      'Ask the user a clarifying question and wait for their answer. ' +
      'Use when you need information that is not available in the task context.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask the user' },
      },
      required: ['question'],
    },
  },
  requiresPermission: false,
  async execute(_input) {
    // Execution is intercepted in agent.ts before reaching the executor.
    // This stub exists only so the tool can be registered and appear in tool lists.
    return { content: '' };
  },
};
