import { z } from 'zod';
import type { Tool } from './interface.js';

export const TaskCompleteInputSchema = z.object({
  summary: z.string().min(1),
}).strict();

export const taskCompleteTool: Tool = {
  inputSchema: TaskCompleteInputSchema,
  definition: {
    name: 'task_complete',
    description:
      'Signal that the assigned task is complete. ' +
      'Provide a one-sentence summary of what was accomplished.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One-sentence summary of the completed task' },
      },
      required: ['summary'],
    },
  },
  requiresPermission: false,
  async execute(_input) {
    // Execution is intercepted in agent.ts before reaching the executor.
    // This stub exists only so the tool can be registered and appear in tool lists.
    return { content: '' };
  },
};
