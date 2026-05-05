/**
 * Tests for spec 028 T-B22: dispatchWithIntake integration tests
 */
import { describe, it, expect, vi } from 'vitest';
import { CommandRegistry } from '../../src/commands/registry.js';
import type { Command, AgentContext } from '../../src/commands/interface.js';

function makeRegistry(): CommandRegistry {
  return new CommandRegistry();
}

function makeContext(): AgentContext {
  return { cwd: '/project', model: 'test-model' };
}

function makeCommand(requiredArgs: string[] = [], optionalArgs: string[] = []): Command {
  const args = [
    ...requiredArgs.map((name) => ({ name, required: true, description: `Enter ${name}` })),
    ...optionalArgs.map((name) => ({ name, required: false, description: `Optional: ${name}` })),
  ];
  return {
    definition: {
      name: 'test-cmd',
      description: 'Test command',
      args: args.length > 0 ? args : undefined,
      source: 'builtin',
    },
    execute: vi.fn().mockResolvedValue('executed'),
  };
}

describe('dispatchWithIntake — large model path', () => {
  it('calls command.execute directly without invoking collector', async () => {
    const registry = makeRegistry();
    const command = makeCommand(['feature_name']);
    const collector = vi.fn().mockResolvedValue('collected');
    const ctx = makeContext();

    const result = await registry.dispatchWithIntake(
      command,
      { feature_name: 'my-feature' },
      ctx,
      false, // large model
      collector,
    );

    expect(command.execute).toHaveBeenCalledWith({ feature_name: 'my-feature' }, ctx);
    expect(collector).not.toHaveBeenCalled();
    expect(result).toBe('executed');
  });

  it('still fills defaults for large models', async () => {
    const registry = makeRegistry();
    const command: Command = {
      definition: {
        name: 'test-cmd',
        description: 'Test',
        args: [{ name: 'mode', required: false, default: 'standard' }],
        source: 'builtin',
      },
      execute: vi.fn().mockResolvedValue('done'),
    };

    await registry.dispatchWithIntake(command, {}, makeContext(), false, vi.fn());
    expect(command.execute).toHaveBeenCalledWith({ mode: 'standard' }, expect.anything());
  });
});

describe('dispatchWithIntake — small model path', () => {
  it('does not call collector when all required args are already supplied', async () => {
    const registry = makeRegistry();
    const command = makeCommand(['feature_name']);
    const collector = vi.fn().mockResolvedValue('collected');

    await registry.dispatchWithIntake(
      command,
      { feature_name: 'my-feature' },
      makeContext(),
      true, // small model
      collector,
    );

    expect(collector).not.toHaveBeenCalled();
    expect(command.execute).toHaveBeenCalledWith({ feature_name: 'my-feature' }, expect.anything());
  });

  it('calls collector once per missing required arg and substitutes the answer', async () => {
    const registry = makeRegistry();
    const command = makeCommand(['feature_name', 'phase']);
    const collector = vi.fn()
      .mockResolvedValueOnce('new-dashboard')
      .mockResolvedValueOnce('b');

    await registry.dispatchWithIntake(
      command,
      {}, // no args supplied
      makeContext(),
      true,
      collector,
    );

    expect(collector).toHaveBeenCalledTimes(2);
    expect(command.execute).toHaveBeenCalledWith(
      { feature_name: 'new-dashboard', phase: 'b' },
      expect.anything(),
    );
  });

  it('does not collect optional args', async () => {
    const registry = makeRegistry();
    const command = makeCommand([], ['optional_field']); // only optional args
    const collector = vi.fn().mockResolvedValue('value');

    await registry.dispatchWithIntake(command, {}, makeContext(), true, collector);

    expect(collector).not.toHaveBeenCalled();
  });

  it('uses arg description as collector prompt when available', async () => {
    const registry = makeRegistry();
    const command: Command = {
      definition: {
        name: 'test-cmd',
        description: 'Test',
        args: [{ name: 'topic', description: 'Research topic to investigate', required: true }],
        source: 'builtin',
      },
      execute: vi.fn().mockResolvedValue('done'),
    };
    const collector = vi.fn().mockResolvedValue('auth flows');

    await registry.dispatchWithIntake(command, {}, makeContext(), true, collector);

    expect(collector).toHaveBeenCalledWith('Research topic to investigate');
  });
});
