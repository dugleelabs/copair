import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectInitManager, DECLINED_MESSAGE } from '../../src/init/ProjectInitManager.js';

describe('ProjectInitManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'copair-project-init-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns alreadyInitialised when .copair/ exists', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(tmpDir, '.copair'), { recursive: true });

    const manager = new ProjectInitManager();
    const result = await manager.check(tmpDir, { ci: false });

    expect(result.alreadyInitialised).toBe(true);
    expect(result.declined).toBe(false);
    expect(result.created).toBe(false);
  });

  it('returns alreadyInitialised in CI mode when .copair/ exists', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(tmpDir, '.copair'), { recursive: true });

    const manager = new ProjectInitManager();
    const result = await manager.check(tmpDir, { ci: true });

    expect(result.alreadyInitialised).toBe(true);
    expect(result.declined).toBe(false);
  });

  it('returns declined in CI mode when .copair/ is absent', async () => {
    const manager = new ProjectInitManager();
    const result = await manager.check(tmpDir, { ci: true });

    expect(result.alreadyInitialised).toBe(false);
    expect(result.declined).toBe(true);
    expect(result.created).toBe(false);
    // No .copair/ should be created
    expect(existsSync(join(tmpDir, '.copair'))).toBe(false);
  });

  it('creates .copair/ and config.yaml via scaffold', async () => {
    const manager = new ProjectInitManager() as unknown as {
      scaffold(cwd: string): Promise<void>;
    };
    await manager.scaffold(tmpDir);

    expect(existsSync(join(tmpDir, '.copair'))).toBe(true);
    expect(existsSync(join(tmpDir, '.copair', 'config.yaml'))).toBe(true);
    expect(existsSync(join(tmpDir, '.copair', 'commands'))).toBe(true);
  });

  it('does not overwrite existing config.yaml on re-scaffold', async () => {
    const { mkdirSync, writeFileSync, readFileSync } = await import('node:fs');
    mkdirSync(join(tmpDir, '.copair', 'commands'), { recursive: true });
    writeFileSync(join(tmpDir, '.copair', 'config.yaml'), '# existing\n');

    const manager = new ProjectInitManager() as unknown as {
      scaffold(cwd: string): Promise<void>;
    };
    await manager.scaffold(tmpDir);

    const content = readFileSync(join(tmpDir, '.copair', 'config.yaml'), 'utf8');
    expect(content).toBe('# existing\n');
  });

  it('DECLINED_MESSAGE is defined', () => {
    expect(DECLINED_MESSAGE).toContain('Copair not initialised');
  });
});
