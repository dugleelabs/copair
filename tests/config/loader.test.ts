import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, resolveEnvVarString } from '../../src/config/loader.js';

describe('loadConfig', () => {
  const testDir = join(tmpdir(), 'copair-test-config-' + Date.now());
  const globalDir = join(testDir, 'home', '.copair');
  const projectDir = join(testDir, 'project');

  beforeEach(() => {
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    // Override HOME so loadConfig looks in our test dir
    vi.stubEnv('HOME', join(testDir, 'home'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns minimal defaults when no config files exist', () => {
    const config = loadConfig(join(testDir, 'nonexistent'));
    expect(config.version).toBe(1);
    expect(config.providers).toEqual({});
  });

  it('loads global config', () => {
    writeFileSync(
      join(globalDir, 'config.yaml'),
      `version: 1
default_model: gpt-4o
providers:
  openai:
    api_key: sk-test
    models:
      gpt-4o:
        id: gpt-4o
`,
    );

    const config = loadConfig(projectDir);
    expect(config.default_model).toBe('gpt-4o');
    expect(config.providers.openai.api_key).toBe('sk-test');
  });

  it('merges project config over global config', () => {
    writeFileSync(
      join(globalDir, 'config.yaml'),
      `version: 1
default_model: gpt-4o
providers:
  openai:
    api_key: sk-global
    models:
      gpt-4o:
        id: gpt-4o
`,
    );

    writeFileSync(
      join(projectDir, '.copair.yaml'),
      `version: 1
default_model: claude-sonnet
providers:
  anthropic:
    api_key: sk-project
    models:
      claude-sonnet:
        id: claude-sonnet-4-20250514
`,
    );

    const config = loadConfig(projectDir);
    expect(config.default_model).toBe('claude-sonnet');
    // Global provider should still be present
    expect(config.providers.openai.api_key).toBe('sk-global');
    // Project provider added
    expect(config.providers.anthropic.api_key).toBe('sk-project');
  });

  it('interpolates environment variables', () => {
    vi.stubEnv('TEST_API_KEY', 'sk-from-env');

    writeFileSync(
      join(globalDir, 'config.yaml'),
      `version: 1
providers:
  openai:
    api_key: \${TEST_API_KEY}
    models:
      gpt-4o:
        id: gpt-4o
`,
    );

    const config = loadConfig(projectDir);
    expect(config.providers.openai.api_key).toBe('sk-from-env');
  });

  it('preserves unresolved ${VAR} templates for missing env vars at load time', () => {
    writeFileSync(
      join(globalDir, 'config.yaml'),
      `version: 1
providers:
  openai:
    api_key: \${NONEXISTENT_VAR_12345}
    models:
      gpt-4o:
        id: gpt-4o
`,
    );

    // Config loads successfully — missing vars are kept as raw templates so that
    // unused providers don't block startup.
    const config = loadConfig(projectDir);
    expect(config.providers.openai.api_key).toBe('${NONEXISTENT_VAR_12345}');
  });

  it('resolveEnvVarString throws on missing environment variable', () => {
    expect(() => resolveEnvVarString('${NONEXISTENT_VAR_12345}')).toThrow(
      'Environment variable "NONEXISTENT_VAR_12345" is not set',
    );
  });

  it('throws on unsupported config version', () => {
    writeFileSync(
      join(globalDir, 'config.yaml'),
      `version: 99
providers: {}
`,
    );

    expect(() => loadConfig(projectDir)).toThrow(
      'Config version 99 is not supported',
    );
  });

  it('throws on invalid config', () => {
    writeFileSync(
      join(globalDir, 'config.yaml'),
      `version: 1
providers:
  openai:
    type: invalid-type
    models: {}
`,
    );

    expect(() => loadConfig(projectDir)).toThrow();
  });
});
