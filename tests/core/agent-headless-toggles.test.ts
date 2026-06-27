/**
 * Spec 047 (T-10 / T-11 / T-12) — headless per-feature toggles, run limits, and
 * the `tool-call-parsed` bridge event, exercised through the real agent loop
 * with scripted mock providers (no HTTP).
 *
 * Covers, per T-14:
 *   - toggle guards: each feature on/off changes observable behavior
 *   - `tool-call-parsed` emission on the native path and on invalid text parses
 *   - `--max-tokens` / `--max-tool-calls` breach paths terminate cleanly
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { ApprovalGate } from '../../src/core/approval-gate.js';
import { ToolExecutor } from '../../src/core/tool-executor.js';
import { SmallModelHarness } from '../../src/core/small-model-harness.js';
import { AgentBridge } from '../../src/cli/ui/agent-bridge.js';
import { installNoHangPromptHandlers } from '../../src/cli/headless/approval.js';
import { setModelOverrides } from '../../src/core/model-capabilities.js';
import { Renderer } from '../../src/cli/renderer.js';
import type { Provider, StreamChunk } from '../../src/providers/interface.js';

beforeAll(() => {
  setModelOverrides({
    'mock-model': { tier: 'large' },
    'mock-small-qwen': { tier: 'small', preferred_format: 'qwen-xml' },
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

function makeExecutor(registry: ToolRegistry): ToolExecutor {
  return new ToolExecutor(registry, new ApprovalGate('auto-approve'));
}

function echoRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: 'echo',
      description: 'Echo',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
    },
    async execute(input: Record<string, unknown>) {
      return { content: String(input.message), isError: false };
    },
  });
  return registry;
}

/** Native-tool-calling provider: emits one distinct echo tool call per turn,
 *  then a plain-text "done" after `toolTurns` turns. */
function distinctToolProvider(toolTurns: number): Provider {
  let i = 0;
  return {
    name: 'mock',
    supportsToolCalling: true,
    supportsStreaming: true,
    maxContextWindow: 128_000,
    async *chat(): AsyncIterableIterator<StreamChunk> {
      const turn = i++;
      if (turn < toolTurns) {
        yield {
          type: 'tool_call',
          toolCall: { id: `tc-${turn}`, name: 'echo', arguments: JSON.stringify({ message: `m${turn}` }) },
        };
        yield { type: 'done' };
      } else {
        yield { type: 'text', text: 'done' };
        yield { type: 'done' };
      }
    },
  };
}

/** Identical-tool-call provider (loop fixture). */
function loopingProvider(stuckTurns: number): Provider {
  let i = 0;
  return {
    name: 'mock',
    supportsToolCalling: true,
    supportsStreaming: true,
    maxContextWindow: 128_000,
    async *chat(): AsyncIterableIterator<StreamChunk> {
      const turn = i++;
      if (turn < stuckTurns) {
        yield {
          type: 'tool_call',
          toolCall: { id: `tc-${turn}`, name: 'echo', arguments: JSON.stringify({ message: 'same' }) },
        };
        yield { type: 'done' };
      } else {
        yield { type: 'text', text: 'done' };
        yield { type: 'done' };
      }
    },
  };
}

function scriptedTextProvider(turns: string[]): Provider {
  let i = 0;
  return {
    name: 'mock',
    supportsToolCalling: false,
    supportsStreaming: true,
    maxContextWindow: 128_000,
    async *chat(): AsyncIterableIterator<StreamChunk> {
      yield { type: 'text', text: turns[Math.min(i, turns.length - 1)] };
      i++;
      yield { type: 'done' };
    },
  };
}

// ── T-10: tool-call-parsed event ──────────────────────────────────────────────

describe('tool-call-parsed event (T-10)', () => {
  it('emits {valid:true, formatter:"native", tool} once per native tool call', async () => {
    const bridge = new AgentBridge();
    const events: Array<{ valid: boolean; formatter: string; tool?: string }> = [];
    bridge.on('tool-call-parsed', (d) => events.push(d));

    const registry = echoRegistry();
    const agent = new Agent(distinctToolProvider(2), 'mock-model', registry, makeExecutor(registry), {
      bridge,
    });
    await agent.handleMessage('go');

    // One native event per native tool call. (The final plain-text turn also
    // emits one large-path `valid:true` event with no tool — the documented
    // T-10 limitation — so we assert on the native-formatter events.)
    const native = events.filter((e) => e.formatter === 'native');
    expect(native).toHaveLength(2);
    expect(native.every((e) => e.valid && e.tool === 'echo')).toBe(true);
  });

  it('emits a valid:false event on a malformed text parse (small-model path)', async () => {
    const bridge = new AgentBridge();
    const events: Array<{ valid: boolean; formatter: string }> = [];
    bridge.on('tool-call-parsed', (d) => events.push(d));

    // Malformed qwen-xml then a clean reply so the run terminates.
    const provider = scriptedTextProvider(['<tool_call>\n{this is not json}\n</tool_call>', 'done']);
    const registry = echoRegistry();
    const agent = new Agent(provider, 'mock-small-qwen', registry, makeExecutor(registry), {
      bridge,
      harness: new SmallModelHarness('mock-small-qwen'),
    });
    await agent.handleMessage('go');

    expect(events.some((e) => !e.valid)).toBe(true);
    expect(events.every((e) => e.formatter === 'qwen-xml')).toBe(true);
  });
});

