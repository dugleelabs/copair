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

    // F-23: Qwen3-Coder on Bedrock relapses from JSON-in-tag to the Hermes
    // function/parameter envelope mid-conversation. The formatter must accept both.
    it('parses Hermes envelope with single parameter', () => {
      const text = '<tool_call>\n<function=read>\n<parameter=file_path>/Volumes/repo/src/index.ts</parameter>\n</function>\n</tool_call>';
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('read');
      expect(JSON.parse(result.toolCalls[0].arguments)).toEqual({
        file_path: '/Volumes/repo/src/index.ts',
      });
    });

    it('parses Hermes envelope with multiple parameters', () => {
      const text = [
        '<tool_call>',
        '<function=edit>',
        '<parameter=file_path>/x/a.ts</parameter>',
        '<parameter=old_string>foo</parameter>',
        '<parameter=new_string>bar</parameter>',
        '</function>',
        '</tool_call>',
      ].join('\n');
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('edit');
      expect(JSON.parse(result.toolCalls[0].arguments)).toEqual({
        file_path: '/x/a.ts',
        old_string: 'foo',
        new_string: 'bar',
      });
    });

    it('parses Hermes envelope with multi-line parameter value', () => {
      const text = [
        '<tool_call>',
        '<function=write>',
        '<parameter=file_path>/x/note.md</parameter>',
        '<parameter=content>line one',
        'line two',
        'line three</parameter>',
        '</function>',
        '</tool_call>',
      ].join('\n');
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      const args = JSON.parse(result.toolCalls[0].arguments);
      expect(args.file_path).toBe('/x/note.md');
      expect(args.content).toBe('line one\nline two\nline three');
    });

    it('parses mixed JSON-in-tag and Hermes calls in a single input', () => {
      const text = [
        '<tool_call>',
        '{"name": "read", "arguments": {"file_path": "/a.ts"}}',
        '</tool_call>',
        'Now editing:',
        '<tool_call>',
        '<function=edit>',
        '<parameter=file_path>/a.ts</parameter>',
        '<parameter=old_string>x</parameter>',
        '<parameter=new_string>y</parameter>',
        '</function>',
        '</tool_call>',
      ].join('\n');
      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('read');
      expect(result.toolCalls[1].name).toBe('edit');
      expect(JSON.parse(result.toolCalls[1].arguments)).toEqual({
        file_path: '/a.ts',
        old_string: 'x',
        new_string: 'y',
      });
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
