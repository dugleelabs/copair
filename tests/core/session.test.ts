import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { atomicWrite, resolveSessionsDir, ensureGitignore, SessionManager } from '../../src/core/session.js';

describe('atomicWrite', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'copair-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes file with correct content', async () => {
    const filePath = join(tmpDir, 'test.json');
    await atomicWrite(filePath, '{"hello":"world"}');
    expect(readFileSync(filePath, 'utf8')).toBe('{"hello":"world"}');
  });

  it('sets 0o600 permissions', async () => {
    const filePath = join(tmpDir, 'secure.json');
    await atomicWrite(filePath, 'secret');
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('cleans up temp file on success', async () => {
    const filePath = join(tmpDir, 'clean.json');
    await atomicWrite(filePath, 'data');
    const files = require('node:fs').readdirSync(tmpDir);
    expect(files).toEqual(['clean.json']);
  });
});

describe('resolveSessionsDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'copair-resolve-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('uses cwd .copair/sessions/ when .copair exists and not a git repo', () => {
    mkdirSync(join(tmpDir, '.copair'), { recursive: true });
    const result = resolveSessionsDir(tmpDir);
    expect(result).toBe(join(tmpDir, '.copair', 'sessions'));
    expect(existsSync(result)).toBe(true);
  });

  it('falls back to global ~/.copair/sessions/ when no .copair dir', () => {
    // Use a dir with no .copair and no git
    const emptyDir = mkdtempSync(join(tmpdir(), 'copair-empty-'));
    const result = resolveSessionsDir(emptyDir);
    const home = process.env['HOME'] ?? '~';
    expect(result).toContain('.copair/sessions');
    // Cleanup
    rm(emptyDir, { recursive: true, force: true });
  });
});

describe('ensureGitignore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'copair-gitignore-'));
    mkdirSync(join(tmpDir, '.copair'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates .gitignore with sessions/ entry', async () => {
    await ensureGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, '.copair', '.gitignore'), 'utf8');
    expect(content).toContain('sessions/');
  });

  it('is idempotent — does not duplicate entry', async () => {
    await ensureGitignore(tmpDir);
    await ensureGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, '.copair', '.gitignore'), 'utf8');
    const matches = content.match(/sessions\//g);
    expect(matches).toHaveLength(1);
  });
});

