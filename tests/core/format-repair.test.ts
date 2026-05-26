/**
 * Spec 029 F-14 — Format-error repair tests (T-I07 unit + T-I08 integration).
 *
 * T-I07 covers per-formatter `parseStrict` behavior:
 *   - For each formatter × each `specific_issue` value, assert that
 *     `parseStrict` returns the expected ParseError shape.
 *   - `parseWithStrictFallback` against a stub formatter without parseStrict
 *     returns a `{ specific_issue: 'other' }` ParseError.
 *
 * T-I08 covers agent-loop integration:
 *   - Malformed turn 1 → valid turn 2 → success with 1 retry.
 *   - 3 consecutive malformed turns → escalates via showFormatRepairExhausted.
 *   - Mid-retry usage tokens accumulate correctly.
 *
 * Keeping both suites in one file per the spec — they share fixtures and
 * the integration scenarios cover the same formatters as the unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { QwenXmlFormatter } from '../../src/core/formats/qwen-xml.js';
import { DsmlFormatter } from '../../src/core/formats/dsml.js';
import { FencedBlockFormatter } from '../../src/core/formats/fenced-block.js';
import {
  parseWithStrictFallback,
  type ToolCallFormatter,
  type ParseResult,
} from '../../src/core/formats/interface.js';
import { buildRepairMessage, MAX_REPAIR_RETRIES } from '../../src/core/formats/repair.js';
import { Agent } from '../../src/core/agent.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { ApprovalGate } from '../../src/core/approval-gate.js';
import { ToolExecutor } from '../../src/core/tool-executor.js';
import { SmallModelHarness } from '../../src/core/small-model-harness.js';
import { setModelOverrides } from '../../src/core/model-capabilities.js';
import { Renderer } from '../../src/cli/renderer.js';
import type { Provider, StreamChunk } from '../../src/providers/interface.js';

beforeAll(() => {
  // Mark the small-model fixture as small so the harness engages the repair loop.
  setModelOverrides({
    'mock-small-qwen': {
      tier: 'small',
      preferred_format: 'qwen-xml',
    },
  });
});
afterAll(() => {
  setModelOverrides({});
});

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ── T-I07: unit tests for parseStrict ─────────────────────────────────────

describe('QwenXmlFormatter.parseStrict — specific_issue coverage', () => {
  const fmt = new QwenXmlFormatter();

  it('returns { ok: true, toolCalls: [] } on plain text without markup', () => {
    const result = fmt.parseStrict('just plain text, no tool calls');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.toolCalls).toEqual([]);
  });

  it('returns invalid_json when the body is not valid JSON', () => {
    const result = fmt.parseStrict('<tool_call>\n{this is not json}\n</tool_call>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.specific_issue).toBe('invalid_json');
      expect(result.error.expected_format_example).toContain('<tool_call>');
      expect(result.error.offending_substring.length).toBeLessThanOrEqual(200);
    }
  });

  it('returns unknown_tool when the JSON body lacks a name field', () => {
    const result = fmt.parseStrict('<tool_call>\n{"arguments": {"x": 1}}\n</tool_call>');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.specific_issue).toBe('unknown_tool');
  });

  it('returns bad_arg_type when the JSON body is a primitive (not an object)', () => {
    // Note: today's permissive `parse()` accepts {"name":"x","arguments":"string"} —
    // arg-type validation is a downstream concern. parseStrict catches the
    // format-layer case: body that's valid JSON but not even an object.
    const result = fmt.parseStrict('<tool_call>\n42\n</tool_call>');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.specific_issue).toBe('bad_arg_type');
  });

  it('returns unclosed_tag when <tool_call> is never closed (and body is not parseable)', () => {
    const result = fmt.parseStrict('<tool_call>\n{this is also not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.specific_issue).toBe('unclosed_tag');
  });

  it('preserves the Hermes envelope fallback (spec 028 F-23) on valid hermes input', () => {
    const result = fmt.parseStrict(
      '<tool_call>\n<function=read><parameter=file_path>/p</parameter></function>\n</tool_call>',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('read');
    }
  });
});

describe('DsmlFormatter.parseStrict — specific_issue coverage', () => {
  const fmt = new DsmlFormatter();

  it('returns { ok: true, toolCalls: [] } on plain text', () => {
    const result = fmt.parseStrict('hello world');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.toolCalls).toEqual([]);
  });

  it('returns bad_arg_type when a function_calls block contains no parseable invokes', () => {
    const result = fmt.parseStrict(
      '<｜DSML｜function_calls>\nsome junk no invokes\n</｜DSML｜function_calls>',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.specific_issue).toBe('bad_arg_type');
  });

  it('returns unclosed_tag when the function_calls block has no closing tag', () => {
    const result = fmt.parseStrict('<｜DSML｜function_calls>\nstart of a block');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.specific_issue).toBe('unclosed_tag');
  });

  it('parses a valid DSML block and returns ok with the tool call', () => {
    const valid =
      '<｜DSML｜function_calls>\n' +
      '<｜DSML｜invoke name="read">\n' +
      '<｜DSML｜parameter name="file_path" string="true">/p<｜DSML｜parameter>\n' +
      '</｜DSML｜invoke>\n' +
      '</｜DSML｜function_calls>';
    const result = fmt.parseStrict(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('read');
    }
  });
});

describe('FencedBlockFormatter.parseStrict — specific_issue coverage', () => {
  const fmt = new FencedBlockFormatter();

  it('returns { ok: true, toolCalls: [] } on text without fences', () => {
    const result = fmt.parseStrict('no fences here');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.toolCalls).toEqual([]);
  });

  it('returns invalid_json when the fence body is not valid JSON', () => {
    const result = fmt.parseStrict('```tool_call\n{not valid json\n```');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.specific_issue).toBe('invalid_json');
  });

  it('returns unknown_tool when the JSON body has no name and no bare-shortcut shape', () => {
    const result = fmt.parseStrict('```tool_call\n{"foo": "bar", "baz": "qux"}\n```');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.specific_issue).toBe('unknown_tool');
  });

  it('returns bad_arg_type when the JSON body is a primitive (not an object)', () => {
    const result = fmt.parseStrict('```tool_call\n42\n```');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.specific_issue).toBe('bad_arg_type');
  });

  it('returns unclosed_tag when ``` is opened but never closed', () => {
    const result = fmt.parseStrict('```tool_call\n{"name": "read"');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.specific_issue).toBe('unclosed_tag');
  });
});

describe('parseWithStrictFallback — third-party formatter without parseStrict', () => {
  /** A minimal ToolCallFormatter stub whose `parse` throws — simulates a
   *  third-party formatter that hasn't been updated for spec 029 F-14. */
  function makeStubFormatter(): ToolCallFormatter {
    return {
      name: 'stub',
      markupPattern: /<<>>/g,
      parse() {
        throw new Error('stub-parse-error');
      },
      buildSystemPrompt() {
        return '';
      },
      exampleCall() {
        return '<<example>>';
      },
    };
  }

  it('synthesizes a { specific_issue: "other" } ParseError when parse() throws', () => {
    const result: ParseResult = parseWithStrictFallback(makeStubFormatter(), '<<malformed>>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.specific_issue).toBe('other');
      expect(result.error.message).toContain('stub-parse-error');
      expect(result.error.expected_format_example).toContain('example');
    }
  });

  it('returns ok when the stub formatter parses successfully (no throw)', () => {
    const fmt: ToolCallFormatter = {
      name: 'stub-ok',
      markupPattern: /<<>>/g,
      parse() {
        return { toolCalls: [], remainingText: 'text' };
      },
      buildSystemPrompt() {
        return '';
      },
      exampleCall() {
        return '';
      },
    };
    const result = parseWithStrictFallback(fmt, 'anything');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.remainingText).toBe('text');
  });

  it('delegates to formatter.parseStrict when present (built-in formatter path)', () => {
    const fmt = new QwenXmlFormatter();
    const result = parseWithStrictFallback(fmt, '<tool_call>\n{this is not json}\n</tool_call>');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.specific_issue).toBe('invalid_json');
  });
});

