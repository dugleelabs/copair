/**
 * spec 029 (F-15b): head+tail truncation with a marker. Used **only by bash.ts**
 * — `read.ts` and `grep.ts` have their own overflow strategies that don't lie
 * about what the model received. Silent middle truncation only makes sense for
 * unbounded shell output paired with a recovery hint.
 */

const APPROX_CHARS_PER_TOKEN = 4;
const HEAD_TAIL_RATIO = 0.6; // 60 % head / 40 % tail when truncating

/**
 * Head+tail truncation with a `[... N lines truncated ...]` marker. Returns
 * the input unchanged when it's already under the char budget so callers can
 * `if (truncated === text)` to detect whether truncation fired.
 *
 * @param text       the unbounded source string (e.g. stdout from execSync)
 * @param maxTokens  approximate token budget; the byte cap is `maxTokens * 4`
 */
export function truncateMiddle(text: string, maxTokens: number): string {
  const maxChars = maxTokens * APPROX_CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;

  const lines = text.split('\n');
  if (lines.length < 4) {
    // Too few lines to head+tail meaningfully — fall back to char-slice.
    const headChars = Math.floor(maxChars * HEAD_TAIL_RATIO);
    const tailChars = Math.max(0, maxChars - headChars - 80);
    const truncatedChars = text.length - headChars - tailChars;
    return (
      text.slice(0, headChars) +
      `\n[... ${truncatedChars} chars truncated ...]\n` +
      text.slice(-tailChars)
    );
  }

  // Line-based head + tail.
  const targetHeadLines = Math.max(1, Math.floor(lines.length * HEAD_TAIL_RATIO));
  let headLines = targetHeadLines;
  let head = lines.slice(0, headLines).join('\n');
  let tailStartIdx = lines.length - Math.max(1, Math.floor((lines.length - headLines) / 2));
  let tail = lines.slice(tailStartIdx).join('\n');

  // Trim alternately from head and tail until under budget.
  while (
    head.length + tail.length > maxChars - 80 &&
    (headLines > 1 || tailStartIdx < lines.length - 1)
  ) {
    if (head.length > tail.length && headLines > 1) {
      headLines--;
      head = lines.slice(0, headLines).join('\n');
    } else if (tailStartIdx < lines.length - 1) {
      tailStartIdx++;
      tail = lines.slice(tailStartIdx).join('\n');
    } else if (headLines > 1) {
      headLines--;
      head = lines.slice(0, headLines).join('\n');
    } else {
      break;
    }
  }

  const shownLines = headLines + (lines.length - tailStartIdx);
  const truncatedLines = lines.length - shownLines;
  return `${head}\n[... ${truncatedLines} lines truncated ...]\n${tail}`;
}
