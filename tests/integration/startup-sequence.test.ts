/**
 * Integration tests for the startup sequence — verifies manager interactions
 * without spawning the full CLI (which requires a live model API).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GlobalInitManager } from '../../src/init/GlobalInitManager.js';
import { ProjectInitManager } from '../../src/init/ProjectInitManager.js';
import { GitignoreManager } from '../../src/init/GitignoreManager.js';
import { KnowledgeManager, KB_FILENAME } from '../../src/knowledge/KnowledgeManager.js';
import { loadConfig } from '../../src/config/loader.js';

describe('Startup sequence — integration', () => {
  let tmpDir: string;
  let tmpHome: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'copair-startup-integration-'));
    tmpHome = mkdtempSync(join(tmpdir(), 'copair-home-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('existing global config + new project: skips global, does project init in CI', async () => {
    // Simulate: ~/.copair/ already exists (global config present)
    mkdirSync(join(tmpHome, '.copair'), { recursive: true });

    const gm = new GlobalInitManager(tmpHome);
    const globalResult = await gm.check({ ci: true });
    expect(globalResult.skipped).toBe(true);

    // .copair/ absent in project → CI mode → declined
    const pm = new ProjectInitManager();
    const projectResult = await pm.check(tmpDir, { ci: true });
    expect(projectResult.declined).toBe(true);
    expect(projectResult.created).toBe(false);
  });

  it('existing .copair/ with partial gitignore: consolidation happens in CI', async () => {
    mkdirSync(join(tmpDir, '.copair'), { recursive: true });
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\n.copair/sessions/\n');

    const gim = new GitignoreManager();
    await gim.ensureCovered(tmpDir, { ci: true });

    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toContain('.copair/');
    expect(content).not.toContain('.copair/sessions/');
  });

  it('COPAIR_KNOWLEDGE.md present: loaded and injectable into system prompt', () => {
    const kbContent = '# Copair Knowledge Base\n\n## Directory Map\n- src/ — TypeScript\n';
    writeFileSync(join(tmpDir, KB_FILENAME), kbContent);

    const km = new KnowledgeManager();
    const result = km.load(tmpDir);

    expect(result.found).toBe(true);
    expect(result.content).toBe(kbContent);

    const injected = km.injectIntoSystemPrompt(result.content!);
    expect(injected).toContain('<knowledge source="user">');
    expect(injected).toContain('Directory Map');
    expect(injected).toContain('</knowledge>');
  });

  it('COPAIR_KNOWLEDGE.md oversized (> 16 KB): hard error thrown', () => {
    const oversized = '# Knowledge\n' + 'x'.repeat(16 * 1024 + 100);
    writeFileSync(join(tmpDir, KB_FILENAME), oversized);

    const km = new KnowledgeManager({ warn_size_kb: 8, max_size_kb: 16 });
    const result = km.load(tmpDir);

    expect(() => km.checkSizeBudget(result.sizeBytes)).toThrow(/hard cap/);
  });

  it('config merge: project config overrides global config', () => {
    // Set up global config in tmpHome
    mkdirSync(join(tmpHome, '.copair'), { recursive: true });
    writeFileSync(
      join(tmpHome, '.copair', 'config.yaml'),
      'version: 1\ndefault_model: gpt-4o\n',
    );

    // Set up project config
    mkdirSync(join(tmpDir, '.copair'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.copair', 'config.yaml'),
      'version: 1\ndefault_model: claude-sonnet\n',
    );

    // Override HOME for loadConfig
    const originalHome = process.env['HOME'];
    process.env['HOME'] = tmpHome;
    try {
      const config = loadConfig(tmpDir);
      expect(config.default_model).toBe('claude-sonnet');
    } finally {
      if (originalHome !== undefined) {
        process.env['HOME'] = originalHome;
      } else {
        delete process.env['HOME'];
      }
    }
  });

  it('.copair.yaml at root is ignored — .copair/config.yaml takes precedence', () => {
    // Place a .copair.yaml at root (old format) — should be ignored
    writeFileSync(join(tmpDir, '.copair.yaml'), 'version: 1\ndefault_model: old-model\n');

    // No .copair/config.yaml → loadConfig returns defaults
    mkdirSync(join(tmpDir, '.copair'), { recursive: true });

    const originalHome = process.env['HOME'];
    process.env['HOME'] = tmpHome;
    try {
      // No ~/.copair/config.yaml either
      const config = loadConfig(tmpDir);
      // default_model is not set — old .copair.yaml is not read
      expect(config.default_model).toBeUndefined();
    } finally {
      if (originalHome !== undefined) {
        process.env['HOME'] = originalHome;
      } else {
        delete process.env['HOME'];
      }
    }
  });
});
