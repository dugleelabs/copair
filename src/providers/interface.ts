/**
 * Sentinel tool name injected by the agent when it wants the provider to fall
 * back to its built-in native search. Each provider translates this marker into
 * its own server-side search mechanism (e.g., Anthropic's web_search_20250305).
 */
export const NATIVE_SEARCH_MARKER = '_native_web_search';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: ContentBlock[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; metadata?: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_call_delta' | 'usage' | 'error' | 'done';
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
    metadata?: Record<string, unknown>;
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  error?: string;
}

export interface ProviderOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  stream: boolean;
}

export interface Provider {
  readonly name: string;
  readonly supportsToolCalling: boolean;
  readonly supportsStreaming: boolean;
  readonly maxContextWindow: number;
  /** When true, the provider can fall back to a built-in web search tool when the agent's configured web search fails. */
  readonly supportsNativeSearch?: boolean;

  chat(
    messages: Message[],
    tools: ToolDefinition[],
    options: ProviderOptions,
  ): AsyncIterableIterator<StreamChunk>;

  countTokens?(messages: Message[]): Promise<number>;
}

// Re-export ToolDefinition here to avoid circular deps — canonical definition in tools/interface.ts
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
