import type { ToolDefinition } from '../../providers/interface.js';
import type { ToolCallFormatter, ParsedToolCall } from './interface.js';

/**
 * Attempt to parse a JSON string as a tool call.
 *
 * Accepts two shapes:
 *   { "name": "git", "arguments": { "args": "status" } }         -- canonical
 *   { "command": "git status" }                                   -- bare args (model shortcut)
 *
 * Returns null if the JSON isn't a recognisable tool call.
 */
export function tryParseToolCall(json: string): ParsedToolCall | null {
  try {
    const obj = JSON.parse(json.trim()) as Record<string, unknown>;
    const id = () => `call_${Math.random().toString(36).slice(2, 9)}`;

    // Canonical: { name, arguments }
    if (typeof obj.name === 'string' && obj.name.length < 30) {
      return {
        id: (typeof obj.id === 'string' ? obj.id : null) ?? id(),
        name: obj.name,
        arguments: JSON.stringify(obj.arguments ?? {}),
      };
    }

    // Bare shortcut: { "command": "..." } -> bash tool
    if (typeof obj.command === 'string' && Object.keys(obj).length <= 2) {
      return { id: id(), name: 'bash', arguments: JSON.stringify({ command: obj.command }) };
    }

    // Bare shortcut: { "args": "..." } with no name -> git tool (common pattern)
    if (typeof obj.args === 'string' && Object.keys(obj).length === 1) {
      return { id: id(), name: 'git', arguments: JSON.stringify({ args: obj.args }) };
    }

    return null;
  } catch {
    return null;
  }
}

// Patterns models commonly emit (ordered by specificity):
//   1. ```tool_call ... ```   -- canonical
//   2. ```json ... ```        -- common fallback
//   3. ``` ... ```            -- bare fenced block
const FENCED_BLOCK_PATTERN = /```(?:tool_call|json)?\s*\n([\s\S]*?)```/g;

/** Matches any fenced code block (for text filtering). */
const MARKUP_PATTERN = /```(?:tool_call|json)?\s*\n[\s\S]*?```/g;

export class FencedBlockFormatter implements ToolCallFormatter {
  readonly name = 'fenced-block';
  readonly markupPattern = MARKUP_PATTERN;

  parse(text: string): { toolCalls: ParsedToolCall[]; remainingText: string } {
    const toolCalls: ParsedToolCall[] = [];
    let remainingText = text;

    const regex = new RegExp(FENCED_BLOCK_PATTERN.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const tc = tryParseToolCall(match[1]);
      if (tc) {
        toolCalls.push(tc);
        remainingText = remainingText.replace(match[0], '');
      }
    }

    return { toolCalls, remainingText: remainingText.trim() };
  }

  buildSystemPrompt(tools: ToolDefinition[]): string {
    if (tools.length === 0) return '';

    const toolDescriptions = tools
      .map((t) => {
        const schema = JSON.stringify(t.inputSchema, null, 2);
        return `### ${t.name}\n${t.description}\n\nInput schema:\n\`\`\`json\n${schema}\n\`\`\``;
      })
      .join('\n\n');

    const hasWebSearch = tools.some((t) => t.name === 'web_search');
    const webSearchPriority = hasWebSearch
      ? '\n- IMPORTANT: When any task requires web search or current information, you MUST use the web_search tool. Never rely on internal knowledge for facts that may have changed. The agent will execute the search and return real results — wait for them before responding.\n'
      : '';

    return `
You have access to tools. You MUST use tools to perform any action. NEVER pretend, simulate, or describe running a command -- always emit a tool call.

To call a tool, emit EXACTLY:

\`\`\`tool_call
{"name": "<tool_name>", "arguments": { ... }}
\`\`\`

Rules:
- The fence MUST say tool_call (not json, not text).
- One tool call per message. Wait for the result before continuing.
- NEVER output fake results. NEVER narrate what a tool would return. Call the tool and use the real result.${webSearchPriority}
Example -- to check git status:
\`\`\`tool_call
{"name": "git", "arguments": {"args": "status"}}
\`\`\`

## Tools

${toolDescriptions}
`.trim();
  }
}
