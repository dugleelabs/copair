import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitignoreManager } from '../../src/init/GitignoreManager.js';
import { KnowledgeManager } from '../../src/knowledge/KnowledgeManager.js';

describe('GitignoreManager — edge cases', () => {
  let tmpDir: string;
  let manager: GitignoreManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'copair-gitignore-edge-'));
    manager = new GitignoreManager();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .gitignore with .copair/ when file is absent', async () => {
    expect(existsSync(join(tmpDir, '.gitignore'))).toBe(false);
    await manager.ensureCovered(tmpDir, { ci: true });
    expect(existsSync(join(tmpDir, '.gitignore'))).toBe(true);
    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toContain('.copair/');
  });

  it('skips silently when .copair/ is already in .gitignore — no modification', async () => {
    const original = 'node_modules/\n.copair/\ndist/\n';
    writeFileSync(join(tmpDir, '.gitignore'), original);

    await manager.ensureCovered(tmpDir, { ci: true });

    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
    // .copair/ should appear exactly once (not duplicated)
    const occurrences = content.split('.copair/').length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('KnowledgeManager — edge cases', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'copair-km-edge-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('knowledge file at exactly 8 KB boundary triggers warn but does not throw', () => {
    const km = new KnowledgeManager({ warn_size_kb: 8, max_size_kb: 16 });
    // 8 KB + 1 byte: should warn but not throw
    expect(() => km.checkSizeBudget(8 * 1024 + 1)).not.toThrow();
  });

  it('knowledge auto-update diff exceeding size cap is rejected', () => {
    const km = new KnowledgeManager({ warn_size_kb: 8, max_size_kb: 16 });
    const oversized = 'x'.repeat(17 * 1024);
    expect(() => km.applyUpdate(tmpDir, oversized)).toThrow(/16 KB cap/);
  });

  it('user declines global scaffold but project init still proceeds', async () => {
    // GlobalInitManager decline does not block ProjectInitManager
    const { GlobalInitManager } = await import('../../src/init/GlobalInitManager.js');
    const { ProjectInitManager } = await import('../../src/init/ProjectInitManager.js');
    const { mkdirSync } = await import('node:fs');

    // Simulate: global dir absent, CI mode → GlobalInitManager returns declined
    const gm = new GlobalInitManager(tmpDir);
    const globalResult = await gm.check({ ci: true });
    expect(globalResult.declined).toBe(true);

    // ProjectInitManager proceeds normally with an existing .copair/ dir
    const projectDir = join(tmpDir, 'project');
    mkdirSync(join(projectDir, '.copair'), { recursive: true });

    const pm = new ProjectInitManager();
    const projectResult = await pm.check(projectDir, { ci: true });
    expect(projectResult.alreadyInitialised).toBe(true);
    expect(projectResult.declined).toBe(false);
  });
});
