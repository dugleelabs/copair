/**
 * HTTP-level request/response logging for copair providers.
 *
 * Enable with:   COPAIR_HTTP_DEBUG=1 copair
 *
 * Writes to both stderr (real-time) and request-dump.log (for later inspection).
 * The log file is truncated at startup so each session starts fresh.
 */
import { appendFileSync, writeFileSync } from 'node:fs';

const LOG_FILE = 'request-dump.log';

export const HTTP_DEBUG = process.env['COPAIR_HTTP_DEBUG'] === '1';

// Truncate log file at module load so each run starts clean.
if (HTTP_DEBUG) {
  try {
    writeFileSync(LOG_FILE, `[copair-debug] session started ${new Date().toISOString()}\n${'─'.repeat(80)}\n`);
  } catch {
    // cwd may not be writable — skip
  }
}

function write(entry: string): void {
  process.stderr.write(entry);
  try { appendFileSync(LOG_FILE, entry); } catch { /* ignore */ }
}

export function debugRequest(provider: string, payload: unknown): void {
  if (!HTTP_DEBUG) return;
  write(`\n[copair-debug] ▶ ${provider} request:\n${JSON.stringify(payload, null, 2)}\n${'─'.repeat(80)}\n`);
}

export function debugResponse(provider: string, response: unknown): void {
  if (!HTTP_DEBUG) return;
  write(`\n[copair-debug] ◀ ${provider} response:\n${JSON.stringify(response, null, 2)}\n${'─'.repeat(80)}\n`);
}

export function debugError(provider: string, error: unknown): void {
  if (!HTTP_DEBUG) return;
  const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  write(`\n[copair-debug] ✗ ${provider} error: ${msg}\n${'─'.repeat(80)}\n`);
}
