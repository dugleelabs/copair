/**
 * Word boundary utilities and input classification helpers for the input field.
 *
 * Word boundary = space/non-space transition, matching bash readline behaviour.
 * All operations use codepoint-safe array spread to handle multi-byte Unicode
 * characters (emoji, CJK, etc.) correctly.
 *
 * The detection helpers (`detectWordNav`, `detectWordDeletion`, `isPasteInput`)
 * encode the escape-sequence / modifier logic in a pure, testable form so tests
 * do not require ink rendering.
 */

// ── Ink key shape (subset used for detection) ────────────────────────────────

export interface InputKey {
  ctrl: boolean;
  meta: boolean;
  backspace: boolean;
}

// ── Escape-sequence detection helpers ────────────────────────────────────────

export type WordNavDirection = 'word-left' | 'word-right' | null;

/**
 * Return the word-navigation direction triggered by a raw input sequence,
 * or null if the input is not a word-navigation key.
 *
 * Handles all three platform families:
 *   - \x1b[1;3D / \x1b[1;3C  (iTerm2, Windows Terminal, xterm)
 *   - \x1bb / \x1bf           (macOS Terminal.app — ESC+b / ESC+f)
 *   - \x1b[1;5D / \x1b[1;5C  (Ctrl+Arrow, universal, Windows primary)
 */
export function detectWordNav(input: string): WordNavDirection {
  if (input === '\x1b[1;3D' || input === '\x1bb' || input === '\x1b[1;5D') return 'word-left';
  if (input === '\x1b[1;3C' || input === '\x1bf' || input === '\x1b[1;5C') return 'word-right';
  return null;
}

/**
 * Return true if the input sequence is a word-deletion key.
 *
 * Covers:
 *   - Alt+Backspace: raw \x1b\x7f OR key.meta + key.backspace (ink normalisation)
 *   - Ctrl+W:        key.ctrl + input === 'w'  (ink normalises ctrl+key to letter name)
 */
export function detectWordDeletion(input: string, key: InputKey): boolean {
  const isAltBackspace = (key.meta && key.backspace) || input === '\x1b\x7f';
  const isCtrlW = key.ctrl && input === 'w';
  return isAltBackspace || isCtrlW;
}

/**
 * Return true if the input should be treated as a multiline paste.
 *
 * Pasted content arrives as a single input string containing line breaks.
 * macOS terminals send `\r` (not `\n`) for newlines in raw mode, so we
 * check for both.  Terminals with bracketed paste mode wrap the content
 * in `\x1b[200~`…`\x1b[201~`; ink strips the leading `\x1b`, leaving
 * `[200~` as a reliable prefix.
 *
 * Ctrl / Meta prefixed inputs are excluded so that Ctrl+J (line-feed
 * control) is never misidentified as a paste.
 */
export function isPasteInput(input: string, key: InputKey): boolean {
  if (key.ctrl || key.meta) return false;
  // Bracketed pastanale marker (leading \x1b already stripped by ink)
  if (input.startsWith('[200~')) return true;
  // Multi-character input with line breaks (\n or \r)
  return input.length > 1 && /[\n\r]/.test(input);
}

/**
 * Normalize raw pasted content for storage:
 *   - Strip bracketed paste markers (\x1b[200~ / \x1b[201~)
 *   - Normalize line endings: \r\n → \n, lone \r → \n
 */
export function cleanPastedInput(input: string): string {
  return input
    .replace(/^\[200~/, '')        // leading marker (ink already stripped \x1b)
    .replace(new RegExp(String.fromCharCode(0x1b) + '\\[201~$'), '')  // trailing marker
    .replace(/\r\n/g, '\n')        // CRLF → LF
    .replace(/\r/g, '\n');         // lone CR → LF
}

// ── Word boundary functions ────────────────────────────────────────────────

/**
 * Return the cursor position at the start of the word immediately left of `pos`.
 * Skips any trailing whitespace, then the preceding word characters.
 */
export function wordBoundaryLeft(value: string, pos: number): number {
  const chars = [...value];
  let i = pos;
  while (i > 0 && chars[i - 1] === ' ') i--;  // skip trailing spaces
  while (i > 0 && chars[i - 1] !== ' ') i--;  // skip word chars
  return i;
}

/**
 * Return the cursor position at the start of the next word right of `pos`.
 * Skips any leading whitespace, then the current word characters.
 */
export function wordBoundaryRight(value: string, pos: number): number {
  const chars = [...value];
  let i = pos;
  while (i < chars.length && chars[i] === ' ') i++;  // skip leading spaces
  while (i < chars.length && chars[i] !== ' ') i++;  // skip word chars
  return i;
}
