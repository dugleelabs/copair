import { describe, it, expect } from 'vitest';
import {
  SlashCommandProvider,
  SubcommandProvider,
  FilePathProvider,
  ModelNameProvider,
  SessionIdProvider,
  CompletionEngine,
} from '../../../src/cli/ui/completion-providers.js';

describe('SlashCommandProvider', () => {
  const commands = new Map([
    ['help', 'Show help'],
    ['model', 'Switch model'],
    ['clear', 'Clear conversation'],
    ['session', 'Session management'],
  ]);
  const provider = new SlashCommandProvider(commands);

  it('matches input starting with /', () => {
    expect(provider.matches('/h')).toBe(true);
    expect(provider.matches('/')).toBe(true);
    expect(provider.matches('hello')).toBe(false);
  });

  it('completes slash commands by prefix', () => {
    const items = provider.complete('/he');
    expect(items).toHaveLength(1);
    expect(items[0].value).toBe('/help');
    expect(items[0].description).toBe('Show help');
  });

  it('returns all commands for bare /', () => {
    const items = provider.complete('/');
    expect(items).toHaveLength(4);
  });

  it('returns empty for no match', () => {
    const items = provider.complete('/xyz');
    expect(items).toHaveLength(0);
  });
});

describe('SubcommandProvider', () => {
  const provider = new SubcommandProvider([
    { command: 'session', subcommands: new Map([['resume', 'Resume session'], ['list', 'List sessions']]) },
  ]);

  it('matches known command with space', () => {
    expect(provider.matches('/session ')).toBe(true);
    expect(provider.matches('/session r')).toBe(true);
    expect(provider.matches('/help')).toBe(false);
  });

  it('completes subcommands', () => {
    const items = provider.complete('/session r');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('resume');
  });
});

describe('ModelNameProvider', () => {
  const provider = new ModelNameProvider(['gpt-4', 'gpt-3.5-turbo', 'claude-3-opus']);

  it('matches /model prefix', () => {
    expect(provider.matches('/model ')).toBe(true);
    expect(provider.matches('/model g')).toBe(true);
    expect(provider.matches('/help')).toBe(false);
  });

  it('completes model names', () => {
    const items = provider.complete('/model gpt');
    expect(items).toHaveLength(2);
    expect(items[0].label).toBe('gpt-4');
  });
});

describe('SessionIdProvider', () => {
  const sessions = [
    { id: 'abc12345-6789', identifier: 'fix-login-bug' },
    { id: 'def67890-1234', identifier: 'add-tests' },
  ];
  const provider = new SessionIdProvider(() => sessions);

  it('matches /session resume prefix', () => {
    expect(provider.matches('/session resume ')).toBe(true);
    expect(provider.matches('/session resume f')).toBe(true);
    expect(provider.matches('/session list')).toBe(false);
  });

  it('completes by identifier', () => {
    const items = provider.complete('/session resume fix');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('fix-login-bug');
  });

  it('completes by UUID prefix', () => {
    const items = provider.complete('/session resume abc');
    expect(items).toHaveLength(1);
  });
});

describe('CompletionEngine', () => {
  it('returns items from first matching provider', () => {
    const engine = new CompletionEngine();
    const commands = new Map([['help', 'Help'], ['model', 'Model']]);
    engine.addProvider(new SlashCommandProvider(commands));
    engine.addProvider(new ModelNameProvider(['gpt-4']));

    const items = engine.complete('/model');
    // SlashCommandProvider matches first (starts with /)
    expect(items[0].value).toBe('/model');
  });

  it('computes common prefix for single item', () => {
    const engine = new CompletionEngine();
    expect(engine.commonPrefix([{ value: '/help', label: '/help' }])).toBe('/help');
  });

  it('computes common prefix for multiple items', () => {
    const engine = new CompletionEngine();
    const items = [
      { value: '/session resume', label: 'resume' },
      { value: '/session list', label: 'list' },
    ];
    expect(engine.commonPrefix(items)).toBe('/session ');
  });

  it('returns empty string for no items', () => {
    const engine = new CompletionEngine();
    expect(engine.commonPrefix([])).toBe('');
  });
});
