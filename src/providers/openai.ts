import OpenAI from 'openai';
import type {
  Provider,
  Message,
  StreamChunk,
  ProviderOptions,
  ToolDefinition,
} from './interface.js';
import type { ProviderConfig } from '../config/schema.js';

function toOpenAIMessages(
  messages: Message[],
  systemPrompt?: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === 'system') {
      result.push({
        role: 'system',
        content: msg.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n'),
      });
      continue;
    }

    if (msg.role === 'user') {
      const textParts = msg.content.filter((b) => b.type === 'text');
      const toolResults = msg.content.filter((b) => b.type === 'tool_result');

      for (const tr of toolResults) {
        result.push({
          role: 'tool',
          tool_call_id: tr.toolUseId,
          content: tr.content,
        });
      }

      if (textParts.length > 0) {
        result.push({
          role: 'user',
          content: textParts.map((b) => b.text).join('\n'),
        });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const toolCalls = msg.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          id: b.id,
          type: 'function' as const,
          function: {
            name: b.name,
            arguments: JSON.stringify(b.input),
          },
        }));

      result.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    }
  }

  return result;
}

function toOpenAITools(
  tools: ToolDefinition[],
): OpenAI.Chat.ChatCompletionTool[] | undefined {
  if (tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export function createOpenAIProvider(
  config: ProviderConfig,
  modelAlias: string,
): Provider {
  const modelConfig = config.models[modelAlias];
  if (!modelConfig) {
    throw new Error(`Model "${modelAlias}" not found in provider config`);
  }

  const client = new OpenAI({
    apiKey: config.api_key,
    ...(config.base_url ? { baseURL: config.base_url } : {}),
  });

  const supportsToolCalling = modelConfig.supports_tool_calling !== false;
  const supportsStreaming = modelConfig.supports_streaming !== false;
  const maxContextWindow = modelConfig.context_window ?? 128000;

  return {
    name: 'openai',
    supportsToolCalling,
    supportsStreaming,
    maxContextWindow,

    async *chat(
      messages: Message[],
      tools: ToolDefinition[],
      options: ProviderOptions,
    ): AsyncIterableIterator<StreamChunk> {
      const openaiMessages = toOpenAIMessages(messages, options.systemPrompt);
      const openaiTools = supportsToolCalling
        ? toOpenAITools(tools)
        : undefined;

      if (options.stream && supportsStreaming) {
        const stream = await client.chat.completions.create({
          model: modelConfig.id,
          messages: openaiMessages,
          tools: openaiTools,
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          stream: true,
          stream_options: { include_usage: true },
        });

        const toolCalls = new Map<
          number,
          { id: string; name: string; args: string }
        >();

        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta;

          if (delta?.content) {
            yield { type: 'text', text: delta.content };
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCalls.has(idx)) {
                toolCalls.set(idx, {
                  id: tc.id ?? '',
                  name: tc.function?.name ?? '',
                  args: '',
                });
              }
              const entry = toolCalls.get(idx)!;
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name = tc.function.name;
              if (tc.function?.arguments) {
                entry.args += tc.function.arguments;
                yield {
                  type: 'tool_call_delta',
                  toolCall: {
                    id: entry.id,
                    name: entry.name,
                    arguments: tc.function.arguments,
                  },
                };
              }
            }
          }

          if (chunk.usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: chunk.usage.prompt_tokens ?? 0,
                outputTokens: chunk.usage.completion_tokens ?? 0,
              },
            };
          }
        }

        for (const [, tc] of toolCalls) {
          yield {
            type: 'tool_call',
            toolCall: { id: tc.id, name: tc.name, arguments: tc.args },
          };
        }
      } else {
        const response = await client.chat.completions.create({
          model: modelConfig.id,
          messages: openaiMessages,
          tools: openaiTools,
          max_tokens: options.maxTokens,
          temperature: options.temperature,
        });

        const choice = response.choices[0];
        if (choice.message.content) {
          yield { type: 'text', text: choice.message.content };
        }

        if (choice.message.tool_calls) {
          for (const tc of choice.message.tool_calls) {
            yield {
              type: 'tool_call',
              toolCall: {
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            };
          }
        }

        if (response.usage) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens,
            },
          };
        }
      }

      yield { type: 'done' };
    },
  };
}
