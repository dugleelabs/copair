import Anthropic from '@anthropic-ai/sdk';
import type {
  Provider,
  Message,
  StreamChunk,
  ProviderOptions,
  ToolDefinition,
} from './interface.js';
import { NATIVE_SEARCH_MARKER } from './interface.js';
import type { ProviderConfig } from '../config/schema.js';

function toAnthropicMessages(
  messages: Message[],
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    const content: Anthropic.ContentBlockParam[] = [];
    for (const block of msg.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        content.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        });
      } else if (block.type === 'tool_result') {
        content.push({
          type: 'tool_result',
          tool_use_id: block.toolUseId,
          content: block.content,
          ...(block.isError ? { is_error: true } : {}),
        });
      }
    }

    result.push({
      role: msg.role as 'user' | 'assistant',
      content,
    });
  }

  return result;
}

interface ToAnthropicToolsResult {
  tools: Anthropic.Messages.Tool[] | undefined;
  /** Tool names that are handled server-side — no executor round-trip needed. */
  builtInToolNames: Set<string>;
}

function toAnthropicTools(
  tools: ToolDefinition[],
): ToAnthropicToolsResult {
  if (tools.length === 0) return { tools: undefined, builtInToolNames: new Set() };

  const builtInToolNames = new Set<string>();
  const converted = tools.map((t): Anthropic.Messages.Tool => {
    if (t.name === NATIVE_SEARCH_MARKER) {
      // Server-side built-in search — handled by Anthropic, no executor round-trip
      builtInToolNames.add('web_search');
      return {
        type: 'web_search_20250305',
        name: 'web_search',
      } as unknown as Anthropic.Messages.Tool;
    }
    return {
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    };
  });

  return { tools: converted, builtInToolNames };
}

export function createAnthropicProvider(
  config: ProviderConfig,
  modelAlias: string,
): Provider {
  const modelConfig = config.models[modelAlias];
  if (!modelConfig) {
    throw new Error(`Model "${modelAlias}" not found in provider config`);
  }

  const client = new Anthropic({
    apiKey: config.api_key,
    timeout: config.timeout_ms ?? 120_000,
    ...(config.base_url ? { baseURL: config.base_url } : {}),
  });

  const maxContextWindow = modelConfig.context_window ?? 200000;

  return {
    name: 'anthropic',
    supportsToolCalling: true,
    supportsStreaming: true,
    supportsNativeSearch: true,
    maxContextWindow,

    async *chat(
      messages: Message[],
      tools: ToolDefinition[],
      options: ProviderOptions,
    ): AsyncIterableIterator<StreamChunk> {
      const anthropicMessages = toAnthropicMessages(messages);
      const { tools: anthropicTools, builtInToolNames } = toAnthropicTools(tools);

      const systemPrompt =
        options.systemPrompt ??
        messages
          .filter((m) => m.role === 'system')
          .flatMap((m) => m.content.filter((b) => b.type === 'text'))
          .map((b) => b.text)
          .join('\n');

      if (options.stream) {
        const stream = client.messages.stream({
          model: modelConfig.id,
          messages: anthropicMessages,
          max_tokens: options.maxTokens ?? 8192,
          ...(options.temperature !== undefined
            ? { temperature: options.temperature }
            : {}),
          ...(systemPrompt ? { system: systemPrompt } : {}),
          ...(anthropicTools ? { tools: anthropicTools } : {}),
        });

        let currentToolId = '';
        let currentToolName = '';
        let currentToolArgs = '';

        for await (const event of stream) {
          if (
            event.type === 'content_block_start' &&
            event.content_block.type === 'tool_use'
          ) {
            currentToolId = event.content_block.id;
            currentToolName = event.content_block.name;
            currentToolArgs = '';
          }

          if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              yield { type: 'text', text: event.delta.text };
            } else if (event.delta.type === 'input_json_delta') {
              currentToolArgs += event.delta.partial_json;
              // Skip delta emission for server-side built-in tools (no executor needed)
              if (!builtInToolNames.has(currentToolName)) {
                yield {
                  type: 'tool_call_delta',
                  toolCall: {
                    id: currentToolId,
                    name: currentToolName,
                    arguments: event.delta.partial_json,
                  },
                };
              }
            }
          }

          if (
            event.type === 'content_block_stop' &&
            currentToolId &&
            currentToolName
          ) {
            if (builtInToolNames.has(currentToolName)) {
              // Server-side built-in tool — emit with the sentinel name so the agent
              // can display it in the spinner without running it through the executor.
              yield {
                type: 'tool_call',
                toolCall: {
                  id: currentToolId,
                  name: NATIVE_SEARCH_MARKER,
                  arguments: currentToolArgs,
                  metadata: { builtIn: true },
                },
              };
            } else {
              yield {
                type: 'tool_call',
                toolCall: {
                  id: currentToolId,
                  name: currentToolName,
                  arguments: currentToolArgs,
                },
              };
            }
            currentToolId = '';
            currentToolName = '';
            currentToolArgs = '';
          }

          if (event.type === 'message_delta' && event.usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: 0,
                outputTokens: event.usage.output_tokens,
              },
            };
          }
        }

        const finalMessage = await stream.finalMessage();
        if (finalMessage.usage) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: finalMessage.usage.input_tokens,
              outputTokens: finalMessage.usage.output_tokens,
            },
          };
        }
      } else {
        const response = await client.messages.create({
          model: modelConfig.id,
          messages: anthropicMessages,
          max_tokens: options.maxTokens ?? 8192,
          ...(options.temperature !== undefined
            ? { temperature: options.temperature }
            : {}),
          ...(systemPrompt ? { system: systemPrompt } : {}),
          ...(anthropicTools ? { tools: anthropicTools } : {}),
        });

        for (const block of response.content) {
          if (block.type === 'text') {
            yield { type: 'text', text: block.text };
          } else if (block.type === 'tool_use') {
            yield {
              type: 'tool_call',
              toolCall: {
                id: block.id,
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            };
          }
        }

        yield {
          type: 'usage',
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
        };
      }

      yield { type: 'done' };
    },
  };
}
