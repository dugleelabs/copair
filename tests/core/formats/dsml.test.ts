import { describe, it, expect } from 'vitest';
import { DsmlFormatter } from '../../../src/core/formats/dsml.js';

const formatter = new DsmlFormatter();

describe('DsmlFormatter', () => {
  describe('parse', () => {
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

      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('read');
      const args = JSON.parse(result.toolCalls[0].arguments);
      expect(args.file_path).toBe('/src/index.ts');
      expect(result.remainingText).toBe('I will read the file.');
    });

    it('parses multiple invoke blocks', () => {
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

      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('git');
      expect(result.toolCalls[1].name).toBe('read');
    });

    it('parses non-string parameters', () => {
      const text = [
        '<\uFF5CDSML\uFF5Cfunction_calls>',
        '<\uFF5CDSML\uFF5Cinvoke name="bash">',
        '<\uFF5CDSML\uFF5Cparameter name="command" string="true">npm test<\uFF5CDSML\uFF5Cparameter>',
        '<\uFF5CDSML\uFF5Cparameter name="timeout">60000<\uFF5CDSML\uFF5Cparameter>',
        '</\uFF5CDSML\uFF5Cinvoke>',
        '</\uFF5CDSML\uFF5Cfunction_calls>',
      ].join('\n');

      const result = formatter.parse(text);
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

      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('git');
    });

    it('handles ASCII pipe variant', () => {
      const text = [
        '<|DSML|function_calls>',
        '<|DSML|invoke name="read">',
        '<|DSML|parameter name="file_path" string="true">/tmp/test.ts</|DSML|parameter>',
        '</|DSML|invoke>',
        '</|DSML|function_calls>',
      ].join('\n');

      const result = formatter.parse(text);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('read');
    });
  });

  describe('markupPattern', () => {
    it('matches DSML blocks', () => {
      const text = 'before <\uFF5CDSML\uFF5Cfunction_calls>\n<\uFF5CDSML\uFF5Cinvoke name="git">\n</\uFF5CDSML\uFF5Cinvoke>\n</\uFF5CDSML\uFF5Cfunction_calls> after';
      const cleaned = text.replace(new RegExp(formatter.markupPattern.source, 'g'), '');
      expect(cleaned).toBe('before  after');
    });

    it('matches unclosed DSML blocks', () => {
      const text = 'text <\uFF5CDSML\uFF5Cfunction_calls>\n<\uFF5CDSML\uFF5Cinvoke name="git">\n</\uFF5CDSML\uFF5Cinvoke>';
      const cleaned = text.replace(new RegExp(formatter.markupPattern.source, 'g'), '');
      expect(cleaned).toBe('text ');
    });
  });
});
