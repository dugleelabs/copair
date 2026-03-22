import { describe, it, expect, vi } from 'vitest';
import { SessionSummarizer } from '../../src/core/session-summarizer.js';
import type { Message, Provider, StreamChunk, ProviderOptions, ToolDefinition } from '../../src/providers/interface.js';

function createMockProvider(responseText: string, delay = 0): Provider {
  return {
    name: 'mock',
    supportsToolCalling: false,
    supportsStreaming: true,
    maxContextWindow: 8000,
    async *chat(
      _messages: Message[],
      _tools: ToolDefinition[],
      _options: ProviderOptions,
    ): AsyncIterableIterator<StreamChunk> {
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
      yield { type: 'text', text: responseText };
      yield { type: 'done' };
    },
  };
}

describe('SessionSummarizer', () => {
  const messages: Message[] = [
    { role: 'user', content: [{ type: 'text', text: 'Fix the login bug' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'I will investigate...' }] },
    { role: 'user', content: [{ type: 'text', text: 'Try the auth module' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Found the issue...' }] },
  ];

  it('summarizes with mock provider', async () => {
    const provider = createMockProvider('## Summary\nFixed login bug.');
    const summarizer = new SessionSummarizer(provider, 'mock-model');

    const result = await summarizer.summarize(messages);
    expect(result).toContain('Summary');
    expect(result).toContain('Fixed login bug');
  });

  it('returns null when messageCount < 4', async () => {
    const provider = createMockProvider('should not run');
    const summarizer = new SessionSummarizer(provider, 'mock-model');

    const short = messages.slice(0, 3);
    const result = await summarizer.summarize(short);
    expect(result).toBeNull();
  });

  it('returns null on timeout', async () => {
    // Provider takes 500ms but timeout is 100ms
    const provider = createMockProvider('too slow', 500);
    const summarizer = new SessionSummarizer(provider, 'mock-model', 100);

    const result = await summarizer.summarize(messages);
    expect(result).toBeNull();
  });
});
