import { describe, it, expect } from 'vitest';
import { resolveFormatter, buildStreamingFilter, StreamingMarkupFilter } from '../../../src/core/formats/index.js';
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

describe('buildStreamingFilter / StreamingMarkupFilter', () => {
  it('returns a StreamingMarkupFilter instance', () => {
    expect(buildStreamingFilter(new QwenXmlFormatter())).toBeInstanceOf(StreamingMarkupFilter);
  });

  describe('Qwen XML — single-chunk (complete block)', () => {
    it('strips closed tool_call block; post-match text suppressed (suppressAfterMatch)', () => {
      const f = buildStreamingFilter(new QwenXmlFormatter());
      // 'world' is after </tool_call> — suppressed for Qwen
      const out = f.write('Hello <tool_call>{"name":"git"}</tool_call> world');
      expect(out + f.flush()).toBe('Hello ');
    });

    it('passes plain text through unchanged', () => {
      const f = buildStreamingFilter(new QwenXmlFormatter());
      expect(f.write('plain text') + f.flush()).toBe('plain text');
    });
  });

  describe('Qwen XML — multi-chunk (split across chunks)', () => {
    it('suppresses JSON, close-tag, AND any hallucinated text after the tool call', () => {
      const f = buildStreamingFilter(new QwenXmlFormatter());
      const c1 = f.write('<tool_call>\n');
      const c2 = f.write('{"name":"web_search","arguments":{"query":"python"}}\n');
      const c3 = f.write('</tool_call>');
      const c4 = f.write('It seems there was an issue.');
      // suppressAfterMatch: c4 is discarded
      expect(c1 + c2 + c3 + c4 + f.flush()).toBe('');
    });

    it('shows text before the tool call; suppresses post-match text', () => {
      const f = buildStreamingFilter(new QwenXmlFormatter());
      const c1 = f.write('Let me search. <tool_call>');
      const c2 = f.write('{"name":"web_search","arguments":{}}\n');
      const c3 = f.write('</tool_call> Done.');
      // 'Done.' is after </tool_call> — suppressed
      expect(c1 + c2 + c3 + f.flush()).toBe('Let me search. ');
    });

    it('holds back a partial open-tag suffix and resolves it on next chunk', () => {
      const f = buildStreamingFilter(new QwenXmlFormatter());
      // chunk ends mid-tag
      const c1 = f.write('text <tool');
      const c2 = f.write('_call>{"name":"git"}</tool_call> end');
      // 'end' is after </tool_call> — suppressed
      expect(c1 + c2 + f.flush()).toBe('text ');
    });

    it('flush discards an unclosed block at stream end', () => {
      const f = buildStreamingFilter(new QwenXmlFormatter());
      f.write('<tool_call>{"name":"git"}');
      expect(f.flush()).toBe('');
    });

    it('suppressAfterMatch: discards text that follows the first </tool_call>', () => {
      const f = buildStreamingFilter(new QwenXmlFormatter());
      f.write('<tool_call>{"name":"web_search","arguments":{}}</tool_call>');
      // hallucinated text in the same response — must be suppressed
      const leaked = f.write('It seems the search request was denied.');
      expect(leaked).toBe('');
      expect(f.flush()).toBe('');
    });

    it('suppressAfterMatch: still shows text BEFORE the tool call', () => {
      const f = buildStreamingFilter(new QwenXmlFormatter());
      const before = f.write('Sure, searching now. <tool_call>{"name":"web_search","arguments":{}}</tool_call>');
      const after = f.write('It seems there was an issue.');
      expect(before).toBe('Sure, searching now. ');
      expect(after).toBe('');
      expect(f.flush()).toBe('');
    });
  });

  describe('DSML — falls back to per-chunk regex', () => {
    it('strips DSML markup from a single chunk', () => {
      const f = buildStreamingFilter(new DsmlFormatter());
      const text = 'Hello <\uFF5CDSML\uFF5Cfunction_calls>\n<\uFF5CDSML\uFF5Cinvoke name="git">\n</\uFF5CDSML\uFF5Cinvoke>\n</\uFF5CDSML\uFF5Cfunction_calls> world';
      expect(f.write(text) + f.flush()).toBe('Hello  world');
    });
  });

  describe('fenced-block — falls back to per-chunk regex', () => {
    it('strips fenced block markup from a single chunk', () => {
      const f = buildStreamingFilter(new FencedBlockFormatter());
      const text = 'Before ```tool_call\n{"name":"git"}\n``` after';
      expect(f.write(text) + f.flush()).toBe('Before  after');
    });
  });
});
