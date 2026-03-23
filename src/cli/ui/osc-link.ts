/**
 * OSC 8 hyperlink support for terminals.
 *
 * Wraps text in OSC 8 escape sequences to make it clickable.
 * Falls back to plain text when the terminal doesn't support it.
 *
 * Format: \x1b]8;;URL\x07TEXT\x1b]8;;\x07
 */

const OSC_SUPPORTED_TERMS = new Set([
  'iTerm.app',
  'WezTerm',
  'Hyper',
  'Tabby',
  'foot',
]);

let oscSupported: boolean | null = null;

export function supportsOsc8(): boolean {
  if (oscSupported !== null) return oscSupported;
  if (!process.stdout.isTTY) {
    oscSupported = false;
    return false;
  }
  const termProgram = process.env.TERM_PROGRAM ?? '';
  // VS Code terminal supports OSC 8
  if (process.env.VSCODE_PID !== undefined) {
    oscSupported = true;
    return true;
  }
  oscSupported = OSC_SUPPORTED_TERMS.has(termProgram);
  return oscSupported;
}

/** Reset cache (for testing). */
export function resetOscCache(): void {
  oscSupported = null;
}

/**
 * Wrap text as a clickable file link using OSC 8.
 * Returns plain text if terminal doesn't support it.
 */
export function fileLink(filePath: string, displayText?: string): string {
  const text = displayText ?? filePath;
  if (!supportsOsc8()) return text;
  const url = `file://${filePath}`;
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}
