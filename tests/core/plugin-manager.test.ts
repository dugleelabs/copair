import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginManager } from '../../src/core/plugin-manager.js';
import type {
  CopairPlugin,
  PreRequestEvent,
  PostRequestEvent,
  ProviderInterceptEvent,
  PluginContext,
} from '../../src/plugins/interface.js';
import type { Provider } from '../../src/providers/interface.js';

function makePlugin(overrides: Partial<CopairPlugin> = {}): CopairPlugin {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    ...overrides,
  };
}

function makePreRequestEvent(
  overrides: Partial<PreRequestEvent> = {},
): PreRequestEvent {
  return {
    messages: [],
    tools: [],
    systemPrompt: 'You are helpful.',
    provider: {} as Provider,
    model: 'test-model',
    meta: {},
    ...overrides,
  };
}

function makeProviderInterceptEvent(
  overrides: Partial<ProviderInterceptEvent> = {},
): ProviderInterceptEvent {
  return {
    currentProvider: {} as Provider,
    model: 'test-model',
    messages: [],
    tokenCount: 100,
    ...overrides,
  };
}

describe('PluginManager', () => {
  let pm: PluginManager;

  beforeEach(() => {
    pm = new PluginManager();
  });

  describe('register', () => {
    it('registers a plugin and increments count', () => {
      expect(pm.count).toBe(0);
      pm.register(makePlugin());
      expect(pm.count).toBe(1);
    });

    it('registers multiple plugins', () => {
      pm.register(makePlugin({ name: 'a' }));
      pm.register(makePlugin({ name: 'b' }));
      expect(pm.count).toBe(2);
    });
  });

  describe('initialize', () => {
    it('calls initialize on each plugin', async () => {
      const init1 = vi.fn();
      const init2 = vi.fn();
      pm.register(makePlugin({ name: 'a', initialize: init1 }));
      pm.register(makePlugin({ name: 'b', initialize: init2 }));

      await pm.initialize({} as PluginContext);

      expect(init1).toHaveBeenCalledOnce();
      expect(init2).toHaveBeenCalledOnce();
    });

    it('passes context to initialize', async () => {
      const init = vi.fn();
      pm.register(makePlugin({ initialize: init }));

      const ctx = { version: '1.0.0', edition: 'community' } as PluginContext;
      await pm.initialize(ctx);

      expect(init).toHaveBeenCalledWith(ctx);
    });

    it('does not throw if a plugin initialize fails', async () => {
      pm.register(
        makePlugin({
          name: 'bad',
          initialize: () => {
            throw new Error('boom');
          },
        }),
      );
      pm.register(makePlugin({ name: 'good', initialize: vi.fn() }));

      await expect(pm.initialize({} as PluginContext)).resolves.not.toThrow();
    });

    it('continues initializing after a plugin fails', async () => {
      const goodInit = vi.fn();
      pm.register(
        makePlugin({
          name: 'bad',
          initialize: () => {
            throw new Error('boom');
          },
        }),
      );
      pm.register(makePlugin({ name: 'good', initialize: goodInit }));

      await pm.initialize({} as PluginContext);

      expect(goodInit).toHaveBeenCalledOnce();
    });
  });

  describe('preRequest', () => {
    it('returns event unchanged when no plugins registered', async () => {
      const event = makePreRequestEvent();
      const result = await pm.preRequest(event);
      expect(result).toBe(event);
    });

    it('passes event through a single plugin', async () => {
      pm.register(
        makePlugin({
          preRequest: (e) => ({ ...e, systemPrompt: 'modified' }),
        }),
      );

      const result = await pm.preRequest(makePreRequestEvent());
      expect(result.systemPrompt).toBe('modified');
    });

    it('chains plugins in registration order', async () => {
      pm.register(
        makePlugin({
          name: 'first',
          preRequest: (e) => ({ ...e, systemPrompt: e.systemPrompt + ' [1]' }),
        }),
      );
      pm.register(
        makePlugin({
          name: 'second',
          preRequest: (e) => ({ ...e, systemPrompt: e.systemPrompt + ' [2]' }),
        }),
      );

      const result = await pm.preRequest(
        makePreRequestEvent({ systemPrompt: 'base' }),
      );
      expect(result.systemPrompt).toBe('base [1] [2]');
    });

    it('continues with unmodified event if a plugin throws', async () => {
      pm.register(
        makePlugin({
          name: 'bad',
          preRequest: () => {
            throw new Error('boom');
          },
        }),
      );
      pm.register(
        makePlugin({
          name: 'good',
          preRequest: (e) => ({ ...e, systemPrompt: 'from-good' }),
        }),
      );

      const event = makePreRequestEvent({ systemPrompt: 'original' });
      const result = await pm.preRequest(event);
      // bad plugin threw, so good plugin receives the original event
      expect(result.systemPrompt).toBe('from-good');
    });
  });

  describe('postRequest', () => {
    it('calls all plugin postRequest hooks', async () => {
      const hook1 = vi.fn();
      const hook2 = vi.fn();
      pm.register(makePlugin({ name: 'a', postRequest: hook1 }));
      pm.register(makePlugin({ name: 'b', postRequest: hook2 }));

      const event: PostRequestEvent = {
        messages: [],
        response: { text: 'hi', toolCalls: [], usage: null },
        provider: {} as Provider,
        model: 'test',
        meta: {},
      };

      await pm.postRequest(event);

      expect(hook1).toHaveBeenCalledWith(event);
      expect(hook2).toHaveBeenCalledWith(event);
    });

    it('does not throw if a plugin postRequest fails', async () => {
      pm.register(
        makePlugin({
          postRequest: () => {
            throw new Error('boom');
          },
        }),
      );

      await expect(
        pm.postRequest({
          messages: [],
          response: { text: '', toolCalls: [], usage: null },
          provider: {} as Provider,
          model: 'test',
          meta: {},
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('interceptProvider', () => {
    it('returns current provider when no plugins registered', () => {
      const current = { name: 'original' } as Provider;
      const result = pm.interceptProvider(
        makeProviderInterceptEvent({ currentProvider: current }),
      );
      expect(result).toBe(current);
    });

    it('returns current provider when plugin returns undefined', () => {
      const current = { name: 'original' } as Provider;
      pm.register(
        makePlugin({ providerInterceptor: () => undefined }),
      );

      const result = pm.interceptProvider(
        makeProviderInterceptEvent({ currentProvider: current }),
      );
      expect(result).toBe(current);
    });

    it('returns overridden provider from first plugin that returns one', () => {
      const override = { name: 'override' } as Provider;
      pm.register(
        makePlugin({
          name: 'first',
          providerInterceptor: () => override,
        }),
      );
      pm.register(
        makePlugin({
          name: 'second',
          providerInterceptor: () => ({ name: 'should-not-reach' }) as Provider,
        }),
      );

      const result = pm.interceptProvider(makeProviderInterceptEvent());
      expect(result).toBe(override);
    });

    it('skips a throwing plugin and continues', () => {
      const override = { name: 'good-override' } as Provider;
      pm.register(
        makePlugin({
          name: 'bad',
          providerInterceptor: () => {
            throw new Error('boom');
          },
        }),
      );
      pm.register(
        makePlugin({
          name: 'good',
          providerInterceptor: () => override,
        }),
      );

      const result = pm.interceptProvider(makeProviderInterceptEvent());
      expect(result).toBe(override);
    });
  });

  describe('destroy', () => {
    it('calls destroy on all plugins', async () => {
      const d1 = vi.fn();
      const d2 = vi.fn();
      pm.register(makePlugin({ name: 'a', destroy: d1 }));
      pm.register(makePlugin({ name: 'b', destroy: d2 }));

      await pm.destroy();

      expect(d1).toHaveBeenCalledOnce();
      expect(d2).toHaveBeenCalledOnce();
    });

    it('does not throw if a plugin destroy fails', async () => {
      pm.register(
        makePlugin({
          destroy: () => {
            throw new Error('boom');
          },
        }),
      );

      await expect(pm.destroy()).resolves.not.toThrow();
    });
  });
});
