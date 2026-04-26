/**
 * Tests for spec 028 T-A21: computeDiffPreview()
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeDiffPreview } from '../../src/core/tool-executor.js';
import { AgentBridge } from '../../src/cli/ui/agent-bridge.js';
import { ApprovalGate } from '../../src/core/approval-gate.js';

describe('computeDiffPreview (T-A21)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'copair-diff-'));
  });

  it('returns null for non-write/edit tools', () => {
    expect(computeDiffPreview('read', { file_path: '/foo' })).toBeNull();
    expect(computeDiffPreview('bash', { command: 'ls' })).toBeNull();
  });

  it('returns null for write without file_path', () => {
    expect(computeDiffPreview('write', { content: 'hello' })).toBeNull();
  });

  it('returns (new file) summary for write to non-existent path', () => {
    const filePath = join(tmpDir, 'new-file.ts');
    const result = computeDiffPreview('write', { file_path: filePath, content: 'const x = 1;' });
    expect(result).not.toBeNull();
    expect(result!.oldContent).toBeNull();
    expect(result!.diffText).toMatch(/^\(new file\)/);
    expect(result!.diffText).toContain(filePath);
  });

  it('returns unified diff for write to existing file', () => {
    const filePath = join(tmpDir, 'existing.ts');
    writeFileSync(filePath, 'const x = 1;\n');
    const result = computeDiffPreview('write', { file_path: filePath, content: 'const x = 2;\n' });
    expect(result).not.toBeNull();
    expect(result!.oldContent).toBe('const x = 1;\n');
    expect(result!.newContent).toBe('const x = 2;\n');
    expect(result!.diffText).toContain('-const x = 1;');
    expect(result!.diffText).toContain('+const x = 2;');
  });

  it('returns unified diff for edit using old_string/new_string', () => {
    const filePath = join(tmpDir, 'edit-target.ts');
    writeFileSync(filePath, 'const a = 1;\n');
    const result = computeDiffPreview('edit', {
      file_path: filePath,
      old_string: 'const a = 1;',
      new_string: 'const a = 42;',
    });
    expect(result).not.toBeNull();
    expect(result!.diffText).toContain('-const a = 1;');
    expect(result!.diffText).toContain('+const a = 42;');
  });
});

describe('ApprovalGate — diff in bridgePrompt (T-A21)', () => {
  it('includes diff in approval-request bridge event', async () => {
    const bridge = new AgentBridge();
    const gate = new ApprovalGate('ask');
    gate.setBridge(bridge);

    const diffPreview = {
      filePath: '/project/src/foo.ts',
      oldContent: 'old',
      newContent: 'new',
      diffText: '--- a/foo.ts\n+++ b/foo.ts\n-old\n+new',
    };

    let capturedRequest: Record<string, unknown> | null = null;
    bridge.on('approval-request', (request) => {
      capturedRequest = request as unknown as Record<string, unknown>;
    });

    // Trigger bridgePrompt — don't await, we just care about the event
    void gate.allow('write', { file_path: '/project/src/foo.ts' }, diffPreview);

    // Give the microtask queue a moment to fire
    await new Promise((r) => setImmediate(r));

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!['diff']).toMatchObject({
      filePath: '/project/src/foo.ts',
      diffText: expect.stringContaining('-old'),
    });
  });
});