describe('SessionManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'copair-session-'));
    mkdirSync(join(tmpDir, '.copair'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a session with valid metadata', async () => {
    const mgr = new SessionManager(tmpDir);
    const meta = await mgr.create('claude-sonnet', 'feat/test');

    expect(meta.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(meta.model).toBe('claude-sonnet');
    expect(meta.branch).toBe('feat/test');
    expect(meta.messageCount).toBe(0);
    expect(meta.hasSummary).toBe(false);

    // Verify session.json written
    const raw = readFileSync(join(mgr.getSessionDir(), 'session.json'), 'utf8');
    const persisted = JSON.parse(raw);
    expect(persisted.id).toBe(meta.id);
  });

  it('save → resume round trip preserves messages', async () => {
    const mgr = new SessionManager(tmpDir);
    const meta = await mgr.create('claude-sonnet');

    const messages = [
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'Hi there' }] },
    ];
    await mgr.save(messages);

    // Resume in a new manager
    const mgr2 = new SessionManager(tmpDir);
    const restored = await mgr2.resume(meta.id);

    expect(restored.messages).toHaveLength(2);
    expect(restored.messages[0].role).toBe('user');
    expect(restored.messages[1].content[0]).toMatchObject({ type: 'text', text: 'Hi there' });
    expect(restored.metadata.messageCount).toBe(2);
    expect(restored.summary).toBeNull();
  });

  it('save appends incrementally (not full rewrite)', async () => {
    const mgr = new SessionManager(tmpDir);
    await mgr.create('claude-sonnet');

    const msg1 = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'First' }] }];
    await mgr.save(msg1);

    const msg2 = [
      ...msg1,
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'Second' }] },
    ];
    await mgr.save(msg2);

    const jsonl = readFileSync(join(mgr.getSessionDir(), 'messages.jsonl'), 'utf8');
    const lines = jsonl.trim().split('\n');
    expect(lines).toHaveLength(2); // 1 from first save + 1 from second
  });

  it('listSessions returns sessions sorted by lastActive', async () => {
    const sessionsDir = join(tmpDir, '.copair', 'sessions');

    const mgr1 = new SessionManager(tmpDir);
    await mgr1.create('model-a');
    await mgr1.save([{ role: 'user', content: [{ type: 'text', text: 'old' }] }]);

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 50));

    const mgr2 = new SessionManager(tmpDir);
    await mgr2.create('model-b');
    await mgr2.save([{ role: 'user', content: [{ type: 'text', text: 'new' }] }]);

    const sessions = await SessionManager.listSessions(sessionsDir);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].model).toBe('model-b'); // Most recent first
  });

  it('deleteSession removes session directory', async () => {
    const sessionsDir = join(tmpDir, '.copair', 'sessions');
    const mgr = new SessionManager(tmpDir);
    const meta = await mgr.create('claude-sonnet');

    expect(existsSync(join(sessionsDir, meta.id))).toBe(true);
    await SessionManager.deleteSession(sessionsDir, meta.id);
    expect(existsSync(join(sessionsDir, meta.id))).toBe(false);
  });

  it('deleteSession handles non-existent session gracefully', async () => {
    const sessionsDir = join(tmpDir, '.copair', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    await expect(SessionManager.deleteSession(sessionsDir, 'nonexistent')).resolves.not.toThrow();
  });

  it('cleanup removes oldest sessions beyond max', async () => {
    const sessionsDir = join(tmpDir, '.copair', 'sessions');

    for (let i = 0; i < 3; i++) {
      const mgr = new SessionManager(tmpDir);
      await mgr.create(`model-${i}`);
      await mgr.save([{ role: 'user', content: [{ type: 'text', text: `msg ${i}` }] }]);
      await new Promise((r) => setTimeout(r, 50));
    }

    await SessionManager.cleanup(sessionsDir, 2);
    const remaining = await SessionManager.listSessions(sessionsDir);
    expect(remaining).toHaveLength(2);
  });

  it('resume reads compressed messages.jsonl.gz', async () => {
    const mgr = new SessionManager(tmpDir);
    const meta = await mgr.create('claude-sonnet');

    // Write a compressed messages file directly
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'compressed msg' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
    ];
    const jsonl = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
    const compressed = gzipSync(Buffer.from(jsonl));
    await writeFile(join(mgr.getSessionDir(), 'messages.jsonl.gz'), compressed, { mode: 0o600 });

    // Resume in a new manager
    const mgr2 = new SessionManager(tmpDir);
    const restored = await mgr2.resume(meta.id);
    expect(restored.messages).toHaveLength(2);
    expect(restored.messages[0].content[0]).toMatchObject({ type: 'text', text: 'compressed msg' });
  });

  it('migrateGlobalRecovery migrates and deletes recovery.json', async () => {
    const sessionsDir = join(tmpDir, '.copair', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    // Create a fake recovery.json in a temp "home"
    const fakeHome = mkdtempSync(join(tmpdir(), 'copair-home-'));
    const recoveryDir = join(fakeHome, '.copair', 'sessions');
    mkdirSync(recoveryDir, { recursive: true });
    writeFileSync(
      join(recoveryDir, 'recovery.json'),
      JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'recovered' }] }],
        savedAt: '2026-03-23T10:00:00Z',
      }),
    );

    // Override HOME for migration
    const origHome = process.env['HOME'];
    process.env['HOME'] = fakeHome;
    try {
      const meta = await SessionManager.migrateGlobalRecovery(sessionsDir, tmpDir);
      expect(meta).not.toBeNull();
      expect(meta!.identifier).toMatch(/^recovered-session-/);
      expect(meta!.messageCount).toBe(1);
      expect(existsSync(join(recoveryDir, 'recovery.json'))).toBe(false);
    } finally {
      process.env['HOME'] = origHome;
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
});
