import { describe, it, expect } from 'vitest';
import { CopairConfigSchema } from '../../src/config/schema.js';

describe('CopairConfigSchema', () => {
  it('validates a minimal config', () => {
    const result = CopairConfigSchema.parse({ version: 1 });
    expect(result.version).toBe(1);
    expect(result.providers).toEqual({});
    expect(result.permissions.mode).toBe('ask');
    expect(result.feature_flags.model_routing).toBe(false);
  });

  it('validates the full example config from the design doc', () => {
    const config = {
      version: 1,
      default_model: 'claude-sonnet',
      providers: {
        anthropic: {
          api_key: 'sk-test-key',
          models: {
            'claude-sonnet': {
              id: 'claude-sonnet-4-20250514',
              max_tokens: 8192,
            },
          },
        },
        openai: {
          api_key: 'sk-openai-key',
          models: {
            'gpt-4o': {
              id: 'gpt-4o',
              max_tokens: 4096,
            },
          },
        },
        ollama: {
          type: 'openai-compatible' as const,
          base_url: 'http://localhost:11434/v1',
          models: {
            'llama-3': {
              id: 'llama3.1:70b',
              max_tokens: 4096,
              context_window: 131072,
              supports_tool_calling: false,
            },
          },
        },
      },
      permissions: {
        mode: 'ask' as const,
        allow_commands: ['git status', 'git diff', 'npm test'],
      },
      feature_flags: {
        model_routing: false,
      },
      mcp_servers: [
        {
          name: 'filesystem',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
      ],
      web_search: {
        provider: 'tavily' as const,
        api_key: 'tvly-test',
        max_results: 5,
      },
    };

    const result = CopairConfigSchema.parse(config);
    expect(result.default_model).toBe('claude-sonnet');
    expect(result.providers.anthropic.models['claude-sonnet'].id).toBe(
      'claude-sonnet-4-20250514',
    );
    expect(result.providers.ollama.type).toBe('openai-compatible');
    expect(result.permissions.allow_commands).toHaveLength(3);
    expect(result.mcp_servers).toHaveLength(1);
    expect(result.web_search?.provider).toBe('tavily');
  });

  it('rejects invalid provider type', () => {
    expect(() =>
      CopairConfigSchema.parse({
        version: 1,
        providers: {
          bad: { type: 'invalid', models: {} },
        },
      }),
    ).toThrow();
  });

  it('rejects missing version', () => {
    expect(() => CopairConfigSchema.parse({ providers: {} })).toThrow();
  });
});
