import type { Message, Provider } from '../providers/interface.js';

export class ContextWindowManager {
  private tokenLimit: number;
  private reserveTokens: number;

  constructor(tokenLimit: number, reserveTokens = 4096) {
    this.tokenLimit = tokenLimit;
    this.reserveTokens = reserveTokens;
  }

  setTokenLimit(limit: number): void {
    this.tokenLimit = limit;
  }

  async checkAndTruncate(
    messages: Message[],
    provider: Provider,
  ): Promise<Message[]> {
    const tokenCount = await this.countTokens(messages, provider);
    const available = this.tokenLimit - this.reserveTokens;

    if (tokenCount <= available) return messages;

    return this.summarize(messages, provider);
  }

  private async countTokens(
    messages: Message[],
    provider: Provider,
  ): Promise<number> {
    if (provider.countTokens) {
      return provider.countTokens(messages);
    }
    // Conservative estimation: ~3 chars per token (errs on the side of
    // truncating sooner to avoid API rejection). Actual ratio varies by
    // content — code/JSON tends to be closer to 2-3 chars/token.
    let charCount = 0;
    for (const msg of messages) {
      for (const block of msg.content) {
        if (block.type === 'text') charCount += block.text.length;
        else if (block.type === 'tool_use')
          charCount += JSON.stringify(block.input).length;
        else if (block.type === 'tool_result') charCount += block.content.length;
      }
    }
    return Math.ceil(charCount / 3);
  }

  private async summarize(
    messages: Message[],
    provider: Provider,
  ): Promise<Message[]> {
    if (messages.length <= 4) return messages;

    // Keep first message (system context) and last N turns.
    // Use more aggressive truncation for very large histories.
    const keepFromEnd = Math.min(4, Math.floor(messages.length / 2));
    const kept = messages.slice(-keepFromEnd);

    // Check if even the kept messages fit within limits
    const keptTokens = await this.countTokens(kept, provider);
    if (keptTokens > this.tokenLimit - this.reserveTokens) {
      // Even the last few messages are too large — drop all but the last 2
      return messages.slice(-2);
    }

    const toSummarize = messages.slice(0, -keepFromEnd);

    // Build summary text from messages to be compressed
    // Cap the summary input to prevent the summarization call itself from failing
    const summaryParts: string[] = [];
    let summaryCharCount = 0;
    const maxSummaryChars = 100_000; // ~33K tokens — safe for summarization call
    for (const msg of toSummarize) {
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join(' ');
      if (text) {
        if (summaryCharCount + text.length > maxSummaryChars) break;
        summaryParts.push(`[${msg.role}]: ${text}`);
        summaryCharCount += text.length;
      }
    }

    // If nothing to summarize (all tool results, no text), just drop old messages
    if (summaryParts.length === 0) {
      return kept;
    }

    try {
      const summaryPrompt: Message[] = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Summarize this conversation history concisely, preserving key decisions, file paths, and code context:\n\n${summaryParts.join('\n\n')}`,
            },
          ],
        },
      ];

      const chunks: string[] = [];
      for await (const chunk of provider.chat(summaryPrompt, [], {
        model: '',
        stream: false,
      })) {
        if (chunk.type === 'text' && chunk.text) chunks.push(chunk.text);
      }

      const summaryMessage: Message = {
        role: 'system',
        content: [
          {
            type: 'text',
            text: `[Context summary of earlier conversation]: ${chunks.join('')}`,
          },
        ],
      };

      return [summaryMessage, ...kept];
    } catch {
      // Summarization failed — fall back to simple truncation
      return kept;
    }
  }
}
