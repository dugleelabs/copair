import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import { PluginManager } from '../../src/core/plugin-manager.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { ToolExecutor } from '../../src/core/tool-executor.js';
import { ApprovalGate } from '../../src/core/approval-gate.js';
import { setModelOverrides } from '../../src/core/model-capabilities.js';
import type { Provider, StreamChunk, ProviderOptions, Message, ToolDefinition } from '../../src/providers/interface.js';
import type { CopairPlugin, PreRequestEvent, PostRequestEvent } from '../../src/plugins/interface.js';

// Spec 029 F-11: unknown model IDs throw UnknownModelError. Declare the test
// fixture model up-front so Agent construction can resolve its capabilities.
beforeAll(() => {
  setModelOverrides({ 'test-model': { tier: 'large' } });
});
afterAll(() => {
  setModelOverrides({});
});

/** Create a mock provider that streams a simple text response. */
function makeMockProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    name: 'mock',
    supportsToolCalling: true,
    supportsStreaming: true,
    maxContextWindow: 100_000,
    async *chat(): AsyncIterableIterator<StreamChunk> {
      yield { type: 'text', text: 'Hello from mock' };
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } };
      yield { type: 'done' };
    },
    ...overrides,
  };
}

function makeAgent(opts: {
  provider?: Provider;
  pluginManager?: PluginManager;
} = {}) {
  const provider = opts.provider ?? makeMockProvider();
  const toolRegistry = new ToolRegistry();
  const gate = new ApprovalGate('auto-approve', []);
  const executor = new ToolExecutor(toolRegistry, gate);

  return new Agent(provider, 'test-model', toolRegistry, executor, {
    pluginManager: opts.pluginManager,
  });
}

describe('Agent plugin hooks', () => {
  describe('preRequest', () => {
    it('passes modified systemPrompt to provider', async () => {
      const pm = new PluginManager();
      const receivedOptions: ProviderOptions[] = [];

      const provider = makeMockProvider({
        async *chat(_msgs: Message[], _tools: ToolDefinition[], opts: ProviderOptions): AsyncIterableIterator<StreamChunk> {
          receivedOptions.push(opts);
          yield { type: 'text', text: 'ok' };
          yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } };
          yield { type: 'done' };
        },
      });

      const plugin: CopairPlugin = {
        name: 'test-modifier',
        version: '1.0.0',
        preRequest: (e: PreRequestEvent) => ({
          ...e,
          systemPrompt: e.systemPrompt + '\n[PLUGIN INJECTED]',
        }),
      };

      pm.register(plugin);
      const agent = makeAgent({ provider, pluginManager: pm });
      await agent.handleMessage('hi');

      expect(receivedOptions.length).toBeGreaterThan(0);
      expect(receivedOptions[0].systemPrompt).toContain('[PLUGIN INJECTED]');
    });

    it('continues with unmodified event if plugin throws', async () => {
      const pm = new PluginManager();
      const receivedOptions: ProviderOptions[] = [];

      const provider = makeMockProvider({
        async *chat(_msgs: Message[], _tools: ToolDefinition[], opts: ProviderOptions): AsyncIterableIterator<StreamChunk> {
          receivedOptions.push(opts);
          yield { type: 'text', text: 'ok' };
          yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } };
          yield { type: 'done' };
        },
      });

      pm.register({
        name: 'bad-plugin',
        version: '1.0.0',
        preRequest: () => { throw new Error('boom'); },
      });

      const agent = makeAgent({ provider, pluginManager: pm });

      // Should not throw
      await expect(agent.handleMessage('hi')).resolves.toBeDefined();
      expect(receivedOptions.length).toBeGreaterThan(0);
    });
  });

  describe('postRequest', () => {
    it('receives correct usage data', async () => {
      const pm = new PluginManager();
      const receivedEvents: PostRequestEvent[] = [];

      const plugin: CopairPlugin = {
        name: 'test-observer',
        version: '1.0.0',
        postRequest: (e: PostRequestEvent) => { receivedEvents.push(e); },
      };

      pm.register(plugin);
      const agent = makeAgent({ pluginManager: pm });
      await agent.handleMessage('hi');

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].response.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
      expect(receivedEvents[0].model).toBe('test-model');
    });
  });

  describe('interceptProvider', () => {
    it('uses overridden provider from plugin', async () => {
      const pm = new PluginManager();
      const overrideChatFn = vi.fn(async function* (): AsyncIterableIterator<StreamChunk> {
        yield { type: 'text', text: 'from override' };
        yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 10 } };
        yield { type: 'done' };
      });

      const overrideProvider = makeMockProvider({ chat: overrideChatFn });
      const originalChatFn = vi.fn(async function* (): AsyncIterableIterator<StreamChunk> {
        yield { type: 'text', text: 'from original' };
        yield { type: 'done' };
      });
      const originalProvider = makeMockProvider({ chat: originalChatFn });

      pm.register({
        name: 'test-interceptor',
        version: '1.0.0',
        providerInterceptor: () => overrideProvider,
      });

      const agent = makeAgent({ provider: originalProvider, pluginManager: pm });
      await agent.handleMessage('hi');

      expect(overrideChatFn).toHaveBeenCalled();
      expect(originalChatFn).not.toHaveBeenCalled();
    });

    it('uses original provider when plugin returns undefined', async () => {
      const pm = new PluginManager();
      const originalChatFn = vi.fn(async function* (): AsyncIterableIterator<StreamChunk> {
        yield { type: 'text', text: 'from original' };
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } };
        yield { type: 'done' };
      });
      const originalProvider = makeMockProvider({ chat: originalChatFn });

      pm.register({
        name: 'passthrough',
        version: '1.0.0',
        providerInterceptor: () => undefined,
      });

      const agent = makeAgent({ provider: originalProvider, pluginManager: pm });
      await agent.handleMessage('hi');

      expect(originalChatFn).toHaveBeenCalled();
    });
  });

  describe('no plugin manager', () => {
    it('works without pluginManager (default no-op)', async () => {
      const agent = makeAgent();
      const result = await agent.handleMessage('hi');
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });
  });
});
