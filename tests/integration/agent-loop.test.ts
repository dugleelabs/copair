/**
 * Integration tests: full agent loop with a mock provider.
 * No real HTTP calls — the mock provider emits scripted StreamChunk sequences.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { ApprovalGate } from '../../src/core/approval-gate.js';
import { ToolExecutor } from '../../src/core/tool-executor.js';
import { setModelOverrides } from '../../src/core/model-capabilities.js';
import type { Provider, StreamChunk, Message, ToolDefinition } from '../../src/providers/interface.js';

// Spec 029 F-11: unknown model IDs throw UnknownModelError. Declare the test
// fixture model up-front so Agent construction can resolve its capabilities.
beforeAll(() => {
  setModelOverrides({ 'mock-model': { tier: 'large' } });
});
afterAll(() => {
  setModelOverrides({});
});

/** Build a ToolExecutor with an auto-approve gate so tests never block on stdin. */
function makeExecutor(registry: ToolRegistry): ToolExecutor {
  return new ToolExecutor(registry, new ApprovalGate('auto-approve'));
}

// Suppress stdout/stderr during tests
beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Build a mock Provider that streams the given chunks */
function mockProvider(chunks: StreamChunk[], opts?: Partial<Provider>): Provider {
  return {
    name: 'mock',
    supportsToolCalling: true,
    supportsStreaming: true,
    maxContextWindow: 128_000,
    async *chat(): AsyncIterableIterator<StreamChunk> {
      for (const c of chunks) yield c;
    },
    ...opts,
  };
}

/** Build a simple tool that echoes its input */
function echoTool() {
  return {
    definition: {
      name: 'echo',
      description: 'Echo the message back',
      inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    },
    async execute(input: Record<string, unknown>) {
      return { content: String(input.message), isError: false };
    },
  };
}

describe('agent loop — plain text response', () => {
  it('returns usage from a single-turn text response', async () => {
    const chunks: StreamChunk[] = [
      { type: 'text', text: 'Hello!' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'done' },
    ];
    const provider = mockProvider(chunks);
    const registry = new ToolRegistry();
    const agent = new Agent(provider, 'mock-model', registry, makeExecutor(registry));

    const { usage } = await agent.handleMessage('Hi');
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});

describe('agent loop — tool call then final response', () => {
  it('executes a tool and returns the final usage', async () => {
    // First call: tool_call
    const firstTurn: StreamChunk[] = [
      {
        type: 'tool_call',
        toolCall: { id: 'tc1', name: 'echo', arguments: JSON.stringify({ message: 'ping' }) },
      },
      { type: 'usage', usage: { inputTokens: 20, outputTokens: 8 } },
      { type: 'done' },
    ];
    // Second call: plain text (after tool result)
    const secondTurn: StreamChunk[] = [
      { type: 'text', text: 'The echo tool replied: ping' },
      { type: 'usage', usage: { inputTokens: 30, outputTokens: 12 } },
      { type: 'done' },
    ];

    let callCount = 0;
    const provider: Provider = {
      name: 'mock',
      supportsToolCalling: true,
      supportsStreaming: true,
      maxContextWindow: 128_000,
      async *chat(): AsyncIterableIterator<StreamChunk> {
        const turn = callCount === 0 ? firstTurn : secondTurn;
        callCount++;
        for (const c of turn) yield c;
      },
    };

    const registry = new ToolRegistry();
    const tool = echoTool();
    registry.register(tool);

    const agent = new Agent(provider, 'mock-model', registry, makeExecutor(registry));
    const { usage } = await agent.handleMessage('echo ping');

    expect(callCount).toBe(2);
    expect(usage).toEqual({ inputTokens: 50, outputTokens: 20 }); // summed
  });
});

describe('agent loop — unknown tool', () => {
  it('returns an error tool_result for unknown tools without crashing', async () => {
    const firstTurn: StreamChunk[] = [
      {
        type: 'tool_call',
        toolCall: { id: 'tc1', name: 'nonexistent', arguments: '{}' },
      },
      { type: 'done' },
    ];
    const secondTurn: StreamChunk[] = [
      { type: 'text', text: 'I see the tool errored.' },
      { type: 'done' },
    ];

    let callCount = 0;
    const provider: Provider = {
      name: 'mock',
      supportsToolCalling: true,
      supportsStreaming: true,
      maxContextWindow: 128_000,
      async *chat(messages: Message[]): AsyncIterableIterator<StreamChunk> {
        if (callCount === 0) {
          callCount++;
          for (const c of firstTurn) yield c;
        } else {
          // Verify the tool_result content says error
          const lastMsg = messages[messages.length - 1];
          const block = lastMsg.content[0];
          expect(block.type).toBe('tool_result');
          if (block.type === 'tool_result') {
            expect(block.isError).toBe(true);
            expect(block.content).toContain('nonexistent');
          }
          for (const c of secondTurn) yield c;
        }
      },
    };

    const registry = new ToolRegistry();
    const agent = new Agent(provider, 'mock-model', registry, makeExecutor(registry));
    await agent.handleMessage('use nonexistent tool');
    // No throw — test passes if we reach here
  });
});

describe('agent loop — tool fallback for non-tool-calling models', () => {
  it('parses tool_call blocks from text when supportsToolCalling is false', async () => {
    const toolCallJson = JSON.stringify({ name: 'echo', arguments: { message: 'hello' } });
    const firstTurn: StreamChunk[] = [
      { type: 'text', text: `Sure!\n\`\`\`tool_call\n${toolCallJson}\n\`\`\`\n` },
      { type: 'done' },
    ];
    const secondTurn: StreamChunk[] = [
      { type: 'text', text: 'Done.' },
      { type: 'done' },
    ];

    let callCount = 0;
    const provider: Provider = {
      name: 'mock-no-tools',
      supportsToolCalling: false,
      supportsStreaming: true,
      maxContextWindow: 128_000,
      async *chat(): AsyncIterableIterator<StreamChunk> {
        const turn = callCount === 0 ? firstTurn : secondTurn;
        callCount++;
        for (const c of turn) yield c;
      },
    };

    const executeMock = vi.fn().mockResolvedValue({ content: 'hello', isError: false });
    const registry = new ToolRegistry();
    registry.register({
      definition: { name: 'echo', description: 'Echo', inputSchema: {} },
      execute: executeMock,
    });

    const agent = new Agent(provider, 'mock-model', registry, makeExecutor(registry));
    await agent.handleMessage('use echo');

    expect(callCount).toBe(2);
    expect(executeMock).toHaveBeenCalledWith({ message: 'hello' });
  });
});
