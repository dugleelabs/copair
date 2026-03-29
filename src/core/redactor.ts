/**
 * Centralized secret redaction.
 *
 * All consumers (logger, session writer, tool-result pipeline) import from
 * this module so that pattern coverage is always consistent.
 *
 * ORDERING NOTE: sk-ant- must appear before sk- so Anthropic keys receive
 * the correct [REDACTED:anthropic] label rather than [REDACTED:openai].
 */

interface SecretPattern {
  pattern: RegExp;
  replacement: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g,      replacement: '[REDACTED:anthropic]' },
  { pattern: /sk-[a-zA-Z0-9_-]{20,}/g,           replacement: '[REDACTED:openai]' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g,             replacement: '[REDACTED:github]' },
  { pattern: /github_pat_[a-zA-Z0-9_]{82}/g,     replacement: '[REDACTED:github-pat]' },
  { pattern: /AKIA[A-Z0-9]{16}/g,                replacement: '[REDACTED:aws]' },
  { pattern: /lin_api_[a-zA-Z0-9_-]+/g,          replacement: '[REDACTED:linear]' },
  { pattern: /AIza[a-zA-Z0-9_-]{35}/g,           replacement: '[REDACTED:google]' },
  { pattern: /Bearer\s+[a-zA-Z0-9._-]+/g,        replacement: 'Bearer [REDACTED]' },
];

/**
 * Matches base64-like strings ≥ 40 chars. Used only when highEntropy is true.
 * Strings are only redacted if they look like real secrets (mixed case + digit).
 */
export const HIGH_ENTROPY_PATTERN = /[a-zA-Z0-9+/]{40,}={0,2}/g;

function looksLikeSecret(s: string): boolean {
  return /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s);
}

/**
 * Redact known secret patterns from a string.
 *
 * @param text        The string to redact.
 * @param opts.highEntropy  When true, also redact high-entropy base64-like strings
 *                          that match the heuristic. Off by default — opt-in only.
 */
export function redact(text: string, opts?: { highEntropy?: boolean }): string {
  let result = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  if (opts?.highEntropy) {
    result = result.replace(HIGH_ENTROPY_PATTERN, (match) =>
      looksLikeSecret(match) ? '[HIGH-ENTROPY-REDACTED]' : match,
    );
  }
  return result;
}
