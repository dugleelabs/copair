import { describe, it, expect } from 'vitest';
import { redact, HIGH_ENTROPY_PATTERN } from '../../src/core/redactor.js';

describe('redactor', () => {
  // ── Pattern coverage ─────────────────────────────────────────────────────

  it('redacts Anthropic key with [REDACTED:anthropic]', () => {
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345';
    expect(redact(key)).toBe('[REDACTED:anthropic]');
  });

  it('redacts OpenAI key with [REDACTED:openai]', () => {
    const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
    expect(redact(key)).toBe('[REDACTED:openai]');
  });

  it('redacts GitHub token with [REDACTED:github]', () => {
    const key = 'ghp_' + 'a'.repeat(36);
    expect(redact(key)).toBe('[REDACTED:github]');
  });

  it('redacts GitHub fine-grained PAT with [REDACTED:github-pat]', () => {
    const key = 'github_pat_' + 'a'.repeat(82);
    expect(redact(key)).toBe('[REDACTED:github-pat]');
  });

  it('redacts AWS access key with [REDACTED:aws]', () => {
    const key = 'AKIAIOSFODNN7EXAMPLE';
    expect(redact(key)).toBe('[REDACTED:aws]');
  });

  it('redacts Linear API key with [REDACTED:linear]', () => {
    const key = 'lin_api_abcdef123456';
    expect(redact(key)).toBe('[REDACTED:linear]');
  });

  it('redacts Google API key with [REDACTED:google]', () => {
    const key = 'AIza' + 'a'.repeat(35);
    expect(redact(key)).toBe('[REDACTED:google]');
  });

  it('redacts Bearer token', () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.abc')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
  });

  // ── Ordering: sk-ant- must win over sk- ──────────────────────────────────

  it('labels Anthropic key [REDACTED:anthropic] not [REDACTED:openai]', () => {
    const key = 'sk-ant-api03-' + 'x'.repeat(30);
    const result = redact(key);
    expect(result).toBe('[REDACTED:anthropic]');
    expect(result).not.toContain('openai');
  });

  // ── Non-secret strings must pass through unchanged ───────────────────────

  it('passes SHA-256 hex digest through unchanged', () => {
    const sha = 'a'.repeat(64); // all-lowercase hex — not mixed case+digit
    expect(redact(sha)).toBe(sha);
  });

  it('passes UUIDs through unchanged', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(redact(uuid)).toBe(uuid);
  });

  it('passes plain text through unchanged', () => {
    expect(redact('hello world')).toBe('hello world');
  });

  it('passes empty string through unchanged', () => {
    expect(redact('')).toBe('');
  });

  // ── Partial redaction in mixed content ───────────────────────────────────

  it('redacts key embedded in log line, leaves surrounding text', () => {
    const log = `api_key=sk-ant-api03-${'z'.repeat(30)} response=ok`;
    const result = redact(log);
    expect(result).toContain('[REDACTED:anthropic]');
    expect(result).toContain('api_key=');
    expect(result).toContain('response=ok');
    expect(result).not.toContain('sk-ant-');
  });

  // ── High-entropy opt-in ──────────────────────────────────────────────────

  it('passes long base64 through when highEntropy is false (default)', () => {
    // Mixed case + digit — would match looksLikeSecret but should pass through
    const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789AB';
    expect(redact(b64)).toBe(b64);
    expect(redact(b64, { highEntropy: false })).toBe(b64);
  });

  it('redacts long mixed-case+digit base64 when highEntropy is true', () => {
    const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789AB';
    expect(redact(b64, { highEntropy: true })).toBe('[HIGH-ENTROPY-REDACTED]');
  });

  it('does not redact all-lowercase base64 even with highEntropy true (not looksLikeSecret)', () => {
    const lowercase = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrs'; // 45 chars, no upper/digit
    expect(redact(lowercase, { highEntropy: true })).toBe(lowercase);
  });

  // ── Idempotency ──────────────────────────────────────────────────────────

  it('is idempotent — applying redact twice gives same result', () => {
    const input = `key=sk-ant-api03-${'a'.repeat(25)} token=Bearer abc123def`;
    const once = redact(input);
    const twice = redact(once);
    expect(twice).toBe(once);
  });

  // ── HIGH_ENTROPY_PATTERN export ──────────────────────────────────────────

  it('exports HIGH_ENTROPY_PATTERN as a named RegExp', () => {
    expect(HIGH_ENTROPY_PATTERN).toBeInstanceOf(RegExp);
    expect(HIGH_ENTROPY_PATTERN.flags).toContain('g');
  });
});
