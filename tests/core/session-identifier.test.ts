import { describe, it, expect } from 'vitest';
import { deriveIdentifier } from '../../src/core/session-identifier.js';
import type { Message } from '../../src/providers/interface.js';

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';

function userMsg(text: string): Message {
  return { role: 'user', content: [{ type: 'text', text }] };
}

function toolUseMsg(name: string, filePath: string): Message {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'call_1', name, input: { file_path: filePath } }],
  };
}

describe('deriveIdentifier', () => {
  it('derives from branch name (highest weight)', () => {
    const messages = [userMsg('help me with something')];
    const id = deriveIdentifier(messages, SESSION_ID, 'feat/auth-middleware');
    expect(id).toContain('auth');
    expect(id).toContain('middleware');
  });

  it('derives from user message when no branch signal', () => {
    const messages = [userMsg('refactor the authentication middleware')];
    const id = deriveIdentifier(messages, SESSION_ID, 'main');
    expect(id).toContain('refactor');
    expect(id).toContain('authentication');
  });

  it('derives from file paths in tool calls', () => {
    const messages = [
      userMsg('fix the bug'),
      toolUseMsg('read', '/src/auth/login-handler.ts'),
      toolUseMsg('edit', '/src/auth/session-store.ts'),
    ];
    const id = deriveIdentifier(messages, SESSION_ID);
    expect(id).toMatch(/login|handler|session|store/);
  });

  it('handles mixed signals (branch + message + files)', () => {
    const messages = [
      userMsg('refactor the auth middleware'),
      toolUseMsg('read', '/src/middleware/auth.ts'),
    ];
    const id = deriveIdentifier(messages, SESSION_ID, 'fix/login-timeout');
    // Branch words should dominate (3x weight)
    expect(id).toContain('login');
    expect(id).toContain('timeout');
  });

  it('strips branch type prefix', () => {
    const messages = [userMsg('hello')];
    const id = deriveIdentifier(messages, SESSION_ID, 'feat/user-dashboard');
    expect(id).not.toMatch(/^feat/);
    expect(id).toContain('user');
    expect(id).toContain('dashboard');
  });

  it('filters stop words', () => {
    const messages = [userMsg('please help me fix the code in this file')];
    const id = deriveIdentifier(messages, SESSION_ID);
    // "please", "help", "the", "code", "this", "file" are stop words
    // Only "fix" passes (len > 2 and not a stop word)
    expect(id).not.toContain('please');
    expect(id).not.toContain('help');
  });

  it('appends 4-char hash suffix', () => {
    const messages = [userMsg('test something')];
    const id = deriveIdentifier(messages, SESSION_ID);
    // Should end with a 4-char hex suffix
    expect(id).toMatch(/-[a-f0-9]{4}$/);
  });

  it('truncates to 40 chars max', () => {
    const messages = [
      userMsg(
        'implement the authentication authorization middleware handler for the dashboard controller service',
      ),
    ];
    const id = deriveIdentifier(messages, SESSION_ID, 'feat/super-long-branch-name-with-many-words');
    expect(id.length).toBeLessThanOrEqual(40);
  });

  it('handles empty messages gracefully', () => {
    const id = deriveIdentifier([], SESSION_ID);
    expect(id).toContain('session');
    expect(id).toMatch(/-[a-f0-9]{4}$/);
  });

  it('handles unicode input', () => {
    const messages = [userMsg('fix the login bug for Japanese locale')];
    const id = deriveIdentifier(messages, SESSION_ID);
    // Should produce valid slug characters only
    expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('produces slugified output (lowercase, hyphens only)', () => {
    const messages = [userMsg('Refactor AuthMiddleware')];
    const id = deriveIdentifier(messages, SESSION_ID, 'feat/API_Gateway');
    expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('produces different hashes for different session IDs', () => {
    const messages = [userMsg('same message')];
    const id1 = deriveIdentifier(messages, '11111111-1111-1111-1111-111111111111');
    const id2 = deriveIdentifier(messages, '22222222-2222-2222-2222-222222222222');
    // Same words but different hash suffixes
    const suffix1 = id1.slice(-4);
    const suffix2 = id2.slice(-4);
    expect(suffix1).not.toBe(suffix2);
  });
});
