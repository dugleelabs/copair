import type { ToolDefinition } from '../../providers/interface.js';

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolCallFormatter {
  readonly name: string;
  readonly markupPattern: RegExp;
  /** Opening tag for streaming suppression (e.g. `<tool_call>`). When set,
   *  the renderer buffers across chunks instead of applying a per-chunk regex. */
  readonly openTag?: string;
  readonly closeTag?: string;
  /** When true, the streaming filter also suppresses all text that follows the
   *  first complete tool-call block in a response.  Use for models that
   *  hallucinate post-tool text (e.g. "It seems there was an issue…"). */
  readonly suppressAfterMatch?: boolean;
  parse(text: string): { toolCalls: ParsedToolCall[]; remainingText: string };
  buildSystemPrompt(tools: ToolDefinition[]): string;
}
