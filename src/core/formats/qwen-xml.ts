import type { ToolDefinition } from '../../providers/interface.js';
import type { ToolCallFormatter, ParsedToolCall } from './interface.js';
import { tryParseToolCall } from './fenced-block.js';

/**
 * QwenXmlFormatter — `<tool_call>...</tool_call>` envelope.
 *
 * The qwen-xml format permits two output shapes inside the envelope:
 *   1. Canonical JSON: `{"name": "...", "arguments": {...}}`
 *   2. Hermes-style nested tags: `<function=name><parameter=key>val</parameter>...</function>`
 *
 * The parser tries (1) first and falls back to (2) on JSON parse failure.
 * **The fallback is unconditional** — any model whose output uses this
 * format gets the resilient parser, regardless of which model produced it.
 * This is a property of the *format*, not a per-model quirk handler.
 *
 * Originally introduced for Qwen3-Coder on Bedrock (spec 028 F-23) which
 * relapsed to the Hermes shape mid-conversation. Reframed 2026-05-15 per
 * spec 029 as a generic protocol-resilience pattern — multiple small models
 * across providers exhibit similar drift, and we don't gate the fix on
 * which model emitted the text.
 */

// Qwen-style XML tags: <tool_call> ... </tool_call>
const TOOL_CALL_CLOSED_RE = /<tool_call>\s*\n?([\s\S]*?)<\/tool_call>/g;
// Unclosed <tool_call> -- model forgot closing tag (common with small models)
const TOOL_CALL_UNCLOSED_RE = /<tool_call>\s*\n?([\s\S]*?)$/g;

/** Matches any <tool_call> markup (for text filtering). */
const MARKUP_PATTERN = /<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g;

// Hermes-style envelope: <function=NAME><parameter=KEY>VALUE</parameter>...</function>
// One of two valid output shapes inside the qwen-xml envelope (see class JSDoc above).
const HERMES_FN_RE = /<function=([\w.-]+)>/;
const HERMES_PARAM_RE = /<parameter=([\w.-]+)>\s*([\s\S]*?)\s*<\/parameter>/g;

function tryParseHermesEnvelope(text: string): ParsedToolCall | null {
  const fn = HERMES_FN_RE.exec(text);
  if (!fn) return null;
  const args: Record<string, string> = {};
  HERMES_PARAM_RE.lastIndex = 0;
  let pm: RegExpExecArray | null;
  while ((pm = HERMES_PARAM_RE.exec(text)) !== null) {
    args[pm[1]] = pm[2];
  }
  return {
    id: `call_${Math.random().toString(36).slice(2, 9)}`,
    name: fn[1],
    arguments: JSON.stringify(args),
  };
}

export class QwenXmlFormatter implements ToolCallFormatter {
  readonly name = 'qwen-xml';
  readonly markupPattern = MARKUP_PATTERN;
  readonly openTag = '<tool_call>';
  readonly closeTag = '</tool_call>';
  readonly suppressAfterMatch = true;

  parse(text: string): { toolCalls: ParsedToolCall[]; remainingText: string } {
    const toolCalls: ParsedToolCall[] = [];
    let remainingText = text;

    for (const regex of [TOOL_CALL_CLOSED_RE, TOOL_CALL_UNCLOSED_RE]) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const tc = tryParseToolCall(match[1]) ?? tryParseHermesEnvelope(match[1]);
        if (tc) {
          toolCalls.push(tc);
          remainingText = remainingText.replace(match[0], '');
        }
      }
      if (toolCalls.length > 0) break;
    }

    return { toolCalls, remainingText: remainingText.trim() };
  }

  exampleCall(): string {
    return '<tool_call>\n{"name": "read", "arguments": {"file_path": "/path/to/file"}}\n</tool_call>';
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

<tool_call>
{"name": "<tool_name>", "arguments": { ... }}
</tool_call>

Rules:
- One tool call per message. Wait for the result before continuing.
- NEVER output fake results. NEVER narrate what a tool would return. Call the tool and use the real result.
- NEVER continue talking after emitting a tool call. Stop immediately after </tool_call> and wait for the result.
- NEVER use <function=NAME> or <parameter=KEY> syntax inside <tool_call>. Only the JSON-in-tag form shown above is accepted.${webSearchPriority}
Example -- to check git status:
<tool_call>
{"name": "git", "arguments": {"args": "status"}}
</tool_call>

## Tools

${toolDescriptions}
`.trim();
  }
}
