import type { ToolDefinition } from '../../providers/interface.js';
import type { ToolCallFormatter, ParsedToolCall } from './interface.js';

// ── DeepSeek DSML format ──────────────────────────────────────────────
// DeepSeek V3+ models sometimes emit tool calls in their native DSML
// markup even when accessed through the OpenAI-compatible API. The format
// uses fullwidth pipe characters (U+FF5C) as delimiters:
//
//   <｜DSML｜function_calls>
//   <｜DSML｜invoke name="read">
//   <｜DSML｜parameter name="file_path" string="true">/path/to/file<｜DSML｜parameter>
//   </｜DSML｜invoke>
//   </｜DSML｜function_calls>

// Match both fullwidth (｜) and ASCII (|) pipes -- some tokenizers normalize them
const DSML_BLOCK_RE =
  /<[\uFF5C|]DSML[\uFF5C|]function_calls>\s*([\s\S]*?)<\/[\uFF5C|]DSML[\uFF5C|]function_calls>/g;
const DSML_INVOKE_RE =
  /<[\uFF5C|]DSML[\uFF5C|]invoke\s+name="([^"]+)">\s*([\s\S]*?)<\/[\uFF5C|]DSML[\uFF5C|]invoke>/g;
const DSML_PARAM_RE =
  /<[\uFF5C|]DSML[\uFF5C|]parameter\s+name="([^"]+)"(?:\s+string="([^"]*)")?\s*>([\s\S]*?)<\/?[\uFF5C|]DSML[\uFF5C|]parameter>/g;

// Unclosed DSML block -- model omitted closing tag
const DSML_BLOCK_UNCLOSED_RE =
  /<[\uFF5C|]DSML[\uFF5C|]function_calls>\s*([\s\S]*?)$/g;

/** Matches any DSML markup (for text filtering). */
const DSML_MARKUP_PATTERN =
  /<[\uFF5C|]DSML[\uFF5C|]function_calls>[\s\S]*?(?:<\/[\uFF5C|]DSML[\uFF5C|]function_calls>|$)/g;

export class DsmlFormatter implements ToolCallFormatter {
  readonly name = 'dsml';
  readonly markupPattern = DSML_MARKUP_PATTERN;
  readonly suppressAfterMatch = true;

  parse(text: string): { toolCalls: ParsedToolCall[]; remainingText: string } {
    const toolCalls: ParsedToolCall[] = [];
    let remainingText = text;

    // Try closed blocks first, then unclosed
    for (const blockRegex of [DSML_BLOCK_RE, DSML_BLOCK_UNCLOSED_RE]) {
      blockRegex.lastIndex = 0;
      let blockMatch: RegExpExecArray | null;
      while ((blockMatch = blockRegex.exec(text)) !== null) {
        const blockBody = blockMatch[1];
        remainingText = remainingText.replace(blockMatch[0], '');

        DSML_INVOKE_RE.lastIndex = 0;
        let invokeMatch: RegExpExecArray | null;
        while ((invokeMatch = DSML_INVOKE_RE.exec(blockBody)) !== null) {
          const toolName = invokeMatch[1];
          const invokeBody = invokeMatch[2];
          const args: Record<string, unknown> = {};

          DSML_PARAM_RE.lastIndex = 0;
          let paramMatch: RegExpExecArray | null;
          while ((paramMatch = DSML_PARAM_RE.exec(invokeBody)) !== null) {
            const paramName = paramMatch[1];
            const isString = paramMatch[2] === 'true';
            const rawValue = paramMatch[3];

            if (isString) {
              args[paramName] = rawValue;
            } else {
              // Try JSON parse for objects/arrays/numbers, fall back to string
              try {
                args[paramName] = JSON.parse(rawValue);
              } catch {
                args[paramName] = rawValue;
              }
            }
          }

          toolCalls.push({
            id: `call_${Math.random().toString(36).slice(2, 9)}`,
            name: toolName,
            arguments: JSON.stringify(args),
          });
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
        const params = Object.entries(
          (t.inputSchema as Record<string, unknown>).properties as Record<string, Record<string, unknown>> ?? {},
        )
          .map(([name, prop]) => {
            const isStr = prop.type === 'string';
            return `<\uFF5CDSML\uFF5Cparameter name="${name}"${isStr ? ' string="true"' : ''}>value<\uFF5CDSML\uFF5Cparameter>`;
          })
          .join('\n');

        return `### ${t.name}\n${t.description}\n\nExample:\n<\uFF5CDSML\uFF5Cfunction_calls>\n<\uFF5CDSML\uFF5Cinvoke name="${t.name}">\n${params}\n</\uFF5CDSML\uFF5Cinvoke>\n</\uFF5CDSML\uFF5Cfunction_calls>`;
      })
      .join('\n\n');

    const hasWebSearch = tools.some((t) => t.name === 'web_search');
    const webSearchPriority = hasWebSearch
      ? '\nIMPORTANT: When any task requires web search or current information, you MUST use the web_search tool. Never rely on internal knowledge for facts that may have changed. The agent will execute the search and return real results.\n'
      : '';

    return `
You have access to tools. To call a tool, use DSML format:

<\uFF5CDSML\uFF5Cfunction_calls>
<\uFF5CDSML\uFF5Cinvoke name="tool_name">
<\uFF5CDSML\uFF5Cparameter name="param" string="true">value<\uFF5CDSML\uFF5Cparameter>
</\uFF5CDSML\uFF5Cinvoke>
</\uFF5CDSML\uFF5Cfunction_calls>
${webSearchPriority}
## Tools

${toolDescriptions}
`.trim();
  }
}
