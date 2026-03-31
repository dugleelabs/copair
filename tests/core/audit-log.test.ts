import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLog } from '../../src/core/audit-log.js';
import type { AuditEntry } from '../../src/core/audit-log.js';

function makeSessionDir(): string {
  return mkdtempSync(join(tmpdir(), 'copair-audit-'));
}

function readEntries(logPath: string): AuditEntry[] {
  const lines = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map((l) => JSON.parse(l) as AuditEntry);
}

describe('AuditLog', () => {
  let sessionDir: string;
  let log: AuditLog;

  beforeEach(() => {
    sessionDir = makeSessionDir();
    log = new AuditLog(sessionDir);
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  // ── Basic write ────────────────────────────────────────────────────────────

  it('writes a JSONL entry to audit.jsonl in the session dir', async () => {
    await log.append({ event: 'session_start', outcome: 'allowed' });

    const entries = readEntries(log.getLogPath());
    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe('session_start');
    expect(entries[0].outcome).toBe('allowed');
  });

  it('adds a ts field in ISO 8601 format', async () => {
    const before = new Date().toISOString();
    await log.append({ event: 'tool_call', tool: 'read', outcome: 'allowed' });
    const after = new Date().toISOString();

    const [entry] = readEntries(log.getLogPath());
    expect(entry.ts).toBeDefined();
    expect(entry.ts >= before).toBe(true);
    expect(entry.ts <= after).toBe(true);
  });

  it('creates the file with mode 0o600', async () => {
    await log.append({ event: 'session_start', outcome: 'allowed' });
    const mode = statSync(log.getLogPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('appends multiple entries as separate JSONL lines', async () => {
    await log.append({ event: 'session_start', outcome: 'allowed' });
    await log.append({ event: 'tool_call', tool: 'write', outcome: 'allowed' });
    await log.append({ event: 'session_end', outcome: 'allowed' });

    const entries = readEntries(log.getLogPath());
    expect(entries).toHaveLength(3);
    expect(entries[0].event).toBe('session_start');
    expect(entries[1].event).toBe('tool_call');
    expect(entries[2].event).toBe('session_end');
  });

  // ── input_summary truncation ───────────────────────────────────────────────

  it('truncates input_summary to 200 chars', async () => {
    const longSummary = 'x'.repeat(300);
    await log.append({ event: 'tool_call', tool: 'bash', outcome: 'allowed', input_summary: longSummary });

    const [entry] = readEntries(log.getLogPath());
    expect(entry.input_summary).toHaveLength(200);
  });

  it('leaves input_summary intact when under 200 chars', async () => {
    const shortSummary = 'cat README.md';
    await log.append({ event: 'tool_call', tool: 'bash', outcome: 'allowed', input_summary: shortSummary });

    const [entry] = readEntries(log.getLogPath());
    expect(entry.input_summary).toBe(shortSummary);
  });

  it('omits input_summary field when not provided', async () => {
    await log.append({ event: 'approval', outcome: 'allowed', approved_by: 'user' });

    const raw = readFileSync(log.getLogPath(), 'utf8');
    expect(raw).not.toContain('input_summary');
  });

  // ── Secrets redaction ──────────────────────────────────────────────────────

  it('redacts Anthropic API keys in input_summary', async () => {
    const summary = 'command: echo sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234';
    await log.append({ event: 'tool_call', tool: 'bash', outcome: 'allowed', input_summary: summary });

    const [entry] = readEntries(log.getLogPath());
    expect(entry.input_summary).not.toContain('sk-ant-');
    expect(entry.input_summary).toContain('[REDACTED:anthropic]');
  });

  it('redacts OpenAI API keys in input_summary', async () => {
    const summary = 'key: sk-abcdefghijklmnopqrstuvwxyz123456';
    await log.append({ event: 'tool_call', tool: 'bash', outcome: 'allowed', input_summary: summary });

    const [entry] = readEntries(log.getLogPath());
    expect(entry.input_summary).not.toContain('sk-abcdefghijkl');
    expect(entry.input_summary).toContain('[REDACTED:openai]');
  });

  it('redacts GitHub tokens in input_summary', async () => {
    const summary = 'token: ghp_' + 'a'.repeat(36);
    await log.append({ event: 'tool_call', tool: 'bash', outcome: 'allowed', input_summary: summary });

    const [entry] = readEntries(log.getLogPath());
    expect(entry.input_summary).not.toContain('ghp_');
    expect(entry.input_summary).toContain('[REDACTED:github]');
  });

  it('truncates after redaction (combined length ≤ 200)', async () => {
    // Build a summary that is long after adding a secret, so both truncation and
    // redaction are exercised together.
    const secret = 'sk-ant-api03-' + 'z'.repeat(30);
    const padding = 'x'.repeat(150);
    const summary = secret + padding; // raw > 200 chars
    await log.append({ event: 'tool_call', tool: 'bash', outcome: 'allowed', input_summary: summary });

    const [entry] = readEntries(log.getLogPath());
    expect(entry.input_summary!.length).toBeLessThanOrEqual(200);
    expect(entry.input_summary).not.toContain('sk-ant-');
  });

  // ── Optional fields ────────────────────────────────────────────────────────

  it('writes approved_by field when provided', async () => {
    await log.append({ event: 'approval', outcome: 'allowed', approved_by: 'allow_list' });
    const [entry] = readEntries(log.getLogPath());
    expect(entry.approved_by).toBe('allow_list');
  });

  it('writes detail field when provided', async () => {
    await log.append({ event: 'path_block', outcome: 'denied', detail: 'outside project root' });
    const [entry] = readEntries(log.getLogPath());
    expect(entry.detail).toBe('outside project root');
  });

  it('omits undefined optional fields from JSONL output', async () => {
    await log.append({ event: 'session_end', outcome: 'allowed' });
    const raw = readFileSync(log.getLogPath(), 'utf8');
    expect(raw).not.toContain('"tool"');
    expect(raw).not.toContain('"approved_by"');
    expect(raw).not.toContain('"detail"');
  });

  // ── getLogPath ─────────────────────────────────────────────────────────────

  it('getLogPath returns audit.jsonl inside session dir', () => {
    expect(log.getLogPath()).toBe(join(sessionDir, 'audit.jsonl'));
  });
});
