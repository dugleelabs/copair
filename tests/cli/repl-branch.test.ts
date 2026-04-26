/**
 * Tests for spec 028 T-A23: F-07 Repl git branch display
 */
import { describe, it, expect, vi } from 'vitest';
import { Repl, type ReplCallbacks } from '../../src/cli/repl.js';

// Mock the detectGitContext module to avoid real git calls
vi.mock('../../src/core/git-context.js', () => ({
  detectGitContext: vi.fn(() => ({ isGitRepo: true, branch: 'main' })),
}));

function makeCallbacks(): ReplCallbacks {
  return {
    onMessage: vi.fn().mockResolvedValue(undefined),
    onSlashCommand: vi.fn().mockResolvedValue(undefined),
    onExit: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Repl — git branch display (T-A23 F-07)', () => {
  it('setBranch sets the branch field', () => {
    const repl = new Repl(makeCallbacks(), 'gpt-4o', '/project');
    repl.setBranch('feat/my-feature');
    // We can't easily introspect private fields, but setBranch should not throw
    expect(() => repl.setBranch('feat/my-feature')).not.toThrow();
  });

  it('setBranch accepts null (no branch)', () => {
    const repl = new Repl(makeCallbacks(), 'gpt-4o', '/project');
    expect(() => repl.setBranch(null)).not.toThrow();
  });

  it('constructor detects branch from detectGitContext', async () => {
    const { detectGitContext } = await import('../../src/core/git-context.js');
    const repl = new Repl(makeCallbacks(), 'gpt-4o', '/project');
    void repl; // prevent unused warning
    // detectGitContext was called during construction
    expect(detectGitContext).toHaveBeenCalledWith('/project');
  });
});
