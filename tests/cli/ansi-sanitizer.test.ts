import { describe, it, expect } from 'vitest';
import { sanitizeForTerminal } from '../../src/cli/ansi-sanitizer.js';

describe('sanitizeForTerminal', () => {
  // ── Blocked sequences (injection vectors) ────────────────────────────────

  it('strips private mode set sequences (?[hl])', () => {
    expect(sanitizeForTerminal('\x1b[?1049h')).toBe('');
    expect(sanitizeForTerminal('\x1b[?25l')).toBe('');
    expect(sanitizeForTerminal('\x1b[?1h')).toBe('');
  });

  it('strips bracketed paste mode enable/disable', () => {
    expect(sanitizeForTerminal('\x1b[?2004h')).toBe('');
    expect(sanitizeForTerminal('\x1b[?2004l')).toBe('');
  });

  it('strips bracketed paste injection start marker', () => {
    expect(sanitizeForTerminal('\x1b[200~injected input\x1b[201~')).toBe('injected input');
  });

  it('strips OSC 8 hyperlink sequences', () => {
    const osc8 = '\x1b]8;;https://example.com\x1b\\click\x1b]8;;\x1b\\';
    expect(sanitizeForTerminal(osc8)).toBe('click');
  });

  it('strips OSC title set sequences', () => {
    expect(sanitizeForTerminal('\x1b]0;window title\x07rest')).toBe('rest');
  });

  it('strips application keypad mode sequences', () => {
    expect(sanitizeForTerminal('\x1b=')).toBe('');
    expect(sanitizeForTerminal('\x1b>')).toBe('');
  });

  it('strips DCS sequences', () => {
    expect(sanitizeForTerminal('\x1bPsome data\x1b\\')).toBe('');
  });

  it('strips PM (Privacy Message) sequences', () => {
    expect(sanitizeForTerminal('\x1b^private\x1b\\')).toBe('');
  });

  it('strips SS2 and SS3 single-shift sequences', () => {
    expect(sanitizeForTerminal('\x1bN')).toBe('');
    expect(sanitizeForTerminal('\x1bO')).toBe('');
  });

  // ── Preserved sequences (safe display) ───────────────────────────────────

  it('preserves SGR reset sequence', () => {
    expect(sanitizeForTerminal('\x1b[0m')).toBe('\x1b[0m');
  });

  it('preserves SGR color codes', () => {
    expect(sanitizeForTerminal('\x1b[32m')).toBe('\x1b[32m');
    expect(sanitizeForTerminal('\x1b[1;33m')).toBe('\x1b[1;33m');
    expect(sanitizeForTerminal('\x1b[38;5;196m')).toBe('\x1b[38;5;196m');
  });

  it('preserves cursor movement sequences', () => {
    expect(sanitizeForTerminal('\x1b[A')).toBe('\x1b[A');   // cursor up
    expect(sanitizeForTerminal('\x1b[2J')).toBe('\x1b[2J'); // clear screen
    expect(sanitizeForTerminal('\x1b[H')).toBe('\x1b[H');   // cursor home
  });

  // ── Plain text ────────────────────────────────────────────────────────────

  it('passes plain text through unchanged', () => {
    expect(sanitizeForTerminal('hello world')).toBe('hello world');
  });

  it('passes empty string through unchanged', () => {
    expect(sanitizeForTerminal('')).toBe('');
  });

  // ── Mixed content ─────────────────────────────────────────────────────────

  it('strips injection sequences but preserves surrounding safe content', () => {
    const input = '\x1b[32mgreen text\x1b[?2004h injected\x1b[0m';
    const result = sanitizeForTerminal(input);
    expect(result).toContain('\x1b[32m');
    expect(result).toContain('green text');
    expect(result).toContain('\x1b[0m');
    expect(result).not.toContain('\x1b[?2004h');
  });

  it('removes bracketed paste attack vector: inject y to bypass approval', () => {
    // Attacker tries to inject "\x1b[200~y\n\x1b[201~" to simulate pressing y
    const attack = 'Allow? \x1b[200~y\n\x1b[201~ done';
    const result = sanitizeForTerminal(attack);
    expect(result).toBe('Allow? y\n done');
    // The markers are gone but the raw "y\n" remains — that's acceptable since
    // we read approvals from /dev/tty, not from the rendered output.
  });
});
