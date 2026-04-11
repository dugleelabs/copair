import type { Provider } from '../providers/interface.js';
import type {
  CopairPlugin,
  PluginContext,
  PreRequestEvent,
  PostRequestEvent,
  ProviderInterceptEvent,
  PreToolCallEvent,
  PostToolCallEvent,
  SessionEvent,
} from '../plugins/interface.js';
import { logger } from './logger.js';

export class PluginManager {
  private plugins: CopairPlugin[] = [];

  /**
   * Register a plugin instance. Called during bootstrap
   * (either from config.yaml or programmatic API).
   */
  register(plugin: CopairPlugin): void {
    this.plugins.push(plugin);
    logger.debug('PluginManager', `Registered plugin: ${plugin.name}@${plugin.version}`);
  }

  /**
   * Load plugins from config.yaml `plugins` array.
   * Each entry is a package name or local path resolved via import().
   */
  async loadFromConfig(pluginPaths: string[]): Promise<void> {
    const start = performance.now();
    for (const path of pluginPaths) {
      try {
        const mod = await import(path);
        const plugin: CopairPlugin = mod.default ?? mod;
        if (!plugin.name || !plugin.version) {
          logger.warn('PluginManager', `Plugin at "${path}" missing name or version, skipping`);
          continue;
        }
        this.register(plugin);
      } catch (err) {
        logger.warn('PluginManager', `Failed to load plugin "${path}": ${err}`);
      }
    }
    logger.debug('PluginManager', `loadFromConfig completed in ${(performance.now() - start).toFixed(1)}ms (${pluginPaths.length} paths)`);
  }

  /** Initialize all plugins (called once during bootstrap). */
  async initialize(context: PluginContext): Promise<void> {
    const start = performance.now();
    for (const plugin of this.plugins) {
      try {
        await plugin.initialize?.(context);
        logger.debug('PluginManager', `Initialized plugin: ${plugin.name}`);
      } catch (err) {
        logger.warn('PluginManager', `Plugin "${plugin.name}" initialize failed: ${err}`);
      }
    }
    logger.debug('PluginManager', `initialize completed in ${(performance.now() - start).toFixed(1)}ms (${this.plugins.length} plugins)`);
  }

  /**
   * Run preRequest hooks in registration order.
   * Each plugin receives the (possibly modified) event from the prior plugin.
   */
  async preRequest(event: PreRequestEvent): Promise<PreRequestEvent> {
    let current = event;
    for (const plugin of this.plugins) {
      try {
        if (plugin.preRequest) {
          current = await plugin.preRequest(current);
        }
      } catch (err) {
        logger.warn('PluginManager', `Plugin "${plugin.name}" preRequest failed: ${err}`);
      }
    }
    return current;
  }

  /** Run postRequest hooks (observation only). */
  async postRequest(event: PostRequestEvent): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await plugin.postRequest?.(event);
      } catch (err) {
        logger.warn('PluginManager', `Plugin "${plugin.name}" postRequest failed: ${err}`);
      }
    }
  }

  /**
   * Run providerInterceptor hooks. First plugin to return
   * a non-undefined provider wins (short-circuit).
   */
  interceptProvider(event: ProviderInterceptEvent): Provider {
    for (const plugin of this.plugins) {
      try {
        const override = plugin.providerInterceptor?.(event);
        if (override) return override;
      } catch (err) {
        logger.warn('PluginManager', `Plugin "${plugin.name}" providerInterceptor failed: ${err}`);
      }
    }
    return event.currentProvider;
  }

  // ── P1 hooks (stubbed, wired later) ──

  async preToolCall(event: PreToolCallEvent): Promise<PreToolCallEvent> {
    let current = event;
    for (const plugin of this.plugins) {
      try {
        if (plugin.preToolCall) {
          current = await plugin.preToolCall(current);
        }
      } catch (err) {
        logger.warn('PluginManager', `Plugin "${plugin.name}" preToolCall failed: ${err}`);
      }
    }
    return current;
  }

  async postToolCall(event: PostToolCallEvent): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await plugin.postToolCall?.(event);
      } catch (err) {
        logger.warn('PluginManager', `Plugin "${plugin.name}" postToolCall failed: ${err}`);
      }
    }
  }

  async sessionStart(event: SessionEvent): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await plugin.sessionStart?.(event);
      } catch (err) {
        logger.warn('PluginManager', `Plugin "${plugin.name}" sessionStart failed: ${err}`);
      }
    }
  }

  async sessionEnd(event: SessionEvent): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await plugin.sessionEnd?.(event);
      } catch (err) {
        logger.warn('PluginManager', `Plugin "${plugin.name}" sessionEnd failed: ${err}`);
      }
    }
  }

  /** Destroy all plugins on shutdown. */
  async destroy(): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await plugin.destroy?.();
      } catch (err) {
        logger.warn('PluginManager', `Plugin "${plugin.name}" destroy failed: ${err}`);
      }
    }
  }

  /** Get the count of registered plugins. */
  get count(): number {
    return this.plugins.length;
  }
}
