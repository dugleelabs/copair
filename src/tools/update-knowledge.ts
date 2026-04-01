import { z } from 'zod';
import type { Tool } from './interface.js';
import { KnowledgeBase } from '../core/knowledge-base.js';

let knowledgeBaseInstance: KnowledgeBase | null = null;

export function setKnowledgeBase(kb: KnowledgeBase): void {
  knowledgeBaseInstance = kb;
}

export const UpdateKnowledgeInputSchema = z.object({
  entry: z.string().min(1),
}).strict();

export const updateKnowledgeTool: Tool = {
  inputSchema: UpdateKnowledgeInputSchema,
  definition: {
    name: 'update_knowledge',
    description:
      'Add a fact or decision to the project knowledge base (COPAIR_KNOWLEDGE.md). ' +
      'Use this when you learn something project-specific that would be valuable in future sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        entry: {
          type: 'string',
          description: 'The knowledge entry to add (a concise fact, decision, or convention)',
        },
      },
      required: ['entry'],
    },
  },
  requiresPermission: true,
  async execute(input) {
    const entry = input.entry as string;
    if (!entry || !entry.trim()) {
      return { content: 'Error: entry cannot be empty', isError: true };
    }

    if (!knowledgeBaseInstance) {
      return { content: 'Error: Knowledge base not initialized', isError: true };
    }

    try {
      await knowledgeBaseInstance.append(entry.trim());
      return { content: `Added to knowledge base: ${entry.trim()}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Error updating knowledge base: ${msg}`, isError: true };
    }
  },
};