describe('buildRepairMessage — snapshot of the repair template (T-I05 verification)', () => {
  it('matches the design §20.2 template shape', () => {
    const msg = buildRepairMessage({
      kind: 'parse',
      message: 'whatever',
      specific_issue: 'invalid_json',
      expected_format_example: '<tool_call>\nEXAMPLE\n</tool_call>',
      offending_substring: '{broken',
    });
    expect(msg).toBe(
      [
        '[SYSTEM] Your tool call failed to parse.',
        '',
        'Specific issue: invalid json',
        'What you wrote (truncated): {broken',
        '',
        'Expected format:',
        '<tool_call>\nEXAMPLE\n</tool_call>',
        '',
        'Retry with one valid call.',
      ].join('\n'),
    );
  });
});

// ── T-I08: integration tests for the agent-loop repair loop ────────────────

function makeExecutor(registry: ToolRegistry): ToolExecutor {
  return new ToolExecutor(registry, new ApprovalGate('auto-approve'));
}

/**
 * Provider that emits a scripted sequence of streamed responses per chat()
 * call. Each entry is the full text body the assistant emits for that turn.
 * If a `usage` value is supplied per turn, it's emitted as a `usage` chunk.
 */
function scriptedProvider(turns: Array<{ text: string; usage?: { inputTokens: number; outputTokens: number } }>): Provider {
  let i = 0;
  return {
    name: 'mock',
    supportsToolCalling: false, // text-based formatter path, no native tool calls
    supportsStreaming: true,
    maxContextWindow: 128_000,
    async *chat(): AsyncIterableIterator<StreamChunk> {
      const turn = turns[Math.min(i, turns.length - 1)];
      i++;
      yield { type: 'text', text: turn.text };
      if (turn.usage) yield { type: 'usage', usage: turn.usage };
      yield { type: 'done' };
    },
  };
}

