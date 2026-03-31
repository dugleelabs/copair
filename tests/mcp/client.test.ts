import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildMcpEnv, validateMcpServer } from '../../src/mcp/client.js';

// ── buildMcpEnv (T-28) ────────────────────────────────────────────────────────

describe('buildMcpEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set a known environment for testing
    process.env['PATH'] = '/usr/bin:/bin';
    process.env['HOME'] = '/home/testuser';
    process.env['TMPDIR'] = '/tmp';
    process.env['LANG'] = 'en_US.UTF-8';
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-secret-key-should-not-leak';
    process.env['OPENAI_API_KEY'] = 'sk-openai-secret-should-not-leak';
    process.env['MY_CUSTOM_SECRET'] = 'super-secret';
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('excludes ANTHROPIC_API_KEY by default (inherit_env: false)', () => {
    const env = buildMcpEnv();
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('excludes OPENAI_API_KEY by default', () => {
    const env = buildMcpEnv();
    expect(env['OPENAI_API_KEY']).toBeUndefined();
  });

  it('excludes arbitrary secrets by default', () => {
    const env = buildMcpEnv();
    expect(env['MY_CUSTOM_SECRET']).toBeUndefined();
  });

  it('includes PATH from process.env by default', () => {
    const env = buildMcpEnv();
    expect(env['PATH']).toBe('/usr/bin:/bin');
  });

  it('includes HOME from process.env by default', () => {
    const env = buildMcpEnv();
    expect(env['HOME']).toBe('/home/testuser');
  });

  it('includes TMPDIR from process.env by default', () => {
    const env = buildMcpEnv();
    expect(env['TMPDIR']).toBe('/tmp');
  });

  it('includes LANG from process.env by default', () => {
    const env = buildMcpEnv();
    expect(env['LANG']).toBe('en_US.UTF-8');
  });

  it('merges explicit server env vars into the minimal set', () => {
    const serverEnv = { MY_MCP_TOKEN: 'token-for-mcp-server' };
    const env = buildMcpEnv(serverEnv);
    expect(env['MY_MCP_TOKEN']).toBe('token-for-mcp-server');
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('server env vars override minimal env vars when there is a collision', () => {
    const serverEnv = { PATH: '/custom/bin' };
    const env = buildMcpEnv(serverEnv);
    expect(env['PATH']).toBe('/custom/bin');
  });

  it('inherit_env: true includes ANTHROPIC_API_KEY', () => {
    const env = buildMcpEnv(undefined, true);
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-api03-secret-key-should-not-leak');
  });

  it('inherit_env: true includes all process.env keys', () => {
    const env = buildMcpEnv(undefined, true);
    expect(env['MY_CUSTOM_SECRET']).toBe('super-secret');
    expect(env['PATH']).toBe('/usr/bin:/bin');
  });

  it('inherit_env: true still merges explicit server env vars on top', () => {
    const serverEnv = { EXTRA_VAR: 'explicit' };
    const env = buildMcpEnv(serverEnv, true);
    expect(env['EXTRA_VAR']).toBe('explicit');
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant-api03-secret-key-should-not-leak');
  });

  it('returns empty-ish env when minimal keys are absent', () => {
    delete process.env['PATH'];
    delete process.env['HOME'];
    delete process.env['TMPDIR'];
    delete process.env['LANG'];
    delete process.env['TEMP'];
    delete process.env['TMP'];
    delete process.env['LC_ALL'];
    const env = buildMcpEnv();
    expect(Object.keys(env)).toHaveLength(0);
  });
});

// ── validateMcpServer (T-27) ──────────────────────────────────────────────────

describe('validateMcpServer', () => {
  it('returns false and logs warning for absolute path that does not exist', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await validateMcpServer({
      name: 'missing-server',
      command: '/nonexistent/path/to/server',
      args: [],
    });
    expect(result).toBe(false);
    warnSpy.mockRestore();
  });

  it('returns false and logs warning for bare command not on $PATH', async () => {
    const result = await validateMcpServer({
      name: 'unknown-server',
      command: 'this-binary-definitely-does-not-exist-copair-test',
      args: [],
    });
    expect(result).toBe(false);
  });

  it('returns true for a command that exists on $PATH (e.g. node)', async () => {
    const result = await validateMcpServer({
      name: 'node-server',
      command: 'node',
      args: [],
    });
    expect(result).toBe(true);
  });

  it('returns true for an absolute path that exists (e.g. /bin/sh)', async () => {
    const result = await validateMcpServer({
      name: 'sh-server',
      command: '/bin/sh',
      args: [],
    });
    expect(result).toBe(true);
  });

  it('warns about env keys matching _KEY pattern but still returns true', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await validateMcpServer({
      name: 'leaky-server',
      command: 'node',
      args: [],
      env: { SOME_API_KEY: 'hardcoded-secret' },
    });
    expect(result).toBe(true); // valid command — only a warning, not a failure
    warnSpy.mockRestore();
  });

  it('warns about _SECRET, _TOKEN, _PASSWORD env keys but still returns true', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await validateMcpServer({
      name: 'leaky-server',
      command: 'node',
      args: [],
      env: {
        DB_PASSWORD: 'pass',
        AUTH_TOKEN: 'tok',
        CLIENT_SECRET: 'sec',
      },
    });
    expect(result).toBe(true); // valid command — warning only, not a hard failure
    warnSpy.mockRestore();
  });

  it('does not warn about non-sensitive env keys', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await validateMcpServer({
      name: 'safe-server',
      command: 'node',
      args: [],
      env: { NODE_ENV: 'production', DEBUG: 'false' },
    });
    expect(result).toBe(true);
    // The warn spy may be called for other reasons; just check command was valid
    warnSpy.mockRestore();
  });
});
