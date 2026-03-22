import { describe, it, expect } from 'vitest';
import { resolveFormatter, buildTextFilter } from '../../../src/core/formats/index.js';
import { DsmlFormatter } from '../../../src/core/formats/dsml.js';
import { QwenXmlFormatter } from '../../../src/core/formats/qwen-xml.js';
import { FencedBlockFormatter } from '../../../src/core/formats/fenced-block.js';

describe('resolveFormatter', () => {
  it('returns DsmlFormatter for deepseek models', () => {
    const f = resolveFormatter('openai-compatible', 'deepseek-chat-v3');
    expect(f).toBeInstanceOf(DsmlFormatter);
  });

  it('returns QwenXmlFormatter for qwen models', () => {
    const f = resolveFormatter('openai-compatible', 'qwen2.5-coder-32b');
    expect(f).toBeInstanceOf(QwenXmlFormatter);
  });

  it('returns FencedBlockFormatter by default', () => {
    const f = resolveFormatter('openai', 'gpt-4o');
    expect(f).toBeInstanceOf(FencedBlockFormatter);
  });

  it('respects explicit override', () => {
    const f = resolveFormatter('openai', 'gpt-4o', 'dsml');
    expect(f).toBeInstanceOf(DsmlFormatter);
  });

  it('override takes precedence over auto-detection', () => {
    const f = resolveFormatter('openai-compatible', 'deepseek-chat-v3', 'fenced-block');
    expect(f).toBeInstanceOf(FencedBlockFormatter);
  });
});

describe('buildTextFilter', () => {
  it('strips DSML markup from text', () => {
    const formatter = new DsmlFormatter();
    const filter = buildTextFilter(formatter);
    const text = 'Hello <\uFF5CDSML\uFF5Cfunction_calls>\n<\uFF5CDSML\uFF5Cinvoke name="git">\n</\uFF5CDSML\uFF5Cinvoke>\n</\uFF5CDSML\uFF5Cfunction_calls> world';
    const result = filter(text);
    expect(result).toBe('Hello  world');
  });

  it('strips fenced block markup from text', () => {
    const formatter = new FencedBlockFormatter();
    const filter = buildTextFilter(formatter);
    const text = 'Before ```tool_call\n{"name":"git"}\n``` after';
    const result = filter(text);
    expect(result).toBe('Before  after');
  });

  it('strips Qwen XML markup from text', () => {
    const formatter = new QwenXmlFormatter();
    const filter = buildTextFilter(formatter);
    const text = 'Hello <tool_call>{"name":"git"}</tool_call> world';
    const result = filter(text);
    expect(result).toBe('Hello  world');
  });

  it('returns text unchanged when no markup present', () => {
    const formatter = new FencedBlockFormatter();
    const filter = buildTextFilter(formatter);
    expect(filter('plain text')).toBe('plain text');
  });
});
