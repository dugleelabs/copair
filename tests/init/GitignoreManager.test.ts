import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitignoreManager } from '../../src/init/GitignoreManager.js';

describe('GitignoreManager', () => {
  let tmpDir: string;
  let manager: GitignoreManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'copair-gitignore-test-'));
    manager = new GitignoreManager();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Access private methods via type cast for unit testing
  function classify(cwd: string) {
    return (manager as unknown as { classify(cwd: string): Promise<string> }).classify(cwd);
  }

  function consolidate(cwd: string) {
    return (manager as unknown as { consolidate(cwd: string): Promise<void> }).consolidate(cwd);
  }

  describe('classify', () => {
    it('returns "none" when .gitignore is absent', async () => {
      expect(await classify(tmpDir)).toBe('none');
    });

    it('returns "full" when .copair/ is present', async () => {
      writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\n.copair/\ndist/\n');
      expect(await classify(tmpDir)).toBe('full');
    });

    it('returns "full" when .copair (no trailing slash) is present', async () => {
      writeFileSync(join(tmpDir, '.gitignore'), '.copair\n');
      expect(await classify(tmpDir)).toBe('full');
    });

    it('returns "partial" when only .copair/sessions is present', async () => {
      writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\n.copair/sessions/\n');
      expect(await classify(tmpDir)).toBe('partial');
    });

    it('returns "partial" when .copair/history is present', async () => {
      writeFileSync(join(tmpDir, '.gitignore'), '.copair/history\n');
      expect(await classify(tmpDir)).toBe('partial');
    });

    it('returns "none" when .gitignore exists but has no copair entries', async () => {
      writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\ndist/\n');
      expect(await classify(tmpDir)).toBe('none');
    });
  });

  describe('consolidate', () => {
    it('creates .gitignore with .copair/ entry when file is absent', async () => {
      await consolidate(tmpDir);
      const content = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
      expect(content).toContain('.copair/');
      expect(content).toContain('# Copair runtime state');
    });

    it('appends .copair/ to existing .gitignore', async () => {
      writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\ndist/\n');
      await consolidate(tmpDir);
      const content = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
      expect(content).toContain('node_modules/');
      expect(content).toContain('dist/');
      expect(content).toContain('.copair/');
    });

    it('removes partial entries and replaces with .copair/', async () => {
      writeFileSync(
        join(tmpDir, '.gitignore'),
        'node_modules/\n.copair/sessions/\n.copair/history\ndist/\n',
      );
      await consolidate(tmpDir);
      const content = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
      expect(content).toContain('.copair/');
      expect(content).not.toContain('.copair/sessions/');
      expect(content).not.toContain('.copair/history');
      expect(content).toContain('node_modules/');
      expect(content).toContain('dist/');
    });
  });

  describe('ensureCovered', () => {
    it('skips silently when .copair/ is fully covered', async () => {
      writeFileSync(join(tmpDir, '.gitignore'), '.copair/\n');
      // Should not throw or prompt
      await manager.ensureCovered(tmpDir, { ci: true });
      const content = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
      // No duplication
      expect(content.split('.copair/').length - 1).toBe(1);
    });

    it('applies consolidation silently in CI mode when coverage is none', async () => {
      await manager.ensureCovered(tmpDir, { ci: true });
      expect(existsSync(join(tmpDir, '.gitignore'))).toBe(true);
      const content = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
      expect(content).toContain('.copair/');
    });

    it('applies consolidation silently in CI mode when coverage is partial', async () => {
      writeFileSync(join(tmpDir, '.gitignore'), '.copair/sessions/\n');
      await manager.ensureCovered(tmpDir, { ci: true });
      const content = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
      expect(content).toContain('.copair/');
      expect(content).not.toContain('.copair/sessions/');
    });
  });
});
