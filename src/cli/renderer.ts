import chalk from 'chalk';
import { Spinner } from './spinner.js';
import { MarkdownWriter } from './markdown.js';
import type { StreamChunk } from '../providers/interface.js';
import type { AgentBridge } from './ui/agent-bridge.js';

/**
 * Build a human-readable one-liner for a tool call, e.g.:
 *   git status
 *   bash: npm test
 *   read: src/index.ts
 */
export function formatToolCall(name: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    let raw: string;
    switch (name) {
      case 'git':
        raw = `git ${args.args ?? ''}`.trim();
        break;
      case 'bash':
        raw = `bash: ${args.command ?? ''}`;
        break;
      case 'read':
        raw = `read: ${args.file_path ?? args.path ?? ''}`;
        break;
      case 'write':
        raw = `write: ${args.file_path ?? args.path ?? ''}`;
        break;
      case 'edit':
        raw = `edit: ${args.file_path ?? args.path ?? ''}`;
        break;
      case 'glob':
        raw = `glob: ${args.pattern ?? ''}`;
        break;
      case 'grep':
        raw = `grep: ${args.pattern ?? ''}`;
        break;
      default:
        raw = name;
        break;
    }
    return oneLine(raw);
  } catch {
    return name;
  }
}

/** Collapse multi-line strings into a single truncated line for display. */
function oneLine(s: string, maxLen = 80): string {
  // Replace newlines with spaces, collapse whitespace
  const flat = s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (flat.length <= maxLen) return flat;
  return flat.slice(0, maxLen - 1) + '\u2026';
}

export function formatToolCallFromInput(name: string, input: Record<string, unknown>): string {
  return formatToolCall(name, JSON.stringify(input));
}

export class Renderer {
  private currentToolName: string | null = null;
  private pendingDeltaLine = false;
  private thinkingSpinner: Spinner | null = null;
  private deltaSpinner: Spinner | null = null;
  private mdWriter: MarkdownWriter | null = null;
  private bridge: AgentBridge | null;

  /** When bridge is set, suppress direct terminal writes (ink handles display). */
  private get inkMode(): boolean {
    return this.bridge !== null;
  }

  constructor(bridge?: AgentBridge) {
    this.bridge = bridge ?? null;
  }

