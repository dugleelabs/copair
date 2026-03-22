import { describe, it, expect } from 'vitest';
import { FencedBlockFormatter, tryParseToolCall } from '../../../src/core/formats/fenced-block.js';

const formatter = new FencedBlockFormatter();

describe('FencedBlockFormatter', () => {
  describe('parse', () => {
    it('parses ```tool_call``` fenced blocks', () => {
      const text = '```tool_call\n{"name": "git", "arguments": {"args": "status"}}\n```';
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('git');
    });

    it('parses ```json``` fenced blocks', () => {
      const text = '```json\n{"name": "read", "arguments": {"file_path": "/a.ts"}}\n```';
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('read');
    });

    it('parses bare fenced blocks', () => {
      const text = '```\n{"name": "bash", "arguments": {"command": "ls"}}\n```';
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('bash');
    });

    it('strips matched blocks from remainingText', () => {
      const text = 'Let me check.\n```tool_call\n{"name": "git", "arguments": {"args": "status"}}\n```\nDone.';
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.remainingText).toBe('Let me check.\n\nDone.');
    });

    it('returns empty toolCalls for non-tool JSON', () => {
      const text = '```json\n{"key": "value"}\n```';
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(0);
    });
  });

  describe('shortcuts', () => {
    it('parses bare command shortcut', () => {
      const text = '```\n{"command": "ls -la"}\n```';
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('bash');
    });

    it('parses bare args shortcut as git', () => {
      const text = '```tool_call\n{"args": "diff --cached"}\n```';
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('git');
    });
  });
});

describe('tryParseToolCall', () => {
  it('parses canonical format', () => {
    const tc = tryParseToolCall('{"name": "read", "arguments": {"file_path": "/a.ts"}}');
    expect(tc).not.toBeNull();
    expect(tc!.name).toBe('read');
  });

  it('rejects names longer than 30 chars', () => {
    const tc = tryParseToolCall(`{"name": "${'a'.repeat(31)}", "arguments": {}}`);
    expect(tc).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(tryParseToolCall('not json')).toBeNull();
  });

  it('returns null for unrecognized shapes', () => {
    expect(tryParseToolCall('{"key": "value"}')).toBeNull();
  });

  it('preserves id if present', () => {
    const tc = tryParseToolCall('{"id": "my_id", "name": "git", "arguments": {"args": "status"}}');
    expect(tc!.id).toBe('my_id');
  });
});
