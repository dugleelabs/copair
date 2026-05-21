/**
 * Spec 029 F-13 — Agent + LoopGuard integration tests (T-H06).
 *
 * Drives a stubbed provider that emits an identical tool_call on every turn
 * against a stubbed tool that returns an identical result. Asserts the
 * Agent reacts to the LoopGuard nudge / halt actions:
 *   - Halt: turn aborts within 3 tool-call turns; showLoopHalt was called
 *     once; conversation history contains the synthetic [SYSTEM] tool_result.
 *   - Nudge: after 2 identical turns, showLoopNudge was called; the
 *     conversation contains a user-role [SYSTEM] message that the next
 *     iteration's provider call would see.
 *   - Reset: two sequential handleMessage() calls — the second starts fresh
 *     (no carried-over deque entries from the first).
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { ApprovalGate } from '../../src/core/approval-gate.js';
import { ToolExecutor } from '../../src/core/tool-executor.js';
import { setModelOverrides } from '../../src/core/model-capabilities.js';
import { Renderer } from '../../src/cli/renderer.js';
import type { Provider, StreamChunk, Message } from '../../src/providers/interface.js';

beforeAll(() => {
  setModelOverrides({ 'mock-model': { tier: 'large' } });
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

/** Tool that always returns the same content — the "stuck" loop fixture. */
function stuckTool() {
  return {
    definition: {
      name: 'stuck',
      description: 'Always returns the same result',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
    },
    async execute() {
      return { content: 'same-result', isError: false };
    },
  };
}

/** Provider that emits an identical stuck-tool call for the first N turns,
 *  then a plain-text "done" reply so the loop terminates if the agent ever
 *  proceeds past the looping turns. */
function loopingProvider(stuckTurns: number): Provider {
  let callCount = 0;
  return {
    name: 'mock',
    supportsToolCalling: true,
    supportsStreaming: true,
    maxContextWindow: 128_000,
    async *chat(): AsyncIterableIterator<StreamChunk> {
      const turn = callCount++;
      if (turn < stuckTurns) {
        yield {
          type: 'tool_call',
          toolCall: {
            id: `tc-${turn}`,
            name: 'stuck',
            arguments: JSON.stringify({ q: 'find it' }),
          },
        };
        yield { type: 'done' };
      } else {
        yield { type: 'text', text: 'done' };
        yield { type: 'done' };
      }
    },
  };
}

describe('Agent + LoopGuard — halt case', () => {
  it('halts within 3 identical tool turns and emits showLoopHalt', async () => {
    const haltSpy = vi.spyOn(Renderer.prototype, 'showLoopHalt');
    const nudgeSpy = vi.spyOn(Renderer.prototype, 'showLoopNudge');

    const provider = loopingProvider(10); // would loop forever if not halted
    const registry = new ToolRegistry();
    registry.register(stuckTool());
    const agent = new Agent(provider, 'mock-model', registry, makeExecutor(registry));

    await agent.handleMessage('find foo');

    // showLoopHalt called exactly once (on the 3rd repeat)
    expect(haltSpy).toHaveBeenCalledTimes(1);
    // showLoopNudge called on the 2nd repeat (before halt fires on the 3rd)
    expect(nudgeSpy).toHaveBeenCalledTimes(1);

    // Halt message mentions the tool name and the 3-times threshold
    const haltArg = haltSpy.mock.calls[0]?.[0] ?? '';
    expect(haltArg).toMatch(/stuck/);
    expect(haltArg).toMatch(/3 times/);

    // Conversation history should contain the synthetic [SYSTEM] tool_result
    const history = agent.getConversation().getHistory();
    const flat = JSON.stringify(history);
    expect(flat).toMatch(/\[SYSTEM\].*Returning partial result/);
  });
});

describe('Agent + LoopGuard — nudge case', () => {
  it('after 2 identical turns, injects [SYSTEM] nudge into conversation', async () => {
    const nudgeSpy = vi.spyOn(Renderer.prototype, 'showLoopNudge');
    const haltSpy = vi.spyOn(Renderer.prototype, 'showLoopHalt');

    // Loop exactly twice — third turn is plain text "done" so the agent
    // exits the outer loop normally without ever halting.
    const provider = loopingProvider(2);
    const registry = new ToolRegistry();
    registry.register(stuckTool());
    const agent = new Agent(provider, 'mock-model', registry, makeExecutor(registry));

    await agent.handleMessage('first message');

    // Nudge fired on 2nd identical turn; halt never fired (only 2 turns)
    expect(nudgeSpy).toHaveBeenCalledTimes(1);
    expect(haltSpy).not.toHaveBeenCalled();

    // The injected [SYSTEM] nudge message must be present as a user-role
    // entry in the conversation history (the next iteration sees it).
    const history = agent.getConversation().getHistory();
    const userMessagesWithSystem = history.filter(
      (m) =>
        m.role === 'user' &&
        JSON.stringify(m.content).includes('[SYSTEM]') &&
        JSON.stringify(m.content).includes('Try a different approach'),
    );
    expect(userMessagesWithSystem.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Agent + LoopGuard — reset between handleMessage() calls', () => {
  it('second message starts with a fresh deque (no carried-over hashes)', async () => {
    const nudgeSpy = vi.spyOn(Renderer.prototype, 'showLoopNudge');

    // Build a provider that returns 1 stuck-tool call per handleMessage call
    // then "done". So each handleMessage sees exactly ONE tool call. Across
    // two handleMessage calls, that's 2 identical tuples — but the deque
    // resets between handleMessage calls, so neither should ever trip.
    let totalCalls = 0;
    const provider: Provider = {
      name: 'mock',
      supportsToolCalling: true,
      supportsStreaming: true,
      maxContextWindow: 128_000,
      async *chat(messages: Message[]): AsyncIterableIterator<StreamChunk> {
        const callIndex = totalCalls++;
        // Each handleMessage gets 2 provider calls: first emits tool_call,
        // second emits "done". The provider is stateful across both.
        // We use the message count to know whether we're in the first or
        // second iteration of the current handleMessage call.
        const lastMsg = messages[messages.length - 1];
        const isToolResult =
          lastMsg.role === 'user' &&
          Array.isArray(lastMsg.content) &&
          lastMsg.content[0]?.type === 'tool_result';
        if (!isToolResult) {
          yield {
            type: 'tool_call',
            toolCall: {
              id: `tc-${callIndex}`,
              name: 'stuck',
              arguments: JSON.stringify({ q: 'find it' }),
            },
          };
          yield { type: 'done' };
        } else {
          yield { type: 'text', text: 'done' };
          yield { type: 'done' };
        }
      },
    };

    const registry = new ToolRegistry();
    registry.register(stuckTool());
    const agent = new Agent(provider, 'mock-model', registry, makeExecutor(registry));

    await agent.handleMessage('first');
    await agent.handleMessage('second');

    // If the deque had NOT been reset between handleMessage calls, the
    // second message's stuck-tool call would be the 2nd identical tuple and
    // would trip the nudge. The reset is what keeps the count at 0.
    expect(nudgeSpy).not.toHaveBeenCalled();
  });
});
