import type { ToolDefinition } from '../providers/interface.js';

/**
 * Builds a system prompt injection describing available tools for models
 * that don't natively support tool calling. The model is instructed to
 * emit tool invocations as JSON code blocks that can be parsed and executed.
 */
export function buildToolSystemPrompt(tools: ToolDefinition[]): string {
  if (tools.length === 0) return '';

  const toolDescriptions = tools
    .map((t) => {
      const schema = JSON.stringify(t.inputSchema, null, 2);
      return `### ${t.name}\n${t.description}\n\nInput schema:\n\`\`\`json\n${schema}\n\`\`\``;
    })
    .join('\n\n');

  return `
You have access to the following tools. When you want to use a tool, emit a tool call block in your response using this exact format:

\`\`\`tool_call
{
  "id": "<unique_id>",
  "name": "<tool_name>",
  "arguments": { ... }
}
\`\`\`

Wait for the tool result before continuing. Only emit one tool call block at a time.

## Available Tools

${toolDescriptions}
`.trim();
}

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Parses text output from a non-tool-calling model for embedded tool call blocks.
 * Returns all found tool calls and the text with tool call blocks removed.
 */
export function parseToolCallsFromText(text: string): {
  toolCalls: ParsedToolCall[];
  remainingText: string;
} {
  const toolCallRegex = /```tool_call\s*\n([\s\S]*?)```/g;
  const toolCalls: ParsedToolCall[] = [];
  let remainingText = text;

  let match: RegExpExecArray | null;
  const matches: Array<{ full: string; json: string }> = [];

  while ((match = toolCallRegex.exec(text)) !== null) {
    matches.push({ full: match[0], json: match[1] });
  }

  for (const { full, json } of matches) {
    try {
      const parsed = JSON.parse(json.trim()) as {
        id?: string;
        name: string;
        arguments?: unknown;
      };
      toolCalls.push({
        id: parsed.id ?? `call_${Math.random().toString(36).slice(2, 9)}`,
        name: parsed.name,
        arguments: JSON.stringify(parsed.arguments ?? {}),
      });
      remainingText = remainingText.replace(full, '');
    } catch {
      // Malformed JSON — leave in text
    }
  }

  return { toolCalls, remainingText: remainingText.trim() };
}
