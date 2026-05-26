import type { ToolDefinition } from '../../providers/interface.js';

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
  /** Provider-specific metadata (e.g. native tool-call IDs). Passed through opaquely. */
  metadata?: Record<string, unknown>;
}

/**
 * Spec 029 F-14: structured parse error returned by `parseStrict`. The
 * `specific_issue` enum drives the repair-message template (§20.2) and the
 * spec 040 observability hook on `Renderer.showFormatRepair(specific_issue)`.
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
 * Spec 029 F-14: non-throwing parse result. Success carries the same shape as
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
   * Spec 029 F-14: non-throwing variant that returns a structured error on
   * parse failure. Optional so third-party formatters that implement
   * `ToolCallFormatter` keep working unchanged — callers that need the
   * structured-error path go through `parseWithStrictFallback` which
   * synthesises a generic error when this method is absent. Built-in copair
   * formatters (qwen-xml, dsml, fenced-block) implement it natively.
   */
  parseStrict?(text: string): ParseResult;
}

/**
 * Default-impl wrapper for the F-14 repair loop. When the formatter does not
 * implement `parseStrict` (third-party formatters), wraps the legacy `parse`
 * in try/catch and synthesises a generic `specific_issue: 'other'` error.
 * Built-in copair formatters override with rich, per-issue diagnostics.
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
