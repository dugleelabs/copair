import { describe, it, expect } from 'vitest';
import { parseToolCallsFromText } from '../../src/core/tool-fallback.js';

describe('parseToolCallsFromText', () => {
  describe('DeepSeek DSML format', () => {
    it('parses a single DSML invoke block', () => {
      const text = [
        'I will read the file.',
        '',
        '<\uFF5CDSML\uFF5Cfunction_calls>',
        '<\uFF5CDSML\uFF5Cinvoke name="read">',
        '<\uFF5CDSML\uFF5Cparameter name="file_path" string="true">/src/index.ts<\uFF5CDSML\uFF5Cparameter>',
        '</\uFF5CDSML\uFF5Cinvoke>',
        '</\uFF5CDSML\uFF5Cfunction_calls>',
      ].join('\n');

      const result = parseToolCallsFromText(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('read');
      const args = JSON.parse(result.toolCalls[0].arguments);
      expect(args.file_path).toBe('/src/index.ts');
      expect(result.remainingText).toBe('I will read the file.');
    });

    it('parses multiple DSML invoke blocks', () => {
      const text = [
        '<\uFF5CDSML\uFF5Cfunction_calls>',
        '<\uFF5CDSML\uFF5Cinvoke name="git">',
        '<\uFF5CDSML\uFF5Cparameter name="args" string="true">status<\uFF5CDSML\uFF5Cparameter>',
        '</\uFF5CDSML\uFF5Cinvoke>',
        '<\uFF5CDSML\uFF5Cinvoke name="read">',
        '<\uFF5CDSML\uFF5Cparameter name="file_path" string="true">package.json<\uFF5CDSML\uFF5Cparameter>',
        '</\uFF5CDSML\uFF5Cinvoke>',
        '</\uFF5CDSML\uFF5Cfunction_calls>',
      ].join('\n');

      const result = parseToolCallsFromText(text);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('git');
      expect(result.toolCalls[1].name).toBe('read');
    });

    it('parses DSML with non-string parameters', () => {
      const text = [
        '<\uFF5CDSML\uFF5Cfunction_calls>',
        '<\uFF5CDSML\uFF5Cinvoke name="bash">',
        '<\uFF5CDSML\uFF5Cparameter name="command" string="true">npm test<\uFF5CDSML\uFF5Cparameter>',
        '<\uFF5CDSML\uFF5Cparameter name="timeout">60000<\uFF5CDSML\uFF5Cparameter>',
        '</\uFF5CDSML\uFF5Cinvoke>',
        '</\uFF5CDSML\uFF5Cfunction_calls>',
      ].join('\n');

      const result = parseToolCallsFromText(text);
      expect(result.toolCalls).toHaveLength(1);
      const args = JSON.parse(result.toolCalls[0].arguments);
      expect(args.command).toBe('npm test');
      expect(args.timeout).toBe(60000);
    });

    it('handles unclosed DSML block', () => {
      const text = [
        '<\uFF5CDSML\uFF5Cfunction_calls>',
        '<\uFF5CDSML\uFF5Cinvoke name="git">',
        '<\uFF5CDSML\uFF5Cparameter name="args" string="true">diff --cached<\uFF5CDSML\uFF5Cparameter>',
        '</\uFF5CDSML\uFF5Cinvoke>',
      ].join('\n');

      const result = parseToolCallsFromText(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('git');
    });

    it('handles ASCII pipe variant', () => {
      const text = [
        '<|DSML|function_calls>',
        '<|DSML|invoke name="read">',
        '<|DSML|parameter name="file_path" string="true">/tmp/test.ts<|DSML|parameter>',
        '</|DSML|invoke>',
        '</|DSML|function_calls>',
      ].join('\n');

      const result = parseToolCallsFromText(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('read');
    });
  });

  describe('existing formats still work', () => {
    it('parses ```tool_call``` fenced blocks', () => {
      const text = '```tool_call\n{"name": "git", "arguments": {"args": "status"}}\n```';
      const result = parseToolCallsFromText(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('git');
    });

    it('parses <tool_call> XML tags', () => {
      const text = '<tool_call>\n{"name": "read", "arguments": {"file_path": "/a.ts"}}\n</tool_call>';
      const result = parseToolCallsFromText(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('read');
    });

    it('parses bare command shortcut', () => {
      const text = '```\n{"command": "ls -la"}\n```';
      const result = parseToolCallsFromText(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('bash');
    });
  });
});
