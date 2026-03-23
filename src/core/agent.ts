import type { Provider, ContentBlock } from '../providers/interface.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolExecutor } from './tool-executor.js';
import { ConversationManager } from './conversation.js';
import { ContextWindowManager } from './context-window.js';
import { Renderer, formatToolCallFromInput } from '../cli/renderer.js';
import { buildToolSystemPrompt, parseToolCallsFromText } from './tool-fallback.js';
import type { ToolCallFormatter } from './formats/interface.js';
import type { FormatName } from './formats/index.js';
import { resolveFormatter, buildTextFilter } from './formats/index.js';
import type { AgentBridge } from '../cli/ui/agent-bridge.js';

export interface AgentOptions {
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  toolCallFormat?: FormatName;
  bridge?: AgentBridge;
}

export class Agent {
  private provider: Provider;
  private toolRegistry: ToolRegistry;
  private executor: ToolExecutor;
  private conversation: ConversationManager;
  private contextWindow: ContextWindowManager;
  private renderer: Renderer;
  private options: AgentOptions;
  private _model: string;
  private formatter: ToolCallFormatter;
  private textFilter: (text: string) => string;

  constructor(
    provider: Provider,
    model: string,
    toolRegistry: ToolRegistry,
    executor: ToolExecutor,
    options: AgentOptions = {},
  ) {
    this.provider = provider;
    this._model = model;
    this.toolRegistry = toolRegistry;
    this.executor = executor;
    this.conversation = new ConversationManager();
    this.contextWindow = new ContextWindowManager(provider.maxContextWindow);
    this.renderer = new Renderer(options.bridge);
    this.options = options;
    this.formatter = resolveFormatter(provider.name, model, options.toolCallFormat);
    this.textFilter = buildTextFilter(this.formatter);
  }

  get model(): string {
    return this._model;
  }

  getConversation(): ConversationManager {
    return this.conversation;
  }

