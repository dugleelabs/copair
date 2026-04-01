/**
 * `copair audit` — view the session audit log.
 *
 * Usage:
 *   copair audit                      # most recent session
 *   copair audit --session <id>       # specific session by ID prefix or full ID
 *   copair audit --last <n>           # last N entries across all sessions
 *   copair audit --json               # raw JSONL output (any of the above)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { resolveSessionsDir } from '../../core/session.js';
import type { AuditEntry } from '../../core/audit-log.js';

// ── ANSI helpers (no chalk dep — keeps output stable in pipes) ───────────────

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function color(text: string, c: string): string {
  if (!process.stdout.isTTY) return text;
  return `${c}${text}${RESET}`;
}

// ── Entry reading ─────────────────────────────────────────────────────────────

function readAuditEntries(auditPath: string): AuditEntry[] {
  if (!existsSync(auditPath)) return [];
  try {
    return readFileSync(auditPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditEntry);
  } catch {
    return [];
  }
}

function resolveSessionDir(sessionsDir: string, sessionId: string): string | null {
  if (!existsSync(sessionsDir)) return null;
  const dirs = readdirSync(sessionsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const match = dirs.find((d) => d === sessionId || d.startsWith(sessionId));
  return match ? join(sessionsDir, match) : null;
}

function mostRecentSessionDir(sessionsDir: string): string | null {
  if (!existsSync(sessionsDir)) return null;
  const dirs = readdirSync(sessionsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, mtime: statSync(join(sessionsDir, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return dirs[0] ? join(sessionsDir, dirs[0].name) : null;
}

function allSessionEntries(sessionsDir: string): AuditEntry[] {
  if (!existsSync(sessionsDir)) return [];
  return readdirSync(sessionsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => readAuditEntries(join(sessionsDir, e.name, 'audit.jsonl')));
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatTime(isoTs: string): string {
  try {
    const d = new Date(isoTs);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoTs.slice(11, 19);
  }
}

function outcomeColor(outcome: string): string {
  if (outcome === 'allowed') return color(outcome, GREEN);
  if (outcome === 'denied') return color(outcome, RED);
  return color(outcome, YELLOW);
}

function eventColor(event: string): string {
  if (event === 'denial' || event === 'path_block' || event === 'schema_rejection') return color(event, RED);
  if (event === 'approval') return color(event, GREEN);
  if (event === 'session_start' || event === 'session_end') return color(event, CYAN);
  return event;
}

const COL_WIDTHS = { time: 8, event: 18, tool: 12, outcome: 8 };

function formatHeader(): string {
  return color(
    [
      'TIME    ',
      'EVENT             ',
      'TOOL        ',
      'OUTCOME ',
      'DETAIL',
    ].join('  '),
    DIM,
  );
}

function formatEntry(entry: AuditEntry): string {
  const time = formatTime(entry.ts).padEnd(COL_WIDTHS.time);
  const event = eventColor(entry.event).padEnd(
    COL_WIDTHS.event + (entry.event !== entry.event ? 0 : 0), // raw length for padding
  );
  // Pad accounting for invisible ANSI chars
  const eventRaw = entry.event.padEnd(COL_WIDTHS.event);
  const eventDisplay = eventColor(entry.event) + ' '.repeat(Math.max(0, COL_WIDTHS.event - entry.event.length));
  const tool = (entry.tool ?? '').padEnd(COL_WIDTHS.tool);
  const outcomeRaw = entry.outcome ?? '';
  const outcomeDisplay = outcomeColor(outcomeRaw) + ' '.repeat(Math.max(0, COL_WIDTHS.outcome - outcomeRaw.length));
  const detail = entry.detail ?? entry.approved_by ?? entry.input_summary ?? '';

  void event; void eventRaw; // suppress unused warning

  return [time, eventDisplay, tool, outcomeDisplay, detail].join('  ');
}

function printEntries(entries: AuditEntry[], asJson: boolean): void {
  if (asJson) {
    for (const entry of entries) {
      process.stdout.write(JSON.stringify(entry) + '\n');
    }
    return;
  }

  console.log(formatHeader());
  console.log(color('─'.repeat(72), DIM));
  for (const entry of entries) {
    console.log(formatEntry(entry));
  }
}

// ── Command ───────────────────────────────────────────────────────────────────

export async function runAuditCommand(argv: string[]): Promise<void> {
  const cmd = new Command('audit')
    .description('View session audit log')
    .option('--session <id>', 'Session ID (full or prefix) to display')
    .option('--last <n>', 'Show last N entries across all sessions', (v) => parseInt(v, 10))
    .option('--json', 'Output raw JSONL')
    .exitOverride(); // throw instead of process.exit so tests can catch

  cmd.parse(['node', 'audit', ...argv]);
  const opts = cmd.opts<{ session?: string; last?: number; json?: boolean }>();

  const cwd = process.cwd();
  const sessionsDir = resolveSessionsDir(cwd);

  // ── --last N: aggregate across all sessions ──────────────────────────────
  if (opts.last != null) {
    const all = allSessionEntries(sessionsDir)
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    const entries = all.slice(-opts.last);
    printEntries(entries, !!opts.json);
    return;
  }

  // ── --session <id> ────────────────────────────────────────────────────────
  let sessionDir: string | null;
  if (opts.session) {
    sessionDir = resolveSessionDir(sessionsDir, opts.session);
    if (!sessionDir) {
      process.stderr.write(`audit: session "${opts.session}" not found\n`);
      process.exit(1);
    }
  } else {
    // No args: most recent session
    sessionDir = mostRecentSessionDir(sessionsDir);
    if (!sessionDir) {
      process.stderr.write('audit: no sessions found\n');
      process.exit(1);
    }
  }

  const entries = readAuditEntries(join(sessionDir, 'audit.jsonl'));
  if (entries.length === 0 && !existsSync(join(sessionDir, 'audit.jsonl'))) {
    process.stderr.write('audit: session found but no audit log exists yet\n');
    process.exit(1);
  }

  printEntries(entries, !!opts.json);
}
