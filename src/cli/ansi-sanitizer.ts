/**
 * Terminal control sequence sanitization for LLM-generated text.
 *
 * Applied ONLY to raw text chunks from the model stream before they reach
 * the renderer. The renderer's own formatting (OSC 8 hyperlinks, SGR colors,
 * box-drawing) is produced after sanitization and is never stripped.
 *
 * Uses a denylist of known input-injection vectors rather than an allowlist
 * of safe sequences — an allowlist would break legitimate rendering (colors,
 * box-drawing characters).
 */

/**
 * Sequences to strip from agent output before writing to the terminal.
 * Focused on sequences that can write to the terminal's input buffer or
 * otherwise affect terminal state in ways that enable injection.
 */
const BLOCKED_PATTERNS: RegExp[] = [
  // Device Status Report / private mode set/reset (excludes bracketed paste handled below)
  /\x1b\[\?[\d;]*[hl]/g,
  // Bracketed paste mode enable/disable (explicit, caught above but listed for clarity)
  /\x1b\[\?2004[hl]/g,
  // Bracketed paste injection payload markers
  /\x1b\[200~/g,
  /\x1b\[201~/g,
  // OSC sequences (hyperlinks, title sets, any OSC payload)
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,
  // Application cursor keys / application keypad mode
  /\x1b[=>]/g,
  // DCS (Device Control String) sequences
  /\x1bP[^\x1b]*\x1b\\/g,
  // PM (Privacy Message) sequences
  /\x1b\^[^\x1b]*\x1b\\/g,
  // SS2 / SS3 single-shift sequences
  /\x1b[NO]/g,
];

/**
 * Strip terminal input-injection sequences from a raw LLM text chunk.
 * Safe display sequences (SGR colors, basic cursor movement) are preserved.
 */
export function sanitizeForTerminal(text: string): string {
  let result = text;
  for (const pattern of BLOCKED_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result;
}
