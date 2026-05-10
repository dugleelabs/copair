/**
 * Tests for spec 028 T-C16: StreamingMarkupFilter.reset()
 *
 * The filter strips `<tool_call>...</tool_call>` markup from streamed text
 * before it reaches the terminal. Formatters like qwen-xml and dsml set
 * `suppressAfterMatch = true` to discard hallucinated junk text after a
 * tool-call block within a single response.
 *
 * The bug fixed by F-25: the agent reuses one filter instance across the
 * agent loop, so `matchSeen` is sticky for the session. Once any turn
 * produces a `<tool_call>` block, every subsequent chunk gets discarded.
 * `reset()` scopes filter state to a single model response.
 */
import { describe, it, expect } from 'vitest';
import { StreamingMarkupFilter, buildStreamingFilter } from '../../../src/core/formats/index.js';
import { QwenXmlFormatter } from '../../../src/core/formats/qwen-xml.js';
import { DsmlFormatter } from '../../../src/core/formats/dsml.js';
import { FencedBlockFormatter } from '../../../src/core/formats/fenced-block.js';

describe('StreamingMarkupFilter — reset()', () => {
  it('clears matchSeen so post-match suppression no longer applies', () => {
    const filter = new StreamingMarkupFilter(new QwenXmlFormatter());

    // First response: contains a tool_call block. Filter strips the block,
    // sets matchSeen = true, and (because suppressAfterMatch) discards
    // anything after.
    filter.write('Let me check.\n<tool_call>\n{"name":"read","arguments":{"file_path":"/x"}}\n</tool_call>\nignored trailing text');
    // After this point, matchSeen is true; further writes return ''.
    expect(filter.write('this should be discarded')).toBe('');

    // Reset between responses (simulates F-25's agent-loop reset).
    filter.reset();

    // Second response: pure text answer. Should stream through normally.
    const out = filter.write('Here is the analysis: the codebase has 22 files.');
    expect(out).toBe('Here is the analysis: the codebase has 22 files.');
  });

  it('clears suppressing so an incomplete prior tool_call block does not leak', () => {
    const filter = new StreamingMarkupFilter(new QwenXmlFormatter());

    // Feed an unclosed `<tool_call>` (no closing tag yet). Filter enters
    // suppressing state and buffers everything after the open tag.
    filter.write('text before\n<tool_call>\n{"name":"read"');
    // Now we're in suppressing mode. Without reset, additional text stays
    // hidden until `</tool_call>` arrives.

    filter.reset();

    // After reset, plain text streams again immediately.
    expect(filter.write('plain text after reset')).toBe('plain text after reset');
  });

  it('clears buffer so partial-prefix holdover is not re-emitted', () => {
    const filter = new StreamingMarkupFilter(new QwenXmlFormatter());

    // Feed a chunk ending in a partial open-tag prefix. The filter holds
    // back the suffix in case the next chunk completes the tag.
    filter.write('hello <tool_'); // "<tool_" is a prefix of "<tool_call>"

    filter.reset();

    // After reset, the held-back buffer is gone — and a fresh chunk
    // streams through as plain text without re-emitting the held suffix.
    expect(filter.write('world')).toBe('world');
  });

  it('preserves in-response suppression — text after </tool_call> is still discarded without an intervening reset', () => {
    const filter = new StreamingMarkupFilter(new QwenXmlFormatter());

    // Within a single response (no reset), trailing text after the closing
    // tag must still be suppressed. This is the original `suppressAfterMatch`
    // design intent for Qwen/DeepSeek hallucinated trailing junk.
    const part1 = filter.write('intro <tool_call>\n{"name":"read","arguments":{"file_path":"/x"}}\n</tool_call>');
    const part2 = filter.write(' hallucinated trailing junk');
    expect(part1).toBe('intro ');
    expect(part2).toBe('');
  });

  it('is safe and idempotent for formatters without suppressAfterMatch', () => {
    const filter = new StreamingMarkupFilter(new FencedBlockFormatter());

    // Fenced-block formatter does not set openTag/closeTag in the same way
    // and does not set suppressAfterMatch. Reset should be a no-op.
    expect(() => {
      filter.reset();
      filter.reset();
      filter.reset();
    }).not.toThrow();

    // Plain text still streams.
    expect(filter.write('hello world')).toBe('hello world');
  });

  it('is safe and idempotent for DsmlFormatter (uses fallback regex path, no stateful matchSeen)', () => {
    // DSML formatter does not declare openTag/closeTag, so the filter takes
    // the fallback regex path (per-chunk replacement, no internal state).
    // `suppressAfterMatch` is forced false in the fallback branch. `reset()`
    // is therefore a no-op but must remain safe and idempotent.
    const filter = new StreamingMarkupFilter(new DsmlFormatter());

    expect(() => {
      filter.reset();
      filter.reset();
    }).not.toThrow();

    // Per-chunk DSML stripping still works after reset (fallback regex path).
    const out = filter.write('before <｜DSML｜function_calls>x</｜DSML｜function_calls> after');
    expect(out).toContain('before');
    expect(out).toContain('after');
    expect(out).not.toContain('DSML');
  });
});

describe('buildStreamingFilter — exported factory still wires reset()', () => {
  it('returns a filter that exposes reset()', () => {
    const filter = buildStreamingFilter(new QwenXmlFormatter());
    expect(typeof filter.reset).toBe('function');
    filter.write('<tool_call>\n{"name":"x"}\n</tool_call>');
    expect(filter.write('discarded')).toBe('');
    filter.reset();
    expect(filter.write('streams')).toBe('streams');
  });
});