describe('Agent + F-14 repair loop — malformed → valid recovers with 1 retry', () => {
  it('shows showFormatRepair once and proceeds with the corrected tool call', async () => {
    const repairSpy = vi.spyOn(Renderer.prototype, 'showFormatRepair');
    const exhaustedSpy = vi.spyOn(Renderer.prototype, 'showFormatRepairExhausted');

    // Turn 1: malformed JSON inside <tool_call>. Turn 2: valid no-tool reply
    // (just text "done"), so the agent exits the outer loop cleanly. The
    // repair loop fires once between turn 1 and turn 2.
    const provider = scriptedProvider([
      { text: '<tool_call>\n{this is not json}\n</tool_call>' },
      { text: 'done' },
    ]);

    const registry = new ToolRegistry();
    const agent = new Agent(provider, 'mock-small-qwen', registry, makeExecutor(registry), {
      harness: new SmallModelHarness('mock-small-qwen'),
    });
    await agent.handleMessage('hello');

    expect(repairSpy).toHaveBeenCalledTimes(1);
    expect(repairSpy.mock.calls[0]?.[0]).toBe('invalid_json');
    expect(exhaustedSpy).not.toHaveBeenCalled();

    // The injected [SYSTEM] repair message must be visible as a user-role
    // entry in the conversation history.
    const history = agent.getConversation().getHistory();
    const flat = JSON.stringify(history);
    expect(flat).toMatch(/\[SYSTEM\] Your tool call failed to parse/);
  });
});

describe('Agent + F-14 repair loop — exhaustion after MAX_REPAIR_RETRIES', () => {
  it('escalates via showFormatRepairExhausted and breaks the outer loop', async () => {
    const repairSpy = vi.spyOn(Renderer.prototype, 'showFormatRepair');
    const exhaustedSpy = vi.spyOn(Renderer.prototype, 'showFormatRepairExhausted');

    // 3 consecutive malformed turns. MAX_REPAIR_RETRIES = 2, so initial parse
    // + 2 retries = 3 total provider calls before escalation fires.
    const provider = scriptedProvider([
      { text: '<tool_call>\n{still not json}\n</tool_call>' },
      { text: '<tool_call>\n{still not json #2}\n</tool_call>' },
      { text: '<tool_call>\n{still not json #3}\n</tool_call>' },
    ]);

    const registry = new ToolRegistry();
    const agent = new Agent(provider, 'mock-small-qwen', registry, makeExecutor(registry), {
      harness: new SmallModelHarness('mock-small-qwen'),
    });
    await agent.handleMessage('hello');

    expect(repairSpy).toHaveBeenCalledTimes(MAX_REPAIR_RETRIES);
    expect(exhaustedSpy).toHaveBeenCalledTimes(1);
    expect(exhaustedSpy.mock.calls[0]?.[0].specific_issue).toBe('invalid_json');
  });
});

describe('Agent + F-14 repair loop — mid-retry usage tokens accumulate', () => {
  it('sums inputTokens and outputTokens across the initial call + each repair retry', async () => {
    const provider = scriptedProvider([
      { text: '<tool_call>\n{not json}\n</tool_call>', usage: { inputTokens: 100, outputTokens: 20 } },
      { text: 'done', usage: { inputTokens: 110, outputTokens: 5 } },
    ]);

    const registry = new ToolRegistry();
    const agent = new Agent(provider, 'mock-small-qwen', registry, makeExecutor(registry), {
      harness: new SmallModelHarness('mock-small-qwen'),
    });
    const result = await agent.handleMessage('hello');

    // Initial turn: 100/20. Repair retry: 110/5. Totals: 210/25.
    expect(result.usage?.inputTokens).toBe(210);
    expect(result.usage?.outputTokens).toBe(25);
  });
});
