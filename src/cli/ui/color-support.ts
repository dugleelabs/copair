/**
 * Color support detection for terminal rendering.
 *
 * Levels:
 *   0 = no color (piped, dumb terminal)
 *   1 = basic 16 colors
 *   2 = 256 colors
 *   3 = truecolor (16M colors)
 */
export type ColorLevel = 0 | 1 | 2 | 3;

let cachedLevel: ColorLevel | null = null;

export function getColorLevel(): ColorLevel {
  if (cachedLevel !== null) return cachedLevel;
  cachedLevel = detectColorLevel();
  return cachedLevel;
}

/** Reset cache (for testing). */
export function resetColorCache(): void {
  cachedLevel = null;
}

function detectColorLevel(): ColorLevel {
  // Non-TTY (piped output) — no color
  if (!process.stdout.isTTY) return 0;

  // Explicit override
  const forceColor = process.env.FORCE_COLOR;
  if (forceColor === '0' || forceColor === 'false') return 0;
  if (forceColor === '1') return 1;
  if (forceColor === '2') return 2;
  if (forceColor === '3' || forceColor === 'true') return 3;

  // NO_COLOR standard (https://no-color.org/)
  if (process.env.NO_COLOR !== undefined) return 0;

  const term = process.env.TERM ?? '';

  // Dumb terminal
  if (term === 'dumb') return 0;

  // Truecolor detection
  const colorterm = process.env.COLORTERM ?? '';
  if (colorterm === 'truecolor' || colorterm === '24bit') return 3;

  // Common truecolor terminals
  const termProgram = process.env.TERM_PROGRAM ?? '';
  if (termProgram === 'iTerm.app' || termProgram === 'Hyper') return 3;

  // VS Code terminal
  if (process.env.VSCODE_PID !== undefined) return 3;

  // 256-color detection
  if (term.endsWith('-256color') || term === 'xterm-256color') return 2;

  // Basic color support
  if (term.startsWith('xterm') || term.startsWith('screen') || term === 'linux') return 1;

  // Fallback — assume basic color if TTY
  return 1;
}

/** Whether shiki syntax highlighting should be used at this color level. */
export function shouldUseSyntaxHighlighting(level?: ColorLevel): boolean {
  return (level ?? getColorLevel()) >= 2;
}
