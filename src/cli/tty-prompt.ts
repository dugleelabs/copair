/**
 * /dev/tty-based prompt reader for approval gates.
 *
 * Reads directly from /dev/tty rather than process.stdin, preventing
 * prompt injection attacks that attempt to pre-load keystrokes via stdin
 * redirection or terminal escape sequences that write to the input buffer.
 *
 * SYNC I/O NOTE: readFromTty() intentionally blocks the Node.js event loop.
 * For security-gated decisions this is correct — the prompt must fully pause
 * any in-progress stream before accepting input so there is no race between
 * streaming output and the user's response. Do NOT make this async.
 */

import { openSync, readSync, closeSync } from 'node:fs';

/**
 * Read a single line from /dev/tty directly, bypassing process.stdin.
 * Returns null if /dev/tty cannot be opened (CI / non-interactive environments).
 * Callers must treat null as CI mode and apply the deny/default-no policy.
 */
export function readFromTty(): string | null {
  let fd: number;
  try {
    fd = openSync('/dev/tty', 'r');
  } catch {
    return null;
  }

  try {
    const chunks: Buffer[] = [];
    const buf = Buffer.alloc(256);
    while (true) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      const chunk = buf.subarray(0, n);
      chunks.push(Buffer.from(chunk));
      if (chunk.includes(0x0a)) break; // newline
    }
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  } finally {
    closeSync(fd);
  }
}

/**
 * Write a prompt to stderr and return the user's response from /dev/tty.
 * Returns null if TTY is unavailable — callers must treat this as deny.
 */
export function ttyPrompt(message: string): string | null {
  process.stderr.write(message);
  return readFromTty();
}
