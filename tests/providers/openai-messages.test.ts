/**
 * Unit tests for toOpenAIMessages — the internal conversion from copair's
 * Message[] to OpenAI ChatCompletionMessageParam[].
 *
 * Key scenarios:
 *  - supportsToolCalling: true  (native path, existing behaviour)
 *  - supportsToolCalling: false (text-based path, the bug-fix path)
 */
import { describe, it, expect } from 'vitest';
import { toOpenAIMessages } from '../../src/providers/openai.js';
import type { Message } from '../../src/providers/interface.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function userText(text: string): Message {
  return { role: 'user', content: [{ type: 'text', text }] };
}

function assistantText(text: string): Message {
  return { role: 'assistant', content: [{ type: 'text', text }] };
}

function assistantToolUse(id: string, name: string, input: Record<string, unknown>): Message {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name, input }],
  };
}

function userToolResult(toolUseId: string, content: string, isError = false): Message {
  return {
    role: 'user',
    content: [{ type: 'tool_result', toolUseId, content, isError }],
  };
}

// ─── native path (supportsToolCalling: true) ────────────────────────────────

describe('toOpenAIMessages — native tool calling', () => {
  it('converts tool_use to assistant.tool_calls', () => {
    const messages: Message[] = [
      assistantToolUse('tc1', 'web_search', { query: 'python' }),
    ];
    const result = toOpenAIMessages(messages, undefined, true);
    expect(result).toHaveLength(1);
    const msg = result[0] as { role: string; tool_calls?: unknown[] };
    expect(msg.role).toBe('assistant');
    expect(msg.tool_calls).toHaveLength(1);
  });

  it('converts tool_result to role:tool', () => {
    const messages: Message[] = [
      userToolResult('tc1', 'Search results: Python 3.12'),
    ];
    const result = toOpenAIMessages(messages, undefined, true);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('tool');
  });
});

// ─── text-based path (supportsToolCalling: false) ───────────────────────────

describe('toOpenAIMessages — text-based tool calling (supportsToolCalling: false)', () => {
  it('converts tool_use to <tool_call> text in the assistant message', () => {
    const messages: Message[] = [
      assistantToolUse('tc1', 'web_search', { query: 'latest python version' }),
    ];
    const result = toOpenAIMessages(messages, undefined, false);
    expect(result).toHaveLength(1);
    const msg = result[0] as { role: string; content: string | null; tool_calls?: unknown };
    expect(msg.role).toBe('assistant');
    expect(msg.tool_calls).toBeUndefined();
    expect(msg.content).toContain('<tool_call>');
    expect(msg.content).toContain('"name":"web_search"');
    expect(msg.content).toContain('"query":"latest python version"');
    expect(msg.content).toContain('</tool_call>');
  });

  it('converts tool_result to plain user text (not role:tool)', () => {
    const messages: Message[] = [
      userToolResult('tc1', 'Search results for "latest python version":\n1. Python 3.12.7'),
    ];
    const result = toOpenAIMessages(messages, undefined, false);
    expect(result).toHaveLength(1);
    const msg = result[0] as { role: string; content: string };
    expect(msg.role).toBe('user');    // NOT 'tool'
    expect(msg.content).toContain('[Tool result: tc1]');
    expect(msg.content).toContain('Python 3.12.7');
  });

  it('marks error tool results with [Tool error: ...]', () => {
    const messages: Message[] = [
      userToolResult('tc1', 'SearXNG error: 503', true),
    ];
    const result = toOpenAIMessages(messages, undefined, false);
    const msg = result[0] as { content: string };
    expect(msg.content).toContain('[Tool error: tc1]');
  });

  it('does not emit role:tool for non-native models', () => {
    const messages: Message[] = [
      userText('search for python'),
      assistantToolUse('tc1', 'web_search', { query: 'python' }),
      userToolResult('tc1', 'Python 3.12.7 is the latest'),
      assistantText('The latest Python is 3.12.7.'),
    ];
    const result = toOpenAIMessages(messages, undefined, false);
    for (const m of result) {
      expect(m.role).not.toBe('tool');
    }
  });

  it('full round-trip: user → tool_call → tool_result → assistant', () => {
    const messages: Message[] = [
      userText('What is the latest Python version?'),
      assistantToolUse('tc1', 'web_search', { query: 'latest python version' }),
      userToolResult('tc1', 'Python 3.12.7 released October 2024'),
      assistantText('The latest Python version is 3.12.7.'),
    ];
    const result = toOpenAIMessages(messages, 'system prompt', false);

    expect(result[0]).toEqual({ role: 'system', content: 'system prompt' });
    expect(result[1]).toEqual({ role: 'user', content: 'What is the latest Python version?' });

    const assistantMsg = result[2] as { role: string; content: string };
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.content).toContain('<tool_call>');

    const toolResultMsg = result[3] as { role: string; content: string };
    expect(toolResultMsg.role).toBe('user');
    expect(toolResultMsg.content).toContain('[Tool result: tc1]');
    expect(toolResultMsg.content).toContain('Python 3.12.7');

    expect(result[4]).toEqual({ role: 'assistant', content: 'The latest Python version is 3.12.7.' });
  });
});
