import { describe, it, expect } from 'vitest';
import { PermissionController } from '../../src/core/permissions.js';
import type { Tool } from '../../src/tools/interface.js';

function mockTool(name: string, requiresPermission: boolean): Tool {
  return {
    definition: {
      name,
      description: `Mock ${name}`,
      inputSchema: { type: 'object', properties: {} },
    },
    requiresPermission,
    async execute() {
      return { content: 'ok' };
    },
  };
}

describe('PermissionController', () => {
  it('allows tools that do not require permission', async () => {
    const ctrl = new PermissionController('deny');
    const result = await ctrl.check(mockTool('read', false), {});
    expect(result.allowed).toBe(true);
  });

  it('auto-approve mode allows everything', async () => {
    const ctrl = new PermissionController('auto-approve');
    const result = await ctrl.check(mockTool('bash', true), { command: 'rm -rf /' });
    expect(result.allowed).toBe(true);
  });

  it('deny mode denies everything that requires permission', async () => {
    const ctrl = new PermissionController('deny');
    const result = await ctrl.check(mockTool('bash', true), { command: 'echo hi' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('deny');
  });

  describe('allow-list', () => {
    it('allows exact match', () => {
      const ctrl = new PermissionController('ask', ['git status', 'npm test']);
      expect(ctrl.isAllowListed('git status')).toBe(true);
      expect(ctrl.isAllowListed('npm test')).toBe(true);
    });

    it('rejects non-matching command', () => {
      const ctrl = new PermissionController('ask', ['git status']);
      expect(ctrl.isAllowListed('git push')).toBe(false);
    });

    it('rejects commands with shell operators (semicolon)', () => {
      const ctrl = new PermissionController('ask', ['git status']);
      expect(ctrl.isAllowListed('git status; rm -rf /')).toBe(false);
    });

    it('rejects commands with pipe', () => {
      const ctrl = new PermissionController('ask', ['git status']);
      expect(ctrl.isAllowListed('git status | cat')).toBe(false);
    });

    it('rejects commands with &&', () => {
      const ctrl = new PermissionController('ask', ['git status']);
      expect(ctrl.isAllowListed('git status && rm -rf /')).toBe(false);
    });

    it('rejects commands with backticks', () => {
      const ctrl = new PermissionController('ask', ['echo hello']);
      expect(ctrl.isAllowListed('echo `whoami`')).toBe(false);
    });

    it('rejects commands with $()', () => {
      const ctrl = new PermissionController('ask', ['echo hello']);
      expect(ctrl.isAllowListed('echo $(whoami)')).toBe(false);
    });

    it('rejects non-string input', () => {
      const ctrl = new PermissionController('ask', ['git status']);
      expect(ctrl.isAllowListed(42)).toBe(false);
      expect(ctrl.isAllowListed(null)).toBe(false);
      expect(ctrl.isAllowListed(undefined)).toBe(false);
    });
  });
});