  async render(
    stream: AsyncIterableIterator<StreamChunk>,
    textFilter?: (text: string) => string,
  ): Promise<{
    toolCalls: Array<{ id: string; name: string; arguments: string; metadata?: Record<string, unknown> }>;
    usage: { inputTokens: number; outputTokens: number } | null;
    fullText: string;
  }> {
    const toolCalls: Array<{ id: string; name: string; arguments: string; metadata?: Record<string, unknown> }> = [];
    let usage: { inputTokens: number; outputTokens: number } | null = null;
    let fullText = '';

    // Markdown-aware text writer for styled inline code and code blocks
    if (!this.inkMode) {
      this.mdWriter = new MarkdownWriter();

      // Start the "thinking" spinner — visible until the first content chunk
      this.thinkingSpinner = new Spinner(chalk.dim('thinking...'), chalk.magenta);
      this.thinkingSpinner.start();
    }
    this.bridge?.emit('thinking-start');

    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'text': {
          this.stopThinkingSpinner();
          if (this.deltaSpinner) {
            this.deltaSpinner.stop();
            this.deltaSpinner = null;
          }
          if (this.currentToolName) {
            this.endToolIndicator();
          }
          const raw = chunk.text ?? '';
          const display = textFilter ? textFilter(raw) : raw;
          if (display && this.mdWriter) this.mdWriter.write(display);
          fullText += raw; // raw kept for parser

          // Emit to bridge for ink UI
          if (display) this.bridge?.emit('stream-text', display);
          break;
        }

        case 'tool_call_delta':
          this.stopThinkingSpinner();
          if (!this.inkMode && chunk.toolCall && chunk.toolCall.name !== this.currentToolName) {
            if (this.deltaSpinner) {
              this.deltaSpinner.stop();
              this.deltaSpinner = null;
            }
            if (this.currentToolName) this.endToolIndicator();
            this.currentToolName = chunk.toolCall.name;
            process.stderr.write('\n');
            this.deltaSpinner = new Spinner(
              chalk.gray(chunk.toolCall.name + '...'),
              chalk.green,
            );
            this.deltaSpinner.start();
            this.pendingDeltaLine = true;
          }
          break;

        case 'tool_call':
          this.stopThinkingSpinner();
          if (chunk.toolCall) {
            if (this.deltaSpinner) {
              this.deltaSpinner.stop();
              this.deltaSpinner = null;
              this.pendingDeltaLine = false;
            } else if (this.currentToolName) {
              this.endToolIndicator();
            }
            toolCalls.push(chunk.toolCall);
            const label = formatToolCall(chunk.toolCall.name, chunk.toolCall.arguments ?? '{}');

            if (!this.inkMode) {
              process.stderr.write(`  ${chalk.green('\u25CF')} ${chalk.white(label)}\n`);
            }

            // Emit to bridge
            const input = JSON.parse(chunk.toolCall.arguments || '{}') as Record<string, unknown>;
            this.bridge?.emit('tool-start', {
              name: chunk.toolCall.name,
              label,
              input,
            });

            this.currentToolName = null;
          }
          break;

        case 'usage':
          if (chunk.usage) {
            usage = chunk.usage;
          }
          break;

        case 'error':
          this.stopThinkingSpinner();
          if (!this.inkMode) {
            process.stderr.write(chalk.red(`\nError: ${chunk.error}\n`));
          }
          this.bridge?.emit('error', chunk.error ?? 'Unknown error');
          break;

        case 'done':
          this.stopThinkingSpinner();
          if (this.deltaSpinner) {
            this.deltaSpinner.stop();
            this.deltaSpinner = null;
          }
          if (this.currentToolName) this.endToolIndicator();
          break;
      }
    }

    // Flush any remaining markdown buffer and add trailing newline
    if (this.mdWriter) {
      this.mdWriter.flush();
      this.mdWriter = null;
      process.stdout.write('\n');
    }

    return { toolCalls, usage, fullText };
  }

  /**
   * Start an animated spinner for tool execution (green braille dots).
   * Returns the Spinner instance so the caller can stop it.
   * In ink mode, returns a no-op spinner.
   */
  startToolSpinner(label: string): Spinner {
    if (this.inkMode) {
      // Return a no-op spinner — ink handles the display
      return { start() {}, stop() {} } as Spinner;
    }
    const spinner = new Spinner(chalk.white(label), chalk.green);
    spinner.start();
    return spinner;
  }

  /**
   * Replace the spinner with a completed indicator (dark grey + runtime).
   */
  completeToolExecution(label: string, durationMs: number): void {
    if (!this.inkMode) {
      const dur = formatDuration(durationMs);
      process.stderr.write(
        `  ${chalk.gray('\u2713')} ${chalk.gray(label)} ${chalk.gray.dim(`(${dur})`)}\n`,
      );
    }
    this.bridge?.emit('tool-complete', { name: '', label, durationMs });
  }

  /**
   * Replace the spinner with a denied marker (red ✗).
   */
  deniedToolExecution(label: string): void {
    if (!this.inkMode) {
      process.stderr.write(
        `  ${chalk.red('\u2717')} ${chalk.red(label)} ${chalk.red.dim('denied')}\n`,
      );
    }
    this.bridge?.emit('tool-denied', { name: '', label });
  }

  /**
   * Render git diff output with proper diff coloring.
   * Lines starting with + → green bg, - → red bg, @@ → cyan, etc.
   */
  showGitDiff(output: string): void {
    if (!output.trim()) return;

    if (!this.inkMode) {
      const maxLines = 80;
      const lines = output.split('\n');
      const display = lines.slice(0, maxLines);

      process.stderr.write('\n');
      for (const line of display) {
        if (line.startsWith('+++') || line.startsWith('---')) {
          process.stderr.write(chalk.bold.white(line) + '\n');
        } else if (line.startsWith('+')) {
          process.stderr.write(chalk.bgGreen.black(line) + '\n');
        } else if (line.startsWith('-')) {
          process.stderr.write(chalk.bgRedBright.black(line) + '\n');
        } else if (line.startsWith('@@')) {
          process.stderr.write(chalk.cyan(line) + '\n');
        } else if (line.startsWith('diff ')) {
          process.stderr.write(chalk.bold.yellow(line) + '\n');
        } else if (line.startsWith('index ')) {
          process.stderr.write(chalk.gray(line) + '\n');
        } else {
          process.stderr.write(chalk.gray(line) + '\n');
        }
      }
      if (lines.length > maxLines) {
        process.stderr.write(chalk.gray(`  ... ${lines.length - maxLines} more lines\n`));
      }
      process.stderr.write('\n');
    }

    // Emit to bridge for ink UI
    if (this.bridge) {
      const lines = output.split('\n');
      this.bridge.emit('diff', {
        filePath: extractDiffFilePath(lines),
        hunks: [{ oldStart: 0, newStart: 0, lines }],
      });
    }
  }

  /**
   * Show a diff snippet for file mutations (write/edit).
   *
   * For edit: shows removed lines (old_string) in red and added lines (new_string) in green.
   * For write: shows all content as added lines.
   */
  showDiff(
    filePath: string,
    oldContent: string | null,
    newContent: string,
  ): void {
    if (!this.inkMode) {
      const maxLines = 30;
      process.stderr.write(chalk.gray(`  \u2500\u2500 ${filePath} \u2500\u2500\n`));

      if (oldContent === null) {
        const lines = newContent.split('\n');
        const display = lines.slice(0, maxLines);
        for (const line of display) {
          process.stderr.write(chalk.bgGreen.black(` + ${line}`) + '\n');
        }
        if (lines.length > maxLines) {
          process.stderr.write(chalk.gray(`  ... ${lines.length - maxLines} more lines\n`));
        }
      } else {
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');

        let shown = 0;
        for (const line of oldLines) {
          if (shown >= maxLines) break;
          process.stderr.write(chalk.bgRedBright.black(` - ${line}`) + '\n');
          shown++;
        }
        for (const line of newLines) {
          if (shown >= maxLines) break;
          process.stderr.write(chalk.bgGreen.black(` + ${line}`) + '\n');
          shown++;
        }
        const total = oldLines.length + newLines.length;
        if (total > maxLines) {
          process.stderr.write(chalk.gray(`  ... ${total - maxLines} more lines\n`));
        }
      }

      process.stderr.write('\n');
    }

    // Emit structured diff to bridge
    if (this.bridge) {
      const hunks = [];
      if (oldContent !== null) {
        hunks.push({
          oldStart: 1,
          newStart: 1,
          lines: [
            ...oldContent.split('\n').map((l) => `-${l}`),
            ...newContent.split('\n').map((l) => `+${l}`),
          ],
        });
      } else {
        hunks.push({
          oldStart: 0,
          newStart: 1,
          lines: newContent.split('\n').map((l) => `+${l}`),
        });
      }
      this.bridge.emit('diff', { filePath, hunks });
    }
  }

  showTokenUsage(
    requestUsage: { inputTokens: number; outputTokens: number },
    sessionUsage: { totalInput: number; totalOutput: number; totalCost: number },
  ): void {
    if (!this.inkMode) {
      const line = chalk.gray(
        `[tokens: ${requestUsage.inputTokens.toLocaleString()} in / ${requestUsage.outputTokens.toLocaleString()} out` +
          ` | session: ${sessionUsage.totalInput.toLocaleString()} in / ${sessionUsage.totalOutput.toLocaleString()} out` +
          ` | ~$${sessionUsage.totalCost.toFixed(2)}]`,
      );
      console.log(line);
    }

    // Emit usage to bridge
    this.bridge?.emit('usage', {
      inputTokens: requestUsage.inputTokens,
      outputTokens: requestUsage.outputTokens,
      cost: 0,
      sessionInputTokens: sessionUsage.totalInput,
      sessionOutputTokens: sessionUsage.totalOutput,
      sessionCost: sessionUsage.totalCost,
    });
  }

  showSessionSummary(
    byModel: Map<string, { input: number; output: number; cost: number }>,
    totals: { totalInput: number; totalOutput: number; totalCost: number },
  ): void {
    if (this.inkMode) return; // ink StatusBar handles this
    console.log(chalk.bold('\nSession Summary'));
    console.log(
      chalk.gray(
        '  Model'.padEnd(25) +
          'Input'.padStart(10) +
          'Output'.padStart(10) +
          'Cost'.padStart(10),
      ),
    );

    for (const [model, usage] of byModel) {
      console.log(
        `  ${model.padEnd(23)}` +
          `${usage.input.toLocaleString().padStart(10)}` +
          `${usage.output.toLocaleString().padStart(10)}` +
          `$${usage.cost.toFixed(2).padStart(9)}`,
      );
    }

    console.log(
      chalk.bold(
        `  ${'Total'.padEnd(23)}` +
          `${totals.totalInput.toLocaleString().padStart(10)}` +
          `${totals.totalOutput.toLocaleString().padStart(10)}` +
          `$${totals.totalCost.toFixed(2).padStart(9)}`,
      ),
    );
  }

  private stopThinkingSpinner(): void {
    if (this.thinkingSpinner) {
      this.thinkingSpinner.stop();
      this.thinkingSpinner = null;
      this.bridge?.emit('thinking-stop');
    }
  }

  private endToolIndicator(): void {
    if (this.pendingDeltaLine) {
      if (this.deltaSpinner) {
        this.deltaSpinner.stop();
        this.deltaSpinner = null;
      }
      this.pendingDeltaLine = false;
    }
    this.currentToolName = null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Extract the file path from a unified diff header, e.g. "diff --git a/foo b/foo" → "foo". */
function extractDiffFilePath(lines: string[]): string {
  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      const match = line.match(/b\/(.+)$/);
      if (match) return match[1];
    }
  }
  return 'git diff';
}
