export type { ToolCallFormatter, ParsedToolCall, ParseError, ParseResult } from './interface.js';
export { parseWithStrictFallback } from './interface.js';
export { FencedBlockFormatter, tryParseToolCall } from './fenced-block.js';
export { DsmlFormatter } from './dsml.js';
export { QwenXmlFormatter } from './qwen-xml.js';

import type { ToolCallFormatter } from './interface.js';
import { DsmlFormatter } from './dsml.js';
import { QwenXmlFormatter } from './qwen-xml.js';
import { FencedBlockFormatter } from './fenced-block.js';
import { getCapabilities } from '../model-capabilities.js';

export type FormatName = 'dsml' | 'qwen-xml' | 'fenced-block';

/**
 * Resolve the appropriate text-based tool-call formatter for a provider/model.
 *
 * Priority:
 *   1. Explicit override from config (caller passes `override?: FormatName`)
 *   2. `getCapabilities(modelId).preferred_format` — derived from spec 029's
 *      generic family-prefix function (qwen-family → qwen-xml, deepseek → dsml,
 *      frontier-cloud → native, else fenced-block). The capabilities module is
 *      the single source of truth; no per-model branches live here.
 *   3. `'native'` falls back to `'fenced-block'` inside this function — native
 *      tool calling goes through provider SDKs (Anthropic, OpenAI, Google),
 *      not text-extraction. If a 'native' model somehow hits this code path,
 *      fenced-block is the safest universal text-based parser.
 *
 * Note: `_providerName` is currently unused; preserved for backwards-compat
 * with callers and possible future use.
 */
export function resolveFormatter(
  _providerName: string,
  modelId: string,
  override?: FormatName,
): ToolCallFormatter {
  if (override) {
    return createFormatter(override);
  }

  const preferred = getCapabilities(modelId).preferred_format;
  // 'native' isn't a text-based formatter — fall through to fenced-block as
  // the universal safe default for any model that mistakenly hits this path.
  const formatterName: FormatName = preferred === 'native' ? 'fenced-block' : preferred;
  return createFormatter(formatterName);
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
 * Stateful streaming filter that suppresses tool-call markup before it reaches
 * the terminal.  When a formatter declares `openTag`/`closeTag`, the filter
 * buffers across chunk boundaries so split tags never leak.  Formatters without
 * those fields fall back to the previous per-chunk regex approach.
 */
export class StreamingMarkupFilter {
  private buffer = '';
  private suppressing = false;
  /** Set to true once the first complete tool-call block has been processed.
   *  When `suppressAfterMatch` is enabled, all further text is discarded. */
  private matchSeen = false;
  private readonly openTag: string | undefined;
  private readonly closeTag: string | undefined;
  private readonly suppressAfterMatch: boolean;
  private readonly fallbackRe: RegExp | undefined;

  constructor(formatter: ToolCallFormatter) {
    if (formatter.openTag && formatter.closeTag) {
      this.openTag = formatter.openTag;
      this.closeTag = formatter.closeTag;
      this.suppressAfterMatch = formatter.suppressAfterMatch ?? false;
    } else {
      this.suppressAfterMatch = false;
      this.fallbackRe = new RegExp(
        formatter.markupPattern.source,
        formatter.markupPattern.flags,
      );
    }
  }

  /** Feed the next streaming chunk; returns text safe to display. */
  write(chunk: string): string {
    if (!this.openTag || !this.closeTag) {
      return this.fallbackRe ? chunk.replace(this.fallbackRe, '') : chunk;
    }

    // After the first tool-call block, discard everything when suppressAfterMatch
    if (this.suppressAfterMatch && this.matchSeen) return '';

    this.buffer += chunk;
    let output = '';

    while (this.buffer.length > 0) {
      if (!this.suppressing) {
        const idx = this.buffer.indexOf(this.openTag);
        if (idx === -1) {
          // Hold back any suffix that could be the start of the open tag
          const hold = this._partialPrefixLen(this.buffer, this.openTag);
          output += this.buffer.slice(0, this.buffer.length - hold);
          this.buffer = hold > 0 ? this.buffer.slice(this.buffer.length - hold) : '';
          break;
        }
        output += this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + this.openTag.length);
        this.suppressing = true;
      } else {
        const idx = this.buffer.indexOf(this.closeTag);
        if (idx === -1) break; // still inside tag — wait for more chunks
        this.buffer = this.buffer.slice(idx + this.closeTag.length);
        this.suppressing = false;
        this.matchSeen = true;
        // If suppressAfterMatch, discard the rest of the buffer immediately
        if (this.suppressAfterMatch) {
          this.buffer = '';
          break;
        }
      }
    }

    return output;
  }

  /**
   * Reset internal state to initial values. Call between agent-loop iterations
   * so `suppressAfterMatch` semantics scope to a single model response, not the
   * full session. Without this, once any turn matches a `<tool_call>` block,
   * every subsequent stream chunk is discarded for the rest of the session.
   */
  reset(): void {
    this.buffer = '';
    this.suppressing = false;
    this.matchSeen = false;
  }

  /** Call once after the stream ends to flush any held-back text. */
  flush(): string {
    if (!this.openTag) return '';
    // Discard if still suppressing (unclosed tag) or post-match suppression is on
    if (this.suppressing || (this.suppressAfterMatch && this.matchSeen)) {
      this.buffer = '';
      this.suppressing = false;
      return '';
    }
    const out = this.buffer;
    this.buffer = '';
    return out;
  }

  /** Returns the length of the longest suffix of `text` that is a prefix of `tag`. */
  private _partialPrefixLen(text: string, tag: string): number {
    for (let len = Math.min(tag.length - 1, text.length); len > 0; len--) {
      if (text.endsWith(tag.slice(0, len))) return len;
    }
    return 0;
  }
}

/** Build a streaming markup filter for the given formatter. */
export function buildStreamingFilter(formatter: ToolCallFormatter): StreamingMarkupFilter {
  return new StreamingMarkupFilter(formatter);
}
