import type { Provider, ContentBlock } from '../providers/interface.js';
import type { ToolRegistry } from '../tools/registry.js';
import { ConversationManager } from './conversation.js';
import { ContextWindowManager } from './context-window.js';
import { Renderer } from '../cli/renderer.js';

export interface AgentOptions {
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export class Agent {
  private provider: Provider;
  private toolRegistry: ToolRegistry;
  private conversation: ConversationManager;
  private contextWindow: ContextWindowManager;
  private renderer: Renderer;
  private options: AgentOptions;
  private _model: string;

  constructor(
    provider: Provider,
    model: string,
    toolRegistry: ToolRegistry,
    options: AgentOptions = {},
  ) {
    this.provider = provider;
    this._model = model;
    this.toolRegistry = toolRegistry;
    this.conversation = new ConversationManager();
    this.contextWindow = new ContextWindowManager(provider.maxContextWindow);
    this.renderer = new Renderer();
    this.options = options;
  }

  get model(): string {
    return this._model;
  }

  getConversation(): ConversationManager {
    return this.conversation;
  }

  async handleMessage(userInput: string): Promise<{
    usage: { inputTokens: number; outputTokens: number } | null;
  }> {
    this.conversation.appendText('user', userInput);

    let totalUsage: { inputTokens: number; outputTokens: number } | null = null;

    // Agent loop — keep calling provider until no more tool calls
    while (true) {
      const messages = await this.contextWindow.checkAndTruncate(
        this.conversation.getHistory(),
        this.provider,
      );

      const tools = this.provider.supportsToolCalling
        ? this.toolRegistry.getAllDefinitions()
        : [];

      const stream = this.provider.chat(messages, tools, {
        model: this._model,
        stream: true,
        systemPrompt: this.options.systemPrompt,
        maxTokens: this.options.maxTokens,
        temperature: this.options.temperature,
      });

      const { toolCalls, usage } = await this.renderer.render(stream);

      if (usage) {
        totalUsage = totalUsage
          ? {
              inputTokens: totalUsage.inputTokens + usage.inputTokens,
              outputTokens: totalUsage.outputTokens + usage.outputTokens,
            }
          : { ...usage };
      }

      if (toolCalls.length === 0) {
        // Final text response — collect and append assistant message
        // The text was already streamed by the renderer
        // We need to reconstruct what was streamed
        break;
      }

      // Append assistant message with tool calls
      const assistantContent: ContentBlock[] = toolCalls.map((tc) => ({
        type: 'tool_use' as const,
        id: tc.id,
        name: tc.name,
        input: JSON.parse(tc.arguments || '{}'),
      }));
      this.conversation.append('assistant', assistantContent);

      // Execute each tool and collect results
      const toolResults: ContentBlock[] = [];
      for (const tc of toolCalls) {
        const tool = this.toolRegistry.get(tc.name);
        if (!tool) {
          toolResults.push({
            type: 'tool_result',
            toolUseId: tc.id,
            content: `Error: Unknown tool "${tc.name}"`,
            isError: true,
          });
          continue;
        }

        const toolInput = JSON.parse(tc.arguments || '{}');
        const result = await tool.execute(toolInput);
        toolResults.push({
          type: 'tool_result',
          toolUseId: tc.id,
          content: result.content,
          isError: result.isError,
        });
      }

      this.conversation.append('user', toolResults);
    }

    return { usage: totalUsage };
  }
}
