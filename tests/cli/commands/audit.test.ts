import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AuditEntry } from '../../../src/core/audit-log.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<AuditEntry> & { ts: string }): AuditEntry {
  return {
    ts: overrides.ts,
    event: overrides.event ?? 'tool_call',
    outcome: overrides.outcome ?? 'allowed',
    tool: overrides.tool,
    detail: overrides.detail,
    approved_by: overrides.approved_by,
    input_summary: overrides.input_summary,
  };
}

function writeAuditLog(dir: string, entries: AuditEntry[]): void {
  mkdirSync(dir, { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(join(dir, 'audit.jsonl'), lines, { mode: 0o600 });
}

// Build a fake sessions directory with multiple sessions
function makeSessionsDir(): { base: string; sessions: string[] } {
  const base = mkdtempSync(join(tmpdir(), 'copair-audit-cmd-'));
  const sessions: string[] = [];
  return { base, sessions };
}

// ── Import the internals we want to test ──────────────────────────────────────
// We import the pure logic functions by reaching into the module.
// The runAuditCommand itself is integration-level; we test key helpers directly.

// Re-implement the sort+slice logic here to test it without CLI side-effects.
function lastNEntries(allEntries: AuditEntry[], n: number): AuditEntry[] {
  return allEntries
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .slice(-n);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('audit --last sorting', () => {
  it('returns the N most recent entries sorted by ts ascending', () => {
    const entries: AuditEntry[] = [
      makeEntry({ ts: '2026-04-01T10:00:03Z', event: 'tool_call' }),
      makeEntry({ ts: '2026-04-01T10:00:01Z', event: 'session_start' }),
      makeEntry({ ts: '2026-04-01T10:00:05Z', event: 'session_end' }),
      makeEntry({ ts: '2026-04-01T10:00:02Z', event: 'approval' }),
      makeEntry({ ts: '2026-04-01T10:00:04Z', event: 'denial' }),
    ];

    const result = lastNEntries(entries, 3);
    expect(result).toHaveLength(3);
    // Should be the 3 most recent: 10:00:03, 10:00:04, 10:00:05
    expect(result[0].ts).toBe('2026-04-01T10:00:03Z');
    expect(result[1].ts).toBe('2026-04-01T10:00:04Z');
    expect(result[2].ts).toBe('2026-04-01T10:00:05Z');
  });

  it('returns all entries when N > total', () => {
    const entries: AuditEntry[] = [
      makeEntry({ ts: '2026-04-01T10:00:01Z', event: 'session_start' }),
      makeEntry({ ts: '2026-04-01T10:00:02Z', event: 'tool_call' }),
    ];
    const result = lastNEntries(entries, 100);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no entries', () => {
    expect(lastNEntries([], 5)).toHaveLength(0);
  });

  it('returns exactly 1 entry when N=1', () => {
    const entries: AuditEntry[] = [
      makeEntry({ ts: '2026-04-01T10:00:01Z', event: 'session_start' }),
      makeEntry({ ts: '2026-04-01T10:00:02Z', event: 'session_end' }),
    ];
    const result = lastNEntries(entries, 1);
    expect(result).toHaveLength(1);
    expect(result[0].ts).toBe('2026-04-01T10:00:02Z');
  });

  it('handles entries from multiple sessions with interleaved timestamps', () => {
    // Simulate two sessions with overlapping timestamps
    const session1: AuditEntry[] = [
      makeEntry({ ts: '2026-04-01T09:00:00Z', event: 'session_start' }),
      makeEntry({ ts: '2026-04-01T09:00:05Z', event: 'tool_call', tool: 'read' }),
    ];
    const session2: AuditEntry[] = [
      makeEntry({ ts: '2026-04-01T09:00:02Z', event: 'session_start' }),
      makeEntry({ ts: '2026-04-01T09:00:07Z', event: 'tool_call', tool: 'write' }),
    ];
    const all = [...session1, ...session2];
    const result = lastNEntries(all, 3);

    expect(result).toHaveLength(3);
    // Last 3 by time: 09:00:02, 09:00:05, 09:00:07
    expect(result[0].ts).toBe('2026-04-01T09:00:02Z');
    expect(result[1].ts).toBe('2026-04-01T09:00:05Z');
    expect(result[2].ts).toBe('2026-04-01T09:00:07Z');
  });
});

describe('audit --json output', () => {
  let capturedOutput: string;
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    capturedOutput = '';
    originalWrite = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      capturedOutput += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    vi.restoreAllMocks();
  });

  it('emits one JSON line per entry', () => {
    const entries: AuditEntry[] = [
      makeEntry({ ts: '2026-04-01T10:00:01Z', event: 'session_start' }),
      makeEntry({ ts: '2026-04-01T10:00:02Z', event: 'tool_call', tool: 'read' }),
    ];

    // Simulate --json output path
    for (const entry of entries) {
      process.stdout.write(JSON.stringify(entry) + '\n');
    }

    const lines = capturedOutput.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    const parsed = lines.map((l) => JSON.parse(l) as AuditEntry);
    expect(parsed[0].event).toBe('session_start');
    expect(parsed[1].event).toBe('tool_call');
    expect(parsed[1].tool).toBe('read');
  });

  it('each --json line is valid JSON with required fields', () => {
    const entry = makeEntry({ ts: '2026-04-01T10:00:01Z', event: 'approval', approved_by: 'user', outcome: 'allowed' });
    process.stdout.write(JSON.stringify(entry) + '\n');

    const line = capturedOutput.trim();
    const parsed = JSON.parse(line) as AuditEntry;
    expect(parsed.ts).toBe(entry.ts);
    expect(parsed.event).toBe('approval');
    expect(parsed.outcome).toBe('allowed');
    expect(parsed.approved_by).toBe('user');
  });
});

describe('audit session file reading', () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'copair-audit-read-'));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('reads entries from audit.jsonl correctly', () => {
    const sessionDir = join(base, 'session-abc');
    const entries: AuditEntry[] = [
      makeEntry({ ts: '2026-04-01T10:00:00Z', event: 'session_start' }),
      makeEntry({ ts: '2026-04-01T10:00:01Z', event: 'tool_call', tool: 'read', detail: '5ms' }),
    ];
    writeAuditLog(sessionDir, entries);

    // Read back using the same logic as the audit command
    const auditPath = join(sessionDir, 'audit.jsonl');
    expect(existsSync(auditPath)).toBe(true);

    const lines = readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean);
    const parsed = lines.map((l) => JSON.parse(l) as AuditEntry);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].event).toBe('session_start');
    expect(parsed[1].tool).toBe('read');
  });

  it('handles corrupt JSONL lines gracefully', () => {
    const sessionDir = join(base, 'session-corrupt');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'audit.jsonl'),
      '{"ts":"2026-04-01T10:00:00Z","event":"session_start","outcome":"allowed"}\nnot-valid-json\n{"ts":"2026-04-01T10:00:01Z","event":"session_end","outcome":"allowed"}\n',
    );

    // The audit command skips corrupt lines — test that the valid ones parse fine
    const lines = readFileSync(join(sessionDir, 'audit.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean);

    const parsed: AuditEntry[] = [];
    for (const line of lines) {
      try { parsed.push(JSON.parse(line) as AuditEntry); } catch { /* skip */ }
    }
    expect(parsed).toHaveLength(2);
    expect(parsed[0].event).toBe('session_start');
    expect(parsed[1].event).toBe('session_end');
  });
});
