import type { ToolDefinition } from '../../providers/interface.js';
import type { ToolCallFormatter, ParsedToolCall } from './interface.js';
import { tryParseToolCall } from './fenced-block.js';

// Qwen-style XML tags: <tool_call> ... </tool_call>
const TOOL_CALL_CLOSED_RE = /<tool_call>\s*\n?([\s\S]*?)<\/tool_call>/g;
// Unclosed <tool_call> -- model forgot closing tag (common with small models)
const TOOL_CALL_UNCLOSED_RE = /<tool_call>\s*\n?([\s\S]*?)$/g;

/** Matches any <tool_call> markup (for text filtering). */
const MARKUP_PATTERN = /<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g;

export class QwenXmlFormatter implements ToolCallFormatter {
  readonly name = 'qwen-xml';
  readonly markupPattern = MARKUP_PATTERN;

  parse(text: string): { toolCalls: ParsedToolCall[]; remainingText: string } {
    const toolCalls: ParsedToolCall[] = [];
    let remainingText = text;

    for (const regex of [TOOL_CALL_CLOSED_RE, TOOL_CALL_UNCLOSED_RE]) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const tc = tryParseToolCall(match[1]);
        if (tc) {
          toolCalls.push(tc);
          remainingText = remainingText.replace(match[0], '');
        }
      }
      if (toolCalls.length > 0) break;
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

    return `
You have access to tools. You MUST use tools to perform any action. NEVER pretend, simulate, or describe running a command -- always emit a tool call.

To call a tool, emit EXACTLY:

<tool_call>
{"name": "<tool_name>", "arguments": { ... }}
</tool_call>

Rules:
- One tool call per message. Wait for the result before continuing.
- NEVER output fake results. NEVER narrate what a tool would return. Call the tool and use the real result.

Example -- to check git status:
<tool_call>
{"name": "git", "arguments": {"args": "status"}}
</tool_call>

## Tools

${toolDescriptions}
`.trim();
  }
}
