/**
 * E2E tests: spawn the real copair binary and verify output.
 * These tests require a built dist/ — run `pnpm build` first.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(__dirname, '../../dist/index.js');

function run(args: string[], opts: { env?: NodeJS.ProcessEnv; input?: string; cwd?: string } = {}) {
  return spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    input: opts.input,
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
  });
}

/**
 * Create a temp directory that looks like an initialised copair project
 * (.copair/ present) so ProjectInitManager skips the trust prompt.
 */
function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'copair-project-'));
  mkdirSync(join(dir, '.copair'), { recursive: true });
  return dir;
}

describe('--version flag', () => {
  it('prints the package version and exits 0', () => {
    const { status, stdout, stderr } = run(['--version']);
    // Commander prints version to stdout
    const out = (stdout + stderr).trim();
    expect(out).toMatch(/\d+\.\d+\.\d+/);
    expect(status).toBe(0);
  });
});

describe('--help flag', () => {
  it('prints usage information and exits 0', () => {
    const { status, stdout, stderr } = run(['--help']);
    const out = (stdout + stderr);
    expect(out).toMatch(/usage|copair|options/i);
    expect(status).toBe(0);
  });
});

describe('missing config', () => {
  it('exits with an error when no config file exists and no default model is set', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'copair-e2e-home-'));
    const tmpProject = makeTempProject();
    try {
      // Write a minimal config so it doesn't fail on providers, but leave default_model unset
      // Actually, just use a completely empty home so loadConfig returns defaults
      const { status, stderr } = run(['--model', 'nonexistent-model-xyz'], {
        cwd: tmpProject,
        env: {
          HOME: tmpHome,
          XDG_CONFIG_HOME: join(tmpHome, '.config'),
        },
      });
      // Should exit non-zero with a helpful message
      expect(status).not.toBe(0);
      expect(stderr).toMatch(/model|config|not found/i);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
      rmSync(tmpProject, { recursive: true, force: true });
    }
  });
});

describe('config with openai-compatible provider (no live API)', () => {
  it('exits with a clear error when provider URL is unreachable', { timeout: 15000 }, () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'copair-e2e-home-'));
    const tmpProject = makeTempProject();
    try {
      const configDir = join(tmpHome, '.copair');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.yaml'),
        [
          'version: 1',
          'default_model: local',
          'providers:',
          '  local:',
          '    type: openai-compatible',
          '    base_url: http://127.0.0.1:19999/v1',
          '    models:',
          '      local:',
          '        id: test-model',
          '        max_tokens: 100',
          '        context_window: 4096',
          '        supports_tool_calling: false',
          'permissions:',
          '  mode: auto-approve',
        ].join('\n'),
      );

      // Pipe a single message then EOF so copair tries to call the (unreachable) server
      const { status, stderr } = run([], {
        cwd: tmpProject,
        env: { HOME: tmpHome, USERPROFILE: tmpHome },
        input: 'hello\n',
      });

      // We expect a non-zero exit due to connection failure
      // The exact error message will mention connection/fetch/ECONNREFUSED
      expect(status).not.toBe(0);
      expect(stderr + '').toMatch(/connect|fetch|ECONNREFUSED|network|error/i);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
      rmSync(tmpProject, { recursive: true, force: true });
    }
  });
});
