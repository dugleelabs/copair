/**
 * Tests for spec 028 T-C15: model tier classifier
 */
import { describe, it, expect } from 'vitest';
import { classifyModel, normalizeModelId } from '../../src/core/model-tiers.js';

describe('normalizeModelId', () => {
  it('strips Bedrock vendor and regional prefixes', () => {
    expect(normalizeModelId('us.anthropic.claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(normalizeModelId('eu.anthropic.claude-haiku-4-5')).toBe('claude-haiku-4-5');
    expect(normalizeModelId('qwen.qwen3-coder-480b-a35b-v1:0')).toBe('qwen3-coder-480b-a35b-v1-0');
    expect(normalizeModelId('amazon.nova-pro-v1:0')).toBe('nova-pro-v1-0');
    expect(normalizeModelId('cohere.command-r7b-v1:0')).toBe('command-r7b-v1-0');
  });

  it('strips OpenRouter and Hugging Face org/path prefixes', () => {
    expect(normalizeModelId('anthropic/claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(normalizeModelId('Qwen/Qwen3-Coder-480B-A35B-Instruct')).toBe(
      'qwen3-coder-480b-a35b-instruct',
    );
    expect(normalizeModelId('meta-llama/Meta-Llama-3.1-70B-Instruct')).toBe(
      'meta-llama-3-1-70b-instruct',
    );
  });

  it('normalizes Ollama colon-tag format', () => {
    expect(normalizeModelId('qwen3-coder:30b-a3b')).toBe('qwen3-coder-30b-a3b');
    expect(normalizeModelId('qwen2.5-coder:7b')).toBe('qwen2-5-coder-7b');
    expect(normalizeModelId('llama3.1:8b')).toBe('llama3-1-8b');
  });

  it('lowercases all input', () => {
    expect(normalizeModelId('Claude-Sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(normalizeModelId('QWEN.QWEN3-CODER-480B')).toBe('qwen3-coder-480b');
  });

  it('collapses repeated dashes and trims edges', () => {
    expect(normalizeModelId('--foo---bar--')).toBe('foo-bar');
  });
});

describe('classifyModel — frontier proprietary (large)', () => {
  it('Claude across all versions and platforms', () => {
    expect(classifyModel('claude-3-haiku-20240307').tier).toBe('large');
    expect(classifyModel('claude-3-5-sonnet').tier).toBe('large');
    expect(classifyModel('claude-sonnet-4-6').tier).toBe('large');
    expect(classifyModel('claude-opus-4-7').tier).toBe('large');
    expect(classifyModel('claude-haiku-4-5').tier).toBe('large');
    expect(classifyModel('us.anthropic.claude-sonnet-4-6').tier).toBe('large');
    expect(classifyModel('anthropic/claude-opus-4-6').tier).toBe('large');
  });

  it('OpenAI GPT and o-series', () => {
    expect(classifyModel('gpt-3.5-turbo').tier).toBe('large');
    expect(classifyModel('gpt-4o').tier).toBe('large');
    expect(classifyModel('gpt-4.1').tier).toBe('large');
    expect(classifyModel('gpt-5.5').tier).toBe('large');
    expect(classifyModel('o1-mini').tier).toBe('large');
    expect(classifyModel('o3-pro').tier).toBe('large');
    expect(classifyModel('o4-mini').tier).toBe('large');
  });

  it('Google Gemini Pro/Flash', () => {
    expect(classifyModel('gemini-2.5-pro').tier).toBe('large');
    expect(classifyModel('gemini-3-pro').tier).toBe('large');
    expect(classifyModel('gemini-3-flash').tier).toBe('large');
    expect(classifyModel('gemini-3.1-pro').tier).toBe('large');
  });

  it('xAI Grok all versions', () => {
    expect(classifyModel('grok-2').tier).toBe('large');
    expect(classifyModel('grok-3').tier).toBe('large');
    expect(classifyModel('grok-4').tier).toBe('large');
    expect(classifyModel('grok-4-3').tier).toBe('large');
  });

  it('Moonshot Kimi K2 family', () => {
    expect(classifyModel('kimi-k2').tier).toBe('large');
    expect(classifyModel('kimi-k2-5').tier).toBe('large');
    expect(classifyModel('kimi-k2-6').tier).toBe('large');
  });
});

describe('classifyModel — Qwen (the F-24 motivating case)', () => {
  it('Qwen3-Coder 480B is large despite "qwen" substring', () => {
    expect(classifyModel('qwen.qwen3-coder-480b-a35b-v1:0').tier).toBe('large');
    expect(classifyModel('Qwen/Qwen3-Coder-480B-A35B-Instruct').tier).toBe('large');
    expect(classifyModel('qwen3-coder:480b').tier).toBe('large');
  });

  it('Qwen3 235B is large', () => {
    expect(classifyModel('qwen.qwen3-235b-a22b-2507-v1:0').tier).toBe('large');
    expect(classifyModel('qwen3-vl-235b-a22b').tier).toBe('large');
  });

  it('Qwen3-Coder 30B-A3B is large (capable coder MoE)', () => {
    expect(classifyModel('qwen.qwen3-coder-30b-a3b-v1:0').tier).toBe('large');
    expect(classifyModel('qwen3-coder:30b').tier).toBe('large');
  });

  it('Qwen3 32B and 30B-A3B are large', () => {
    expect(classifyModel('qwen3-32b').tier).toBe('large');
    expect(classifyModel('qwen3-30b-a3b').tier).toBe('large');
  });

  it('Qwen3-Next 80B-A3B is large', () => {
    expect(classifyModel('qwen.qwen3-next-80b-a3b').tier).toBe('large');
  });

  it('Qwen 72B is large', () => {
    expect(classifyModel('qwen2.5:72b').tier).toBe('large');
    expect(classifyModel('qwen2-5-72b').tier).toBe('large');
  });

  it('Qwen 7B is small (the local-class)', () => {
    expect(classifyModel('qwen2.5-coder:7b').tier).toBe('small');
    expect(classifyModel('qwen2.5:7b').tier).toBe('small');
    expect(classifyModel('Qwen/Qwen2.5-Coder-7B-Instruct').tier).toBe('small');
  });

  it('Qwen smaller dense (0.5B–14B) is small', () => {
    expect(classifyModel('qwen3:0.6b').tier).toBe('small');
    expect(classifyModel('qwen3:1.7b').tier).toBe('small');
    expect(classifyModel('qwen3:4b').tier).toBe('small');
    expect(classifyModel('qwen3:8b').tier).toBe('small');
    expect(classifyModel('qwen3:14b').tier).toBe('small');
    expect(classifyModel('qwen2.5-coder:1.5b').tier).toBe('small');
  });

  it('DashScope aliases', () => {
    expect(classifyModel('qwen-max').tier).toBe('large');
    expect(classifyModel('qwen-plus').tier).toBe('large');
    expect(classifyModel('qwen-turbo').tier).toBe('small');
  });
});

describe('classifyModel — Llama', () => {
  it('Llama 405B and Llama 4 family are large', () => {
    expect(classifyModel('llama-3.1-405b').tier).toBe('large');
    expect(classifyModel('llama-4-maverick').tier).toBe('large');
    expect(classifyModel('llama-4-scout').tier).toBe('large');
    expect(classifyModel('llama-4-behemoth').tier).toBe('large');
  });

  it('Llama 70B class is large', () => {
    expect(classifyModel('llama-3.1-70b').tier).toBe('large');
    expect(classifyModel('llama-3.3-70b').tier).toBe('large');
    expect(classifyModel('llama3.1:70b').tier).toBe('large');
  });

  it('Llama 1B–11B is small', () => {
    expect(classifyModel('llama-3.1-8b').tier).toBe('small');
    expect(classifyModel('llama-3.2-1b').tier).toBe('small');
    expect(classifyModel('llama-3.2-3b').tier).toBe('small');
    expect(classifyModel('llama-3.2-11b-vision').tier).toBe('small');
    expect(classifyModel('llama3.1:8b').tier).toBe('small');
  });
});

describe('classifyModel — DeepSeek', () => {
  it('frontier V3/V4/R1/R2 are large', () => {
    expect(classifyModel('deepseek-v3').tier).toBe('large');
    expect(classifyModel('deepseek-v3.2').tier).toBe('large');
    expect(classifyModel('deepseek-v4').tier).toBe('large');
    expect(classifyModel('deepseek-r1').tier).toBe('large');
    expect(classifyModel('deepseek-r1-0528').tier).toBe('large');
    expect(classifyModel('deepseek-chat').tier).toBe('large');
    expect(classifyModel('deepseek-reasoner').tier).toBe('large');
  });

  it('R1 distill ≤8B is small, ≥14B is large', () => {
    expect(classifyModel('deepseek-r1-distill-1.5b').tier).toBe('small');
    expect(classifyModel('deepseek-r1-distill-7b').tier).toBe('small');
    expect(classifyModel('deepseek-r1-distill-8b').tier).toBe('small');
    expect(classifyModel('deepseek-r1-distill-14b').tier).toBe('large');
    expect(classifyModel('deepseek-r1-distill-32b').tier).toBe('large');
    expect(classifyModel('deepseek-r1-distill-70b').tier).toBe('large');
  });
});

describe('classifyModel — Mistral and relatives', () => {
  it('frontier and mid-tier are large', () => {
    expect(classifyModel('mistral-large').tier).toBe('large');
    expect(classifyModel('mistral-large-3').tier).toBe('large');
    expect(classifyModel('pixtral-large').tier).toBe('large');
    expect(classifyModel('mistral-medium-3.5').tier).toBe('large');
    expect(classifyModel('mistral-small-4').tier).toBe('large');
    expect(classifyModel('codestral').tier).toBe('large');
    expect(classifyModel('mixtral-8x7b').tier).toBe('large');
    expect(classifyModel('mixtral-8x22b').tier).toBe('large');
    expect(classifyModel('magistral-medium').tier).toBe('large');
    expect(classifyModel('magistral-small').tier).toBe('large');
  });

  it('local-class Mistral is small', () => {
    expect(classifyModel('mistral-7b').tier).toBe('small');
    expect(classifyModel('mistral-nemo').tier).toBe('small');
    expect(classifyModel('mistral.mistral-7b-instruct-v0:2').tier).toBe('small');
    expect(classifyModel('ministral-3b').tier).toBe('small');
    expect(classifyModel('ministral-7b').tier).toBe('small');
    expect(classifyModel('ministral-14b').tier).toBe('small');
  });
});

describe('classifyModel — Microsoft Phi', () => {
  it('Phi mid+ is large', () => {
    expect(classifyModel('phi-4-medium').tier).toBe('large');
    expect(classifyModel('phi-4-14b').tier).toBe('large');
    expect(classifyModel('phi-3.5-moe').tier).toBe('large');
  });

  it('Phi mini and small dense are small', () => {
    expect(classifyModel('phi-3-mini').tier).toBe('small');
    expect(classifyModel('phi-3.5-mini').tier).toBe('small');
    expect(classifyModel('phi-4-mini').tier).toBe('small');
    expect(classifyModel('phi-4-multimodal').tier).toBe('small');
    expect(classifyModel('phi-3-small-7b').tier).toBe('small');
  });
});

describe('classifyModel — Cohere Command', () => {
  it('A and R+ are large', () => {
    expect(classifyModel('command-a').tier).toBe('large');
    expect(classifyModel('command-r-plus').tier).toBe('large');
    expect(classifyModel('command-r').tier).toBe('large');
  });

  it('R7B is small', () => {
    expect(classifyModel('command-r7b').tier).toBe('small');
    expect(classifyModel('cohere.command-r7b-v1:0').tier).toBe('small');
  });
});

describe('classifyModel — Amazon Nova', () => {
  it('Pro/Premier/Lite are large; Micro is small', () => {
    expect(classifyModel('amazon.nova-premier-v1:0').tier).toBe('large');
    expect(classifyModel('amazon.nova-pro-v1:0').tier).toBe('large');
    expect(classifyModel('amazon.nova-lite-v1:0').tier).toBe('large');
    expect(classifyModel('amazon.nova-micro-v1:0').tier).toBe('small');
  });
});

describe('classifyModel — IBM Granite', () => {
  it('30B is large; 2B/3B/8B are small', () => {
    expect(classifyModel('granite-4.1-30b').tier).toBe('large');
    expect(classifyModel('granite-4.1:30b').tier).toBe('large');
    expect(classifyModel('granite-4.1:3b').tier).toBe('small');
    expect(classifyModel('granite-4.1:8b').tier).toBe('small');
  });
});

describe('classifyModel — Reka, Yi, Falcon, Jamba, Gemma, GLM, MiniMax, Nemotron, gpt-oss', () => {
  it('Reka tiers', () => {
    expect(classifyModel('reka-core').tier).toBe('large');
    expect(classifyModel('reka-flash').tier).toBe('large');
    expect(classifyModel('reka-edge').tier).toBe('small');
  });

  it('Yi tiers', () => {
    expect(classifyModel('yi-large').tier).toBe('large');
    expect(classifyModel('yi-lightning').tier).toBe('large');
    expect(classifyModel('yi-1.5-34b').tier).toBe('large');
    expect(classifyModel('yi-coder-9b').tier).toBe('small');
    expect(classifyModel('yi-coder-1.5b').tier).toBe('small');
    expect(classifyModel('yi-1.5-9b').tier).toBe('small');
  });

  it('Falcon tiers', () => {
    expect(classifyModel('falcon3-7b').tier).toBe('small');
    expect(classifyModel('falcon3-10b').tier).toBe('small');
    expect(classifyModel('falcon-h1r-7b').tier).toBe('small');
    expect(classifyModel('falcon3-mamba-7b').tier).toBe('small');
  });

  it('Jamba tiers', () => {
    expect(classifyModel('jamba-large-1.7').tier).toBe('large');
    expect(classifyModel('jamba-mini-1.7').tier).toBe('large');
    expect(classifyModel('jamba-reasoning-3b').tier).toBe('small');
  });

  it('Gemma tiers', () => {
    expect(classifyModel('gemma-2-27b').tier).toBe('large');
    expect(classifyModel('gemma-3-12b').tier).toBe('large');
    expect(classifyModel('gemma-2-2b').tier).toBe('small');
    expect(classifyModel('gemma-3-1b').tier).toBe('small');
    expect(classifyModel('gemma-3-4b').tier).toBe('small');
  });

  it('GLM tiers', () => {
    expect(classifyModel('glm-5').tier).toBe('large');
    expect(classifyModel('glm-4.5').tier).toBe('large');
    expect(classifyModel('glm-4.6').tier).toBe('large');
    expect(classifyModel('glm-4-9b').tier).toBe('small');
  });

  it('MiniMax tiers', () => {
    expect(classifyModel('minimax-m1').tier).toBe('large');
    expect(classifyModel('minimax-m2').tier).toBe('large');
    expect(classifyModel('minimax-m2.5').tier).toBe('large');
  });

  it('Nemotron tiers', () => {
    expect(classifyModel('llama-3.1-nemotron-ultra-253b').tier).toBe('large');
    expect(classifyModel('llama-3.3-nemotron-super-49b').tier).toBe('large');
    expect(classifyModel('llama-3.1-nemotron-70b').tier).toBe('large');
    expect(classifyModel('llama-3.1-nemotron-nano-8b').tier).toBe('small');
  });

  it('OpenAI open-weights', () => {
    expect(classifyModel('gpt-oss-20b').tier).toBe('large');
    expect(classifyModel('gpt-oss-120b').tier).toBe('large');
    expect(classifyModel('openai.gpt-oss-120b-1:0').tier).toBe('large');
  });
});

describe('classifyModel — overrides and defaults', () => {
  it('tier_overrides win over built-in classification', () => {
    // Force a frontier model into small
    expect(
      classifyModel('claude-sonnet-4-6', { 'claude-sonnet-4-6': 'small' }).tier,
    ).toBe('small');
    // Force a known-small model into large
    expect(
      classifyModel('qwen2.5:7b', { 'qwen2.5:7b': 'large' }).tier,
    ).toBe('large');
  });

  it('unknown model IDs return tier: null (spec 029 F-11 strict-unknowns)', () => {
    expect(classifyModel('totally-unknown-model').tier).toBeNull();
    expect(classifyModel('my-custom-future-model-2027').tier).toBeNull();
  });

  it('result includes family for known models', () => {
    expect(classifyModel('claude-sonnet-4-6').family).toBe('Claude');
    expect(classifyModel('qwen.qwen3-coder-480b-a35b-v1:0').family).toBe('Qwen3-Coder 480B');
    expect(classifyModel('phi-4-mini').family).toBe('Phi-4 small');
    expect(classifyModel('command-r7b').family).toBe('Command R7B');
  });

  it('result includes family="unknown" + matched=null for unmatched IDs', () => {
    const result = classifyModel('totally-unknown-model');
    expect(result.family).toBe('unknown');
    expect(result.matched).toBeNull();
  });

  it('result includes family="override" when override is used', () => {
    const result = classifyModel('claude-sonnet-4-6', { 'claude-sonnet-4-6': 'small' });
    expect(result.family).toBe('override');
  });
});

describe('classifyModel — specificity ordering', () => {
  it('Qwen3-Coder 480B matches the specific rule before generic Qwen patterns', () => {
    const result = classifyModel('qwen.qwen3-coder-480b-a35b-v1:0');
    expect(result.tier).toBe('large');
    expect(result.family).toBe('Qwen3-Coder 480B');
  });

  it('Llama 405B matches the specific rule before generic Llama patterns', () => {
    const result = classifyModel('llama-3.1-405b');
    expect(result.tier).toBe('large');
    expect(result.family).toBe('Llama 405B');
  });

  it('Qwen3-Coder 30B matches before generic Qwen 30b-a3b pattern', () => {
    const result = classifyModel('qwen3-coder-30b-a3b');
    expect(result.tier).toBe('large');
    expect(result.family).toBe('Qwen3-Coder 30B');
  });

  it('Command R7B matches small before generic Command R large rule', () => {
    const result = classifyModel('command-r7b');
    expect(result.tier).toBe('small');
    expect(result.family).toBe('Command R7B');
  });
});
