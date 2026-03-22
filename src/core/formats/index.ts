export type { ToolCallFormatter, ParsedToolCall } from './interface.js';
export { FencedBlockFormatter, tryParseToolCall } from './fenced-block.js';
export { DsmlFormatter } from './dsml.js';
export { QwenXmlFormatter } from './qwen-xml.js';

import type { ToolCallFormatter } from './interface.js';
import { DsmlFormatter } from './dsml.js';
import { QwenXmlFormatter } from './qwen-xml.js';
import { FencedBlockFormatter } from './fenced-block.js';

export type FormatName = 'dsml' | 'qwen-xml' | 'fenced-block';

/**
 * Resolve the appropriate formatter for a provider/model combination.
 *
 * Priority:
 *   1. Explicit override from config
 *   2. Auto-detect from model ID
 *   3. Default to fenced-block
 */
export function resolveFormatter(
  _providerName: string,
  modelId: string,
  override?: FormatName,
): ToolCallFormatter {
  if (override) {
    return createFormatter(override);
  }

  const id = modelId.toLowerCase();
  if (id.includes('deepseek')) return new DsmlFormatter();
  if (id.includes('qwen')) return new QwenXmlFormatter();
  return new FencedBlockFormatter();
}

function createFormatter(name: FormatName): ToolCallFormatter {
  switch (name) {
    case 'dsml':
      return new DsmlFormatter();
    case 'qwen-xml':
      return new QwenXmlFormatter();
    case 'fenced-block':
      return new FencedBlockFormatter();
  }
}

/**
 * Build a text filter function that strips formatter markup from display text.
 * The returned function removes all matches of the formatter's markupPattern.
 */
export function buildTextFilter(formatter: ToolCallFormatter): (text: string) => string {
  return (text: string): string => {
    return text.replace(new RegExp(formatter.markupPattern.source, formatter.markupPattern.flags), '');
  };
}
