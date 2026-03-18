import chalk from 'chalk';

/**
 * Streaming markdown writer that renders:
 * - `inline code` → cyan bold
 * - ```code blocks``` → indented with grey border, white text
 * - Regular text → as-is
 *
 * Handles partial chunks safely by buffering incomplete tokens.
 */
export class MarkdownWriter {
  private buf = '';
  private inCodeBlock = false;
  private codeBlockLang = '';
  private codeBlockContent = '';

  /**
   * Process a streaming text chunk. Flushes complete markdown tokens
   * immediately and buffers incomplete ones.
   */
  write(chunk: string): void {
    this.buf += chunk;
    this.processBuffer();
  }

  /** Force-flush any remaining buffered text (call at end of stream). */
  flush(): void {
    if (this.inCodeBlock) {
      // Unclosed code block — render what we have
      this.emitCodeBlock(this.codeBlockContent);
      this.inCodeBlock = false;
      this.codeBlockContent = '';
      this.codeBlockLang = '';
    }
    if (this.buf) {
      process.stdout.write(this.buf);
      this.buf = '';
    }
  }

  private processBuffer(): void {
    while (this.buf.length > 0) {
      if (this.inCodeBlock) {
        const endIdx = this.buf.indexOf('```');
        if (endIdx === -1) {
          // No closing fence yet — accumulate everything
          this.codeBlockContent += this.buf;
          this.buf = '';
          return;
        }
        // Found closing fence
        this.codeBlockContent += this.buf.slice(0, endIdx);
        this.emitCodeBlock(this.codeBlockContent);
        this.inCodeBlock = false;
        this.codeBlockContent = '';
        this.codeBlockLang = '';
        this.buf = this.buf.slice(endIdx + 3);
        // Skip trailing newline after closing fence
        if (this.buf[0] === '\n') this.buf = this.buf.slice(1);
        continue;
      }

      // Check for code block opening (```)
      if (this.buf.startsWith('```')) {
        // Find end of the opening line (language tag)
        const newlineIdx = this.buf.indexOf('\n', 3);
        if (newlineIdx === -1) {
          // Incomplete opening — wait for more data
          return;
        }
        this.codeBlockLang = this.buf.slice(3, newlineIdx).trim();
        this.buf = this.buf.slice(newlineIdx + 1);
        this.inCodeBlock = true;
        this.codeBlockContent = '';
        continue;
      }

      // Could be start of ``` but we only have 1-2 backticks so far
      if (this.buf.length < 3 && this.buf[0] === '`' && !this.buf.includes('\n')) {
        // Wait for more data to disambiguate
        return;
      }

      // Check for inline code (single backtick, not ```)
      if (this.buf[0] === '`' && !this.buf.startsWith('```')) {
        const endIdx = this.buf.indexOf('`', 1);
        if (endIdx === -1) {
          // Incomplete inline code — check if buffer is big enough to flush as text
          if (this.buf.length > 200) {
            // Probably not inline code, just a stray backtick
            process.stdout.write(this.buf[0]);
            this.buf = this.buf.slice(1);
            continue;
          }
          // Wait for more data
          return;
        }
        // Complete inline code span
        const code = this.buf.slice(1, endIdx);
        process.stdout.write(chalk.cyan.bold(code));
        this.buf = this.buf.slice(endIdx + 1);
        continue;
      }

      // Regular text — emit everything up to the next backtick or end of buffer
      const nextBacktick = this.buf.indexOf('`');
      if (nextBacktick === -1) {
        process.stdout.write(this.buf);
        this.buf = '';
        return;
      }
      if (nextBacktick > 0) {
        process.stdout.write(this.buf.slice(0, nextBacktick));
        this.buf = this.buf.slice(nextBacktick);
        continue;
      }

      // Should not reach here, but safety
      process.stdout.write(this.buf[0]);
      this.buf = this.buf.slice(1);
    }
  }

  private emitCodeBlock(content: string): void {
    const lines = content.split('\n');
    // Remove trailing empty line if present
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    process.stdout.write('\n');
    for (const line of lines) {
      process.stdout.write(
        `  ${chalk.gray('│')} ${chalk.white(line)}\n`,
      );
    }
    process.stdout.write('\n');
  }
}
