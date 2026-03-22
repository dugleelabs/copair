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
