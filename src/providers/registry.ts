import type { Provider } from './interface.js';
import type { ProviderConfig } from '../config/schema.js';

export type ProviderFactory = (config: ProviderConfig, model: string) => Provider;

export class ProviderRegistry {
  private factories = new Map<string, ProviderFactory>();
  private instances = new Map<string, Provider>();

  register(name: string, factory: ProviderFactory): void {
    this.factories.set(name, factory);
  }

  resolve(providerName: string, config: ProviderConfig, model: string): Provider {
    const key = `${providerName}:${model}`;
    const cached = this.instances.get(key);
    if (cached) return cached;

    const factory = this.factories.get(providerName);
    if (!factory) {
      throw new Error(
        `Unknown provider "${providerName}". Available: ${[...this.factories.keys()].join(', ')}`,
      );
    }

    const instance = factory(config, model);
    this.instances.set(key, instance);
    return instance;
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  availableProviders(): string[] {
    return [...this.factories.keys()];
  }
}
