import chalk from 'chalk';
import type { StreamChunk } from '../providers/interface.js';

/**
 * Build a human-readable one-liner for a tool call, e.g.:
 *   git status
 *   bash: npm test
 *   read: src/index.ts
 */
function formatToolCall(name: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    switch (name) {
      case 'git':
        return `git ${args.args ?? ''}`.trim();
      case 'bash':
        return `bash: ${String(args.command ?? '').slice(0, 80)}`;
      case 'read':
        return `read: ${args.file_path ?? args.path ?? ''}`;
      case 'write':
        return `write: ${args.file_path ?? args.path ?? ''}`;
      case 'edit':
        return `edit: ${args.file_path ?? args.path ?? ''}`;
      case 'glob':
        return `glob: ${args.pattern ?? ''}`;
      case 'grep':
        return `grep: ${args.pattern ?? ''}`;
      default:
        return name;
    }
  } catch {
    return name;
  }
}

export class Renderer {
  private currentToolName: string | null = null;

  async render(stream: AsyncIterableIterator<StreamChunk>): Promise<{
    toolCalls: Array<{ id: string; name: string; arguments: string }>;
    usage: { inputTokens: number; outputTokens: number } | null;
    fullText: string;
  }> {
    const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    let usage: { inputTokens: number; outputTokens: number } | null = null;
    let fullText = '';

    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'text':
          if (this.currentToolName) {
            this.endToolIndicator();
          }
          process.stdout.write(chunk.text ?? '');
          fullText += chunk.text ?? '';
          break;

        case 'tool_call_delta':
          if (chunk.toolCall && chunk.toolCall.name !== this.currentToolName) {
            if (this.currentToolName) this.endToolIndicator();
            this.currentToolName = chunk.toolCall.name;
            process.stderr.write(
              chalk.gray(`\n  ⚙ ${chunk.toolCall.name} `),
            );
          }
          break;

        case 'tool_call':
          if (chunk.toolCall) {
            if (this.currentToolName) this.endToolIndicator();
            toolCalls.push(chunk.toolCall);
            const label = formatToolCall(chunk.toolCall.name, chunk.toolCall.arguments ?? '{}');
            process.stderr.write(chalk.yellow(`\n  ⚙ ${label}\n`));
          }
          break;

        case 'usage':
          if (chunk.usage) {
            usage = chunk.usage;
          }
          break;

        case 'error':
          process.stderr.write(chalk.red(`\nError: ${chunk.error}\n`));
          break;

        case 'done':
          if (this.currentToolName) this.endToolIndicator();
          break;
      }
    }

    // Ensure newline after streaming text
    process.stdout.write('\n');

    return { toolCalls, usage, fullText };
  }

  showTokenUsage(
    requestUsage: { inputTokens: number; outputTokens: number },
    sessionUsage: { totalInput: number; totalOutput: number; totalCost: number },
  ): void {
    const line = chalk.gray(
      `[tokens: ${requestUsage.inputTokens.toLocaleString()} in / ${requestUsage.outputTokens.toLocaleString()} out` +
        ` | session: ${sessionUsage.totalInput.toLocaleString()} in / ${sessionUsage.totalOutput.toLocaleString()} out` +
        ` | ~$${sessionUsage.totalCost.toFixed(2)}]`,
    );
    console.log(line);
  }

  showSessionSummary(
    byModel: Map<string, { input: number; output: number; cost: number }>,
    totals: { totalInput: number; totalOutput: number; totalCost: number },
  ): void {
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

  private endToolIndicator(): void {
    this.currentToolName = null;
  }
}
