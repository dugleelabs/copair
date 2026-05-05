/**
 * Tests for spec 028 Phase A approval gate changes:
 * T-A19: F-01 session key path-specificity and allow-list new-file guard
 * T-A22: F-04 tiered read approval and sensitive path exception
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ApprovalGate } from '../../src/core/approval-gate.js';
import { AllowList } from '../../src/core/allow-list.js';
import * as ttyPromptModule from '../../src/cli/tty-prompt.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGate(mode: 'ask' | 'auto-approve' = 'ask', allowList: AllowList | null = null): ApprovalGate {
  return new ApprovalGate(mode, allowList);
}

// ── T-A19: sessionKey path-specificity and new-file guard ────────────────────

describe('ApprovalGate — sessionKey path-specificity (T-A19)', () => {
  it('classify() returns needs-approval for write', () => {
    const gate = makeGate();
    expect(gate.classify('write', { file_path: '/project/src/foo.ts' })).toBe('needs-approval');
  });

  it('classify() returns needs-approval for edit', () => {
    const gate = makeGate();
    expect(gate.classify('edit', { file_path: '/project/src/foo.ts' })).toBe('needs-approval');
  });
});

describe('ApprovalGate — allow-list new-file guard (T-A19)', () => {
  let tmpDir: string;
  let existingFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'copair-test-'));
    existingFile = join(tmpDir, 'existing.ts');
    writeFileSync(existingFile, '// existing');
    vi.spyOn(ttyPromptModule, 'readFromTty').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allow-list does NOT auto-approve write to a non-existent file', async () => {
    const nonExistent = join(tmpDir, 'new-file.ts');

    const allowList = {
      matches: vi.fn().mockReturnValue(true),
    } as unknown as AllowList;

    const gate = makeGate('ask', allowList);
    // Gate needs a way to ask — mock TTY to deny
    const result = await gate.allow('write', { file_path: nonExistent });
    // Without a TTY (CI mode), the gate denies — that's also correct: new file was NOT auto-approved
    expect(allowList.matches).toHaveBeenCalledWith('write', expect.objectContaining({ file_path: nonExistent }));
    expect(result).toBe(false); // CI mode without TTY: denied
  });

  it('allow-list auto-approves write to an existing file', async () => {
    const allowList = {
      matches: vi.fn().mockReturnValue(true),
    } as unknown as AllowList;

    const gate = makeGate('ask', allowList);
    const result = await gate.allow('write', { file_path: existingFile });
    expect(result).toBe(true);
  });
});

// ── T-A22: Tiered read approval ───────────────────────────────────────────────

describe('ApprovalGate — tiered read approval (T-A22)', () => {
  beforeEach(() => {
    vi.spyOn(ttyPromptModule, 'readFromTty').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('classifies intra-repo read as safe', () => {
    const gate = makeGate();
    expect(gate.classify('read', { file_path: '/project/src/foo.ts' })).toBe('safe');
  });

  it('classifies cross-repo read as always-ask', () => {
    const gate = makeGate();
    expect(gate.classify('read', { file_path: '/other/repo/file.ts', _crossRepoRead: true })).toBe('always-ask');
  });

  it('classifies cross-repo glob as always-ask', () => {
    const gate = makeGate();
    expect(gate.classify('glob', { pattern: '/other/**', _crossRepoRead: true })).toBe('always-ask');
  });

  it('classifies intra-repo .env read as needs-approval (sensitive)', () => {
    const gate = makeGate();
    expect(gate.classify('read', { file_path: '/project/.env' })).toBe('needs-approval');
  });

  it('classifies intra-repo .env.local read as needs-approval (sensitive)', () => {
    const gate = makeGate();
    expect(gate.classify('read', { file_path: '/project/.env.local' })).toBe('needs-approval');
  });

  it('classifies write to a .key file as always-ask (sensitive)', () => {
    const gate = makeGate();
    expect(gate.classify('write', { file_path: '/project/secrets/private.key' })).toBe('always-ask');
  });

  it('auto-approve mode still prompts for always-ask (cross-repo read)', async () => {
    const gate = makeGate('auto-approve');
    // In CI (no TTY), gate denies — but the important thing is it DID NOT auto-approve
    const result = await gate.allow('read', { file_path: '/other/file', _crossRepoRead: true });
    expect(result).toBe(false); // CI/no-TTY → denied, confirming it was not auto-approved
  });

  it('auto-approve mode still prompts for always-ask (write to .key file)', async () => {
    const gate = makeGate('auto-approve');
    const result = await gate.allow('write', { file_path: '/project/id_rsa' });
    expect(result).toBe(false); // CI/no-TTY → denied, confirming not auto-approved
  });

  it('auto-approve mode auto-approves normal intra-repo writes', async () => {
    const gate = makeGate('auto-approve');
    const result = await gate.allow('write', { file_path: '/project/src/foo.ts' });
    expect(result).toBe(true);
  });
});
