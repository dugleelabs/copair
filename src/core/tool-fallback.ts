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
You have access to tools. You MUST use tools to perform any action. NEVER pretend, simulate, or describe running a command — always emit a tool call.

To call a tool, emit EXACTLY:

\`\`\`tool_call
{"name": "<tool_name>", "arguments": { ... }}
\`\`\`

Rules:
- The fence MUST say tool_call (not json, not text).
- One tool call per message. Wait for the result before continuing.
- NEVER output fake results. NEVER narrate what a tool would return. Call the tool and use the real result.

Example — to check git status:
\`\`\`tool_call
{"name": "git", "arguments": {"args": "status"}}
\`\`\`

## Tools

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
 *
 * Matches (in priority order):
 *   1. ```tool_call ... ```  — canonical format
 *   2. ```json ... ```       — common fallback from smaller models
 *   3. ``` ... ```           — bare fenced code blocks containing tool JSON
 *
 * A JSON object is treated as a tool call if it has a "name" field that
 * matches a known tool name pattern (short lowercase identifier).
 */
export function parseToolCallsFromText(text: string): {
  toolCalls: ParsedToolCall[];
  remainingText: string;
} {
  const toolCalls: ParsedToolCall[] = [];
  let remainingText = text;

  // Patterns models commonly emit (ordered by specificity):
  //   1. ```tool_call ... ```   — canonical
  //   2. ```json ... ```        — common fallback
  //   3. ``` ... ```            — bare fenced block
  //   4. <tool_call> ... </tool_call>  — Qwen-style XML tags
  const patterns: RegExp[] = [
    /```(?:tool_call|json)?\s*\n([\s\S]*?)```/g,
    /<tool_call>\s*\n?([\s\S]*?)<\/tool_call>/g,
    // Unclosed <tool_call> — model forgot closing tag (common with small models)
    /<tool_call>\s*\n?([\s\S]*?)$/g,
  ];

  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const tc = tryParseToolCall(match[1]);
      if (tc) {
        toolCalls.push(tc);
        remainingText = remainingText.replace(match[0], '');
      }
    }
  }

  return { toolCalls, remainingText: remainingText.trim() };
}

/**
 * Attempt to parse a JSON string as a tool call.
 *
 * Accepts two shapes:
 *   { "name": "git", "arguments": { "args": "status" } }         — canonical
 *   { "command": "git status" }                                   — bare args (model shortcut)
 *
 * Returns null if the JSON isn't a recognisable tool call.
 */
function tryParseToolCall(json: string): ParsedToolCall | null {
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

    // Bare shortcut: { "command": "..." } → bash tool
    if (typeof obj.command === 'string' && Object.keys(obj).length <= 2) {
      return { id: id(), name: 'bash', arguments: JSON.stringify({ command: obj.command }) };
    }

    // Bare shortcut: { "args": "..." } with no name → git tool (common pattern)
    if (typeof obj.args === 'string' && Object.keys(obj).length === 1) {
      return { id: id(), name: 'git', arguments: JSON.stringify({ args: obj.args }) };
    }

    return null;
  } catch {
    return null;
  }
}
