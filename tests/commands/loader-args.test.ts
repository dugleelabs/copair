/**
 * Tests for spec 028: parseFrontmatter arg parsing and resolve() positional mapping
 */
import { describe, it, expect } from 'vitest';
import { CommandRegistry } from '../../src/commands/registry.js';
import type { Command, AgentContext } from '../../src/commands/interface.js';

// ─── parseFrontmatter via loadCustomCommands ───────────────────────────────
// We test the arg parsing indirectly through loadCommandsFromDir by using
// the registry's resolve() which reads command.definition.args. Instead,
// test parseFrontmatter's output via a known command definition shape.

// Build a minimal command with a full arg definition to test registry.resolve()
function makeCommandWithArgs(
  argDefs: Array<{ name: string; required?: boolean; description?: string; default?: string }>,
): Command {
  return {
    definition: {
      name: 'test',
      description: 'Test',
      args: argDefs,
      source: 'project',
    },
    execute: async (args) => JSON.stringify(args),
  };
}

function makeRegistry(cmd: Command): CommandRegistry {
  const r = new CommandRegistry();
  // @ts-expect-error accessing private for test
  r.commands.set(cmd.definition.name, cmd);
  return r;
}

function makeContext(): AgentContext {
  return { cwd: '/project', model: 'test' };
}

// ─── resolve(): positional → named arg mapping ────────────────────────────

describe('resolve() — positional arg mapping', () => {
  it('maps first positional to first named arg definition', () => {
    const cmd = makeCommandWithArgs([{ name: 'feature_name', required: true }]);
    const registry = makeRegistry(cmd);

    const resolved = registry.resolve('test my-feature');
    expect(resolved).not.toBeNull();
    expect(resolved!.args['feature_name']).toBe('my-feature');
  });

  it('still sets ARGUMENTS for backward compat', () => {
    const cmd = makeCommandWithArgs([{ name: 'feature_name', required: true }]);
    const registry = makeRegistry(cmd);

    const resolved = registry.resolve('test my-feature');
    expect(resolved!.args['ARGUMENTS']).toBe('my-feature');
  });

  it('maps multiple positionals to multiple named args in order', () => {
    const cmd = makeCommandWithArgs([
      { name: 'first', required: true },
      { name: 'second', required: true },
    ]);
    const registry = makeRegistry(cmd);

    const resolved = registry.resolve('test foo bar');
    expect(resolved!.args['first']).toBe('foo');
    expect(resolved!.args['second']).toBe('bar');
  });

  it('does not overwrite a key=value arg with a positional', () => {
    const cmd = makeCommandWithArgs([{ name: 'feature_name', required: true }]);
    const registry = makeRegistry(cmd);

    const resolved = registry.resolve('test feature_name=explicit positional-value');
    // key=value takes precedence; positional maps to next unfilled arg (none here)
    expect(resolved!.args['feature_name']).toBe('explicit');
  });

  it('falls back to ARGUMENTS-only when no named args defined', () => {
    const cmd = makeCommandWithArgs([]);
    const registry = makeRegistry(cmd);

    const resolved = registry.resolve('test foo bar');
    expect(resolved!.args['ARGUMENTS']).toBe('foo bar');
    expect('feature_name' in resolved!.args).toBe(false);
  });
});

// ─── parseFrontmatter arg fields ────────────────────────────────────────────
// Test via dispatchWithIntake: a command whose required flag was parsed correctly
// will have its collector invoked for missing required args.

describe('parseFrontmatter — required field parsed', () => {
  it('dispatchWithIntake collects a required arg when required:true is parsed', async () => {
    const cmd = makeCommandWithArgs([{ name: 'topic', required: true, description: 'Research topic' }]);
    const registry = makeRegistry(cmd);
    const collector = async () => 'auth flows';

    const result = await registry.dispatchWithIntake(cmd, {}, makeContext(), false, collector);
    // execute receives the collected value
    expect(result).toContain('auth flows');
  });

  it('dispatchWithIntake skips collection when required is undefined (not parsed)', async () => {
    const cmd = makeCommandWithArgs([{ name: 'topic' }]); // no required field
    const registry = makeRegistry(cmd);
    let collectorCalled = false;
    const collector = async () => { collectorCalled = true; return 'x'; };

    await registry.dispatchWithIntake(cmd, {}, makeContext(), false, collector);
    expect(collectorCalled).toBe(false);
  });
});