  /**
   * Switch to a new provider/model mid-session.
   * Summarizes the conversation using the current model, then reinitializes.
   */
  async switchModel(newProvider: Provider, newModel: string): Promise<void> {
    const history = this.conversation.getHistory();
    if (history.length > 0) {
      // Summarize the current conversation using the current model
      const summaryPrompt = 'Summarize the conversation so far in a concise paragraph. Include key decisions, code changes, and context that would be needed to continue the work.';
      this.conversation.appendText('user', summaryPrompt);

      let summary = '';
      try {
        const stream = this.provider.chat(
          this.conversation.getHistory(),
          [],
          { model: this._model, stream: true, maxTokens: 1024 },
        );
        for await (const chunk of stream) {
          if (chunk.type === 'text') summary += chunk.text ?? '';
        }
      } catch {
        summary = 'Previous session context (summarization failed).';
      }

      // Start fresh conversation with summary injected
      this.conversation.clear();
      this.conversation.appendText(
        'user',
        `[Context from previous session with ${this._model}]\n${summary}`,
      );
      this.conversation.appendText(
        'assistant',
        'Understood. I have the context from the previous session and am ready to continue.',
      );

      process.stderr.write(`\n[agent] Switched to ${newModel}. Context summarized.\n`);
    }

    this.provider = newProvider;
    this._model = newModel;
    this.contextWindow = new ContextWindowManager(newProvider.maxContextWindow);
    this.formatter = resolveFormatter(newProvider.name, newModel, this.options.toolCallFormat);
    this.textFilter = buildTextFilter(this.formatter);
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

      const allTools = this.toolRegistry.getAllDefinitions();
      const tools = this.provider.supportsToolCalling ? allTools : [];

      // For non-tool-calling models, inject tool descriptions into the system prompt
      // using the resolved formatter for the current model
      const toolSystemPrompt =
        !this.provider.supportsToolCalling && allTools.length > 0
          ? this.formatter.buildSystemPrompt(allTools)
          : undefined;
      const systemPrompt = toolSystemPrompt
        ? [this.options.systemPrompt, toolSystemPrompt].filter(Boolean).join('\n\n')
        : this.options.systemPrompt;

      const stream = this.provider.chat(messages, tools, {
        model: this._model,
        stream: true,
        systemPrompt,
        maxTokens: this.options.maxTokens,
        temperature: this.options.temperature,
      });

      const { toolCalls: nativeToolCalls, usage, fullText } = await this.renderer.render(
        stream,
        this.textFilter,
      );

      // Parse tool invocations from text output using the resolved formatter.
      // Some providers (e.g. DeepSeek) leak their native markup (DSML) into
      // text content even when using the OpenAI-compatible tool calling API.
      // We check for leaked tool calls in text whenever text is present,
      // merging them with any native tool calls from the same response.
      let toolCalls = nativeToolCalls;
      let cleanedText = fullText;
      if (fullText) {
        const parsed = this.formatter.parse(fullText);
        if (parsed.toolCalls.length > 0) {
          // Deduplicate: skip parsed calls whose name+arguments match a native call
          const nativeKeys = new Set(
            nativeToolCalls.map((tc) => `${tc.name}:${tc.arguments}`),
          );
          const uniqueParsed = parsed.toolCalls.filter(
            (tc) => !nativeKeys.has(`${tc.name}:${tc.arguments}`),
          );
          toolCalls = [...nativeToolCalls, ...uniqueParsed];
          cleanedText = parsed.remainingText;
        }
      }



      if (usage) {
        totalUsage = totalUsage
          ? {
              inputTokens: totalUsage.inputTokens + usage.inputTokens,
              outputTokens: totalUsage.outputTokens + usage.outputTokens,
            }
          : { ...usage };
      }

      if (toolCalls.length === 0) {
        // Final text response — the text was already streamed by the renderer
        // If there's cleaned text (after removing markup), append it to conversation
        if (cleanedText && cleanedText.trim()) {
          this.conversation.appendText('assistant', cleanedText);
        }
        break;
      }

      // Append assistant message with tool calls
      const assistantContent: ContentBlock[] = toolCalls.map((tc) => ({
        type: 'tool_use' as const,
        id: tc.id,
        name: tc.name,
        input: JSON.parse(tc.arguments || '{}'),
        ...(tc.metadata ? { metadata: tc.metadata } : {}),
      }));
      this.conversation.append('assistant', assistantContent);

      // Execute each tool through the executor.
      // The executor calls the approval gate unconditionally — the agent
      // never interacts with the gate directly.
      //
      // If the user denies any operation, abort the entire turn — do not
      // execute remaining tools. The denial is final: return to REPL.
      const toolResults: ContentBlock[] = [];
      let denied = false;
      for (const tc of toolCalls) {
        const toolInput = JSON.parse(tc.arguments || '{}') as Record<string, unknown>;
        const label = formatToolCallFromInput(tc.name, toolInput);

        // Spinner starts only after the approval gate passes (via callback)
        // so it doesn't overlap with the approval prompt.
        let spinner: ReturnType<Renderer['startToolSpinner']> | null = null;

        const result = await this.executor.execute(tc.name, toolInput, () => {
          spinner = this.renderer.startToolSpinner(label);
        });

        // Stop spinner before showing the final state
        spinner?.stop();

        if (result.denied) {
          this.renderer.deniedToolExecution(label);

          // Append error tool_result for the denied tool
          toolResults.push({
            type: 'tool_result',
            toolUseId: tc.id,
            content: 'Denied by user.',
            isError: true,
          });

          // Append error tool_results for all remaining unexecuted tools
          // (API requires a tool_result for every tool_use in the assistant message)
          const currentIdx = toolCalls.indexOf(tc);
          for (let i = currentIdx + 1; i < toolCalls.length; i++) {
            toolResults.push({
              type: 'tool_result',
              toolUseId: toolCalls[i].id,
              content: 'Aborted: previous tool was denied by user.',
              isError: true,
            });
          }

          denied = true;
          break;
        }

        // Gate allowed — show completed with actual execution time
        this.renderer.completeToolExecution(label, result._durationMs ?? 0);

        // Show rich output for tool results
        if (!result.isError) {
          if (tc.name === 'edit' && toolInput.old_string && toolInput.new_string) {
            this.renderer.showDiff(
              String(toolInput.file_path ?? ''),
              String(toolInput.old_string),
              String(toolInput.new_string),
            );
          } else if (tc.name === 'write' && toolInput.content) {
            this.renderer.showDiff(
              String(toolInput.file_path ?? ''),
              null,
              String(toolInput.content),
            );
          } else if (tc.name === 'git') {
            const args = String(toolInput.args ?? '').trim();
            const sub = args.split(/\s+/)[0];
            if (sub === 'diff') {
              this.renderer.showGitDiff(result.content);
            }
          }
        }

        toolResults.push({
          type: 'tool_result',
          toolUseId: tc.id,
          content: result.content,
          isError: result.isError,
        });
      }

      // Always append tool results to keep conversation valid for the API.
      // Even on denial, every tool_use must have a matching tool_result.
      this.conversation.append('user', toolResults);

      // Denial aborts the entire agent turn — return to REPL immediately
      if (denied) break;
    }

    return { usage: totalUsage };
  }
}
