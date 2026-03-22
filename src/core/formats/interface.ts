import type { ToolDefinition } from '../../providers/interface.js';

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolCallFormatter {
  readonly name: string;
  readonly markupPattern: RegExp;
  parse(text: string): { toolCalls: ParsedToolCall[]; remainingText: string };
  buildSystemPrompt(tools: ToolDefinition[]): string;
}
