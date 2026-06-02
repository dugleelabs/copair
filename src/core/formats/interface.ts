import type { ToolDefinition } from '../../providers/interface.js';

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
  /** Provider-specific metadata (e.g. native tool-call IDs). Passed through opaquely. */
  metadata?: Record<string, unknown>;
}

/**
 * spec 029 (F-14): structured parse error returned by `parseStrict`. The
 * `specific_issue` enum drives the repair-message template and the renderer's
 * format-repair event.
 */
export interface ParseError {
  kind: 'parse';
  /** Human-readable error message — surfaced to the model in the repair prompt. */
  message: string;
  /** A canonical example of valid markup for this formatter (≈formatter.exampleCall()). */
  expected_format_example: string;
  /** The part of the model's output that failed to parse, ≤200 chars. */
  offending_substring: string;
  specific_issue: 'unknown_tool' | 'bad_arg_type' | 'unclosed_tag' | 'invalid_json' | 'other';
}

/**
 * spec 029 (F-14): non-throwing parse result. Success carries the same shape as
 * legacy `parse(text)` so call sites can swap in `parseStrict` without
 * remapping fields.
 */
export type ParseResult =
  | { ok: true; toolCalls: ParsedToolCall[]; remainingText: string }
  | { ok: false; error: ParseError };

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
  /** Return a minimal example tool call in this formatter's markup language. */
  exampleCall(): string;

  /**
   * spec 029 (F-14): non-throwing variant returning a structured error on parse
   * failure. Optional — third-party formatters without it degrade through
   * `parseWithStrictFallback`; the built-in formatters implement it natively.
   */
  parseStrict?(text: string): ParseResult;
}

/**
 * spec 029 (F-14): wrapper for the repair loop. When a formatter doesn't
 * implement `parseStrict`, wraps legacy `parse` in try/catch and synthesises a
 * generic `specific_issue: 'other'` error.
 */
export function parseWithStrictFallback(
  formatter: ToolCallFormatter,
  text: string,
): ParseResult {
  if (formatter.parseStrict) return formatter.parseStrict(text);
  try {
    const { toolCalls, remainingText } = formatter.parse(text);
    return { ok: true, toolCalls, remainingText };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'parse',
        message: err instanceof Error ? err.message : String(err),
        expected_format_example: formatter.exampleCall(),
        offending_substring: text.slice(0, 200),
        specific_issue: 'other',
      },
    };
  }
}