// ── T-11: per-feature toggle guards ───────────────────────────────────────────

describe('loop-guard toggle (T-11)', () => {
  it('ON (default): an identical-call loop halts with terminationReason "loop-halt"', async () => {
    const haltSpy = vi.spyOn(Renderer.prototype, 'showLoopHalt');
    const registry = echoRegistry();
    const agent = new Agent(loopingProvider(10), 'mock-model', registry, makeExecutor(registry), {
      harness: new SmallModelHarness('mock-model', {}, true), // small, default toggles
    });
    const { terminationReason } = await agent.handleMessage('go');
    expect(terminationReason).toBe('loop-halt');
    expect(haltSpy).toHaveBeenCalledTimes(1);
  });

  it('OFF: the loop never halts; it runs to the tool-call cap instead', async () => {
    const haltSpy = vi.spyOn(Renderer.prototype, 'showLoopHalt');
    const registry = echoRegistry();
    const agent = new Agent(loopingProvider(10), 'mock-model', registry, makeExecutor(registry), {
      harness: new SmallModelHarness('mock-model', { enable_loop_guard: false }, true),
      maxToolCallsOverride: 3,
    });
    const { terminationReason } = await agent.handleMessage('go');
    expect(terminationReason).toBe('max-tool-calls');
    expect(haltSpy).not.toHaveBeenCalled();
  });
});

describe('format-repair toggle (T-11)', () => {
  it('ON (default): a malformed tool call triggers a repair retry', async () => {
    const repairSpy = vi.spyOn(Renderer.prototype, 'showFormatRepair');
    const provider = scriptedTextProvider(['<tool_call>\n{not json}\n</tool_call>', 'done']);
    const registry = echoRegistry();
    const agent = new Agent(provider, 'mock-small-qwen', registry, makeExecutor(registry), {
      harness: new SmallModelHarness('mock-small-qwen'),
    });
    await agent.handleMessage('go');
    expect(repairSpy).toHaveBeenCalled();
  });

  it('OFF: a malformed tool call skips the repair retry entirely', async () => {
    const repairSpy = vi.spyOn(Renderer.prototype, 'showFormatRepair');
    const provider = scriptedTextProvider(['<tool_call>\n{not json}\n</tool_call>', 'done']);
    const registry = echoRegistry();
    const agent = new Agent(provider, 'mock-small-qwen', registry, makeExecutor(registry), {
      harness: new SmallModelHarness('mock-small-qwen', { enable_format_repair: false }),
    });
    await agent.handleMessage('go');
    expect(repairSpy).not.toHaveBeenCalled();
  });
});

describe('inspect-before-act toggle (T-11)', () => {
  it('includes the inspect-before-act rule when ON and drops it when OFF', () => {
    const on = new SmallModelHarness('mock-small-qwen').getSystemPromptAddition() ?? '';
    const off =
      new SmallModelHarness('mock-small-qwen', { enable_inspect_before_act: false }).getSystemPromptAddition() ??
      '';
    expect(on.length).toBeGreaterThan(off.length);
    // The ON prompt carries a rule the OFF prompt does not.
    expect(on).not.toBe(off);
  });
});

// ── T-12: run limits ──────────────────────────────────────────────────────────

describe('run limits (T-12)', () => {
  it('--max-tool-calls: cap breach terminates with "max-tool-calls"', async () => {
    const registry = echoRegistry();
    // Distinct calls so the loop guard never trips; cap at 2 → 3rd call breaches.
    const agent = new Agent(distinctToolProvider(10), 'mock-model', registry, makeExecutor(registry), {
      maxToolCallsOverride: 2,
    });
    const { terminationReason } = await agent.handleMessage('go');
    expect(terminationReason).toBe('max-tool-calls');
  });

  it('context pressure + no-hang abort handler terminates with "context-exhausted"', async () => {
    // maxContextWindow 100 → detectContextLimit fires once lastInputTokens ≥ 90.
    const provider: Provider = {
      name: 'mock',
      supportsToolCalling: true,
      supportsStreaming: true,
      maxContextWindow: 100,
      async *chat(): AsyncIterableIterator<StreamChunk> {
        yield { type: 'text', text: 'near the edge' };
        yield { type: 'usage', usage: { inputTokens: 95, outputTokens: 1 } };
        yield { type: 'done' };
      },
    };
    const bridge = new AgentBridge();
    installNoHangPromptHandlers(bridge); // context-limit-action → 'abort'
    const registry = echoRegistry();
    const agent = new Agent(provider, 'mock-model', registry, makeExecutor(registry), { bridge });
    const { terminationReason } = await agent.handleMessage('go');
    expect(terminationReason).toBe('context-exhausted');
  });

  it('--max-tokens: budget breach terminates with "max-tokens"', async () => {
    const provider: Provider = {
      name: 'mock',
      supportsToolCalling: true,
      supportsStreaming: true,
      maxContextWindow: 128_000,
      async *chat(): AsyncIterableIterator<StreamChunk> {
        yield { type: 'text', text: 'thinking' };
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } };
        yield { type: 'done' };
      },
    };
    const registry = echoRegistry();
    const agent = new Agent(provider, 'mock-model', registry, makeExecutor(registry), {
      maxTokensBudget: 50, // 150 accrued ≥ 50 → breach
    });
    const { terminationReason } = await agent.handleMessage('go');
    expect(terminationReason).toBe('max-tokens');
  });
});
