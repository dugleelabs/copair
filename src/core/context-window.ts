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
    // Rough estimation: ~4 chars per token
    let charCount = 0;
    for (const msg of messages) {
      for (const block of msg.content) {
        if (block.type === 'text') charCount += block.text.length;
        else if (block.type === 'tool_use')
          charCount += JSON.stringify(block.input).length;
        else if (block.type === 'tool_result') charCount += block.content.length;
      }
    }
    return Math.ceil(charCount / 4);
  }

  private async summarize(
    messages: Message[],
    provider: Provider,
  ): Promise<Message[]> {
    if (messages.length <= 4) return messages;

    // Keep first message (system) and last 4 turns
    const keepFromEnd = 4;
    const toSummarize = messages.slice(0, -keepFromEnd);
    const kept = messages.slice(-keepFromEnd);

    // Build summary text from messages to be compressed
    const summaryParts: string[] = [];
    for (const msg of toSummarize) {
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join(' ');
      if (text) summaryParts.push(`[${msg.role}]: ${text}`);
    }

    // Ask the provider to summarize
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
  }
}
