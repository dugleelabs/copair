import { describe, it, expect, vi } from 'vitest';
import { ProviderRegistry } from '../../src/providers/registry.js';
import type { Provider } from '../../src/providers/interface.js';
import type { ProviderConfig } from '../../src/config/schema.js';

function mockProvider(name: string): Provider {
  return {
    name,
    supportsToolCalling: true,
    supportsStreaming: true,
    maxContextWindow: 128000,
    async *chat() {
      yield { type: 'done' as const };
    },
  };
}

describe('ProviderRegistry', () => {
  it('registers and resolves a provider', () => {
    const registry = new ProviderRegistry();
    const factory = vi.fn(() => mockProvider('openai'));

    registry.register('openai', factory);
    const provider = registry.resolve('openai', { models: {} } as ProviderConfig, 'gpt-4o');

    expect(provider.name).toBe('openai');
    expect(factory).toHaveBeenCalledOnce();
  });

  it('returns cached instance on second resolve', () => {
    const registry = new ProviderRegistry();
    const factory = vi.fn(() => mockProvider('openai'));

    registry.register('openai', factory);
    const first = registry.resolve('openai', { models: {} } as ProviderConfig, 'gpt-4o');
    const second = registry.resolve('openai', { models: {} } as ProviderConfig, 'gpt-4o');

    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledOnce();
  });

  it('creates separate instances for different models', () => {
    const registry = new ProviderRegistry();
    let callCount = 0;
    const factory = vi.fn(() => mockProvider(`openai-${++callCount}`));

    registry.register('openai', factory);
    const a = registry.resolve('openai', { models: {} } as ProviderConfig, 'gpt-4o');
    const b = registry.resolve('openai', { models: {} } as ProviderConfig, 'gpt-4o-mini');

    expect(a).not.toBe(b);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('throws for unknown provider', () => {
    const registry = new ProviderRegistry();
    registry.register('openai', () => mockProvider('openai'));

    expect(() =>
      registry.resolve('anthropic', { models: {} } as ProviderConfig, 'claude'),
    ).toThrow('Unknown provider "anthropic"');
  });

  it('lists available providers', () => {
    const registry = new ProviderRegistry();
    registry.register('openai', () => mockProvider('openai'));
    registry.register('anthropic', () => mockProvider('anthropic'));

    expect(registry.availableProviders()).toEqual(['openai', 'anthropic']);
  });

  it('checks if a provider exists', () => {
    const registry = new ProviderRegistry();
    registry.register('openai', () => mockProvider('openai'));

    expect(registry.has('openai')).toBe(true);
    expect(registry.has('anthropic')).toBe(false);
  });
});
