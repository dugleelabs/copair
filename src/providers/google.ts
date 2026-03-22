import { GoogleGenAI, type Content, type FunctionDeclaration, type Part } from '@google/genai';
import type {
  Provider,
  Message,
  StreamChunk,
  ProviderOptions,
  ToolDefinition,
} from './interface.js';
import type { ProviderConfig } from '../config/schema.js';

function toGeminiContents(messages: Message[]): Content[] {
  const result: Content[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    const parts: Part[] = [];
    for (const block of msg.content) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'tool_use') {
        const part: Part = {
          functionCall: {
            name: block.name,
            args: block.input as Record<string, unknown>,
          },
        };
        // Preserve thought signature for Gemini 3.x models
        if (block.metadata?.thoughtSignature) {
          part.thoughtSignature = block.metadata.thoughtSignature as string;
        }
        parts.push(part);
      } else if (block.type === 'tool_result') {
        parts.push({
          functionResponse: {
            name: block.toolUseId,
            response: { result: block.content },
          },
        });
      }
    }

    result.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts,
    });
  }

  return result;
}

function toGeminiFunctionDeclarations(
  tools: ToolDefinition[],
): FunctionDeclaration[] | undefined {
  if (tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));
}

/**
 * Extract tool call metadata (thoughtSignature) from a Gemini Part.
 */
function extractMetadata(part: Part): Record<string, unknown> | undefined {
  if (part.thoughtSignature) {
    return { thoughtSignature: part.thoughtSignature };
  }
  return undefined;
}

export function createGoogleProvider(
  config: ProviderConfig,
  modelAlias: string,
): Provider {
  const modelConfig = config.models[modelAlias];
  if (!modelConfig) {
    throw new Error(`Model "${modelAlias}" not found in provider config`);
  }

  const client = new GoogleGenAI({ apiKey: config.api_key ?? '' });
  const maxContextWindow = modelConfig.context_window ?? 1000000;

  return {
    name: 'google',
    supportsToolCalling: true,
    supportsStreaming: true,
    maxContextWindow,

    async *chat(
      messages: Message[],
      tools: ToolDefinition[],
      options: ProviderOptions,
    ): AsyncIterableIterator<StreamChunk> {
      const contents = toGeminiContents(messages);
      const functionDeclarations = toGeminiFunctionDeclarations(tools);

      const config: Record<string, unknown> = {};
      if (options.maxTokens) config.maxOutputTokens = options.maxTokens;
      if (options.temperature !== undefined) config.temperature = options.temperature;
      if (options.systemPrompt) config.systemInstruction = options.systemPrompt;
      if (functionDeclarations) {
        config.tools = [{ functionDeclarations }];
      }

      if (options.stream) {
        const response = await client.models.generateContentStream({
          model: modelConfig.id,
          contents,
          config,
        });

        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        for await (const chunk of response) {
          // Access parts directly to avoid the SDK's .text getter which
          // logs a warning when functionCall parts coexist with text parts.
          const parts = chunk.candidates?.[0]?.content?.parts ?? [];

          for (const part of parts) {
            if (typeof part.text === 'string' && part.text && !part.thought) {
              yield { type: 'text', text: part.text };
            } else if (part.functionCall) {
              const metadata = extractMetadata(part);
              yield {
                type: 'tool_call',
                toolCall: {
                  id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  name: part.functionCall.name ?? '',
                  arguments: JSON.stringify(part.functionCall.args ?? {}),
                  ...(metadata ? { metadata } : {}),
                },
              };
            }
          }

          if (chunk.usageMetadata) {
            totalInputTokens = chunk.usageMetadata.promptTokenCount ?? 0;
            totalOutputTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
          }
        }

        yield {
          type: 'usage',
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
        };
      } else {
        const response = await client.models.generateContent({
          model: modelConfig.id,
          contents,
          config,
        });

        const parts = response.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (typeof part.text === 'string' && part.text && !part.thought) {
            yield { type: 'text', text: part.text };
          } else if (part.functionCall) {
            const metadata = extractMetadata(part);
            yield {
              type: 'tool_call',
              toolCall: {
                id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: part.functionCall.name ?? '',
                arguments: JSON.stringify(part.functionCall.args ?? {}),
                ...(metadata ? { metadata } : {}),
              },
            };
          }
        }

        if (response.usageMetadata) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: response.usageMetadata.promptTokenCount ?? 0,
              outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
            },
          };
        }
      }

      yield { type: 'done' };
    },
  };
}
