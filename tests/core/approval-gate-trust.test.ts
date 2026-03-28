import { describe, it, expect } from 'vitest';
import { ApprovalGate } from '../../src/core/approval-gate.js';

describe('ApprovalGate — trusted paths', () => {
  it('allows writes to trusted directory', () => {
    const gate = new ApprovalGate('ask');
    gate.addTrustedPath('/project/.copair');
    expect(gate.isTrustedPath('write', { file_path: '/project/.copair/sessions/abc.json' })).toBe(true);
  });

  it('allows writes to trusted directory root', () => {
    const gate = new ApprovalGate('ask');
    gate.addTrustedPath('/project/.copair');
    expect(gate.isTrustedPath('write', { file_path: '/project/.copair/.gitignore' })).toBe(true);
  });

  it('blocks config.yaml even when inside a trusted path (permission-sensitive)', () => {
    const gate = new ApprovalGate('ask');
    gate.addTrustedPath('/project/.copair');
    expect(gate.isTrustedPath('write', { file_path: '/project/.copair/config.yaml' })).toBe(false);
  });

  it('blocks allow.yaml even when inside a trusted path (permission-sensitive)', () => {
    const gate = new ApprovalGate('ask');
    gate.addTrustedPath('/project/.copair');
    expect(gate.isTrustedPath('write', { file_path: '/project/.copair/allow.yaml' })).toBe(false);
  });

  it('blocks writes outside trusted paths', () => {
    const gate = new ApprovalGate('ask');
    gate.addTrustedPath('/project/.copair');
    expect(gate.isTrustedPath('write', { file_path: '/project/src/index.ts' })).toBe(false);
  });

  it('blocks writes to similarly-named paths (no partial prefix match)', () => {
    const gate = new ApprovalGate('ask');
    gate.addTrustedPath('/project/.copair');
    // .copair-evil should NOT match .copair prefix
    expect(gate.isTrustedPath('write', { file_path: '/project/.copair-evil/hack.ts' })).toBe(false);
  });

  it('only applies to write and edit tools', () => {
    const gate = new ApprovalGate('ask');
    gate.addTrustedPath('/project/.copair');
    expect(gate.isTrustedPath('bash', { file_path: '/project/.copair/foo' })).toBe(false);
    expect(gate.isTrustedPath('read', { file_path: '/project/.copair/foo' })).toBe(false);
    expect(gate.isTrustedPath('git', { file_path: '/project/.copair/foo' })).toBe(false);
  });

  it('applies to edit tool', () => {
    const gate = new ApprovalGate('ask');
    gate.addTrustedPath('/project/.copair');
    expect(gate.isTrustedPath('edit', { file_path: '/project/.copair/commands/test.yaml' })).toBe(true);
  });

  it('returns false when file_path is not a string', () => {
    const gate = new ApprovalGate('ask');
    gate.addTrustedPath('/project/.copair');
    expect(gate.isTrustedPath('write', { file_path: 42 })).toBe(false);
    expect(gate.isTrustedPath('write', {})).toBe(false);
  });

  it('trusted paths bypass deny mode in allow()', async () => {
    const gate = new ApprovalGate('deny');
    gate.addTrustedPath('/project/.copair');
    const allowed = await gate.allow('write', { file_path: '/project/.copair/sessions/abc.json' });
    expect(allowed).toBe(true);
  });

  it('deny mode still blocks non-trusted writes', async () => {
    const gate = new ApprovalGate('deny');
    gate.addTrustedPath('/project/.copair');
    const allowed = await gate.allow('write', { file_path: '/project/src/index.ts' });
    expect(allowed).toBe(false);
  });

  it('config.yaml is blocked in deny mode even if path is trusted (no permission escalation)', async () => {
    const gate = new ApprovalGate('deny');
    gate.addTrustedPath('/project/.copair');
    const allowed = await gate.allow('write', { file_path: '/project/.copair/config.yaml' });
    expect(allowed).toBe(false);
  });

  it('supports multiple trusted paths', () => {
    const gate = new ApprovalGate('ask');
    gate.addTrustedPath('/project/.copair');
    gate.addTrustedPath('/project/COPAIR_KNOWLEDGE.md');
    expect(gate.isTrustedPath('write', { file_path: '/project/.copair/foo' })).toBe(true);
    expect(gate.isTrustedPath('write', { file_path: '/project/COPAIR_KNOWLEDGE.md' })).toBe(true);
    expect(gate.isTrustedPath('write', { file_path: '/project/src/foo.ts' })).toBe(false);
  });
});
