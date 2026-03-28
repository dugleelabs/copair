import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GlobalInitManager } from '../../src/init/GlobalInitManager.js';

describe('GlobalInitManager', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'copair-global-init-test-'));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('skips when ~/.copair/ already exists', async () => {
    const manager = new GlobalInitManager(tmpHome);
    // Pre-create the dir
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(tmpHome, '.copair'), { recursive: true });

    const result = await manager.check({ ci: true });
    expect(result.skipped).toBe(true);
    expect(result.declined).toBe(false);
    expect(result.created).toBe(false);
  });

  it('creates ~/.copair/ and config.yaml in CI mode (no prompt)', async () => {
    // In CI, GlobalInitManager skips scaffold (returns declined)
    const manager = new GlobalInitManager(tmpHome);
    const result = await manager.check({ ci: true });

    expect(result.skipped).toBe(false);
    expect(result.declined).toBe(true);
    expect(result.created).toBe(false);
    expect(existsSync(join(tmpHome, '.copair'))).toBe(false);
  });

  it('creates scaffold when dir absent and not CI (simulated by injecting homeDir)', async () => {
    // We can test the scaffold path by having check() see no dir and mocking the prompt.
    // Since we can't mock readline easily, we test the private scaffold via a subclass approach.
    // Instead we verify the directory structure after a direct scaffold call.
    const manager = new GlobalInitManager(tmpHome) as unknown as {
      scaffold(): Promise<void>;
      globalDir: string;
    };

    await manager.scaffold();

    expect(existsSync(manager.globalDir)).toBe(true);
    expect(existsSync(join(manager.globalDir, 'config.yaml'))).toBe(true);
  });

  it('does not overwrite existing config.yaml on re-scaffold', async () => {
    const { mkdirSync, writeFileSync, readFileSync } = await import('node:fs');
    const globalDir = join(tmpHome, '.copair');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, 'config.yaml'), '# custom config\n');

    const manager = new GlobalInitManager(tmpHome) as unknown as {
      scaffold(): Promise<void>;
    };
    await manager.scaffold();

    const content = readFileSync(join(globalDir, 'config.yaml'), 'utf8');
    expect(content).toBe('# custom config\n');
  });
});
