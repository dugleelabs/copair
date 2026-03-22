import { describe, it, expect } from 'vitest';
import { QwenXmlFormatter } from '../../../src/core/formats/qwen-xml.js';

const formatter = new QwenXmlFormatter();

describe('QwenXmlFormatter', () => {
  describe('parse', () => {
    it('parses closed <tool_call> tags', () => {
      const text = '<tool_call>\n{"name": "read", "arguments": {"file_path": "/a.ts"}}\n</tool_call>';
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('read');
    });

    it('parses unclosed <tool_call> tags', () => {
      const text = '<tool_call>\n{"name": "git", "arguments": {"args": "status"}}';
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('git');
    });

    it('strips markup from remainingText', () => {
      const text = 'Let me check.\n<tool_call>\n{"name": "git", "arguments": {"args": "status"}}\n</tool_call>\nDone.';
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.remainingText).toContain('Let me check.');
      expect(result.remainingText).toContain('Done.');
    });

    it('handles command shortcut inside XML tags', () => {
      const text = '<tool_call>\n{"command": "npm test"}\n</tool_call>';
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('bash');
    });
  });

  describe('markupPattern', () => {
    it('matches closed tool_call tags', () => {
      const text = 'before <tool_call>{"name":"git"}</tool_call> after';
      const cleaned = text.replace(new RegExp(formatter.markupPattern.source, 'g'), '');
      expect(cleaned).toBe('before  after');
    });

    it('matches unclosed tool_call tags', () => {
      const text = 'text <tool_call>{"name":"git"}';
      const cleaned = text.replace(new RegExp(formatter.markupPattern.source, 'g'), '');
      expect(cleaned).toBe('text ');
    });
  });
});
