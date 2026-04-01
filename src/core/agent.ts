import type { Provider, ContentBlock } from '../providers/interface.js';
import { NATIVE_SEARCH_MARKER } from '../providers/interface.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolExecutor } from './tool-executor.js';
import { ConversationManager } from './conversation.js';
import { ContextWindowManager } from './context-window.js';
import { Renderer, formatToolCallFromInput } from '../cli/renderer.js';
import { logger } from './logger.js';
import { INJECTION_PREAMBLE, wrapFile, wrapToolResult } from './context-wrapper.js';

import type { ToolCallFormatter } from './formats/interface.js';
import type { FormatName } from './formats/index.js';
import { resolveFormatter, buildStreamingFilter, StreamingMarkupFilter } from './formats/index.js';
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
  private textFilter: StreamingMarkupFilter;

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
    this.textFilter = buildStreamingFilter(this.formatter);
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
    this.textFilter = buildStreamingFilter(this.formatter);
  }

  async handleMessage(userInput: string): Promise<{
    usage: { inputTokens: number; outputTokens: number } | null;
    /** Input tokens from the last API call — reflects actual context window usage. */
    lastInputTokens: number;
  }> {
    this.conversation.appendText('user', userInput);

    let totalUsage: { inputTokens: number; outputTokens: number } | null = null;
    let lastInputTokens = 0;
    // When true, the agent web search tool failed on the previous loop iteration.
    // On the next iteration, inject the provider's native search marker so the
    // model can fall back to the provider's built-in search capability.
    let agentWebSearchFailed = false;

    // Agent loop — keep calling provider until no more tool calls
    while (true) {
      const messages = await this.contextWindow.checkAndTruncate(
        this.conversation.getHistory(),
        this.provider,
      );

      const allTools = this.toolRegistry.getAllDefinitions();

      // If the agent web search failed and the provider supports native search,
      // replace the `web_search` tool with the sentinel that triggers native fallback.
      let tools = this.provider.supportsToolCalling ? allTools : [];
      if (agentWebSearchFailed && this.provider.supportsNativeSearch) {
        logger.info('web_search', 'Falling back to provider native search (agent search unavailable)');
        tools = tools.map((t) =>
          t.name === 'web_search'
            ? { name: NATIVE_SEARCH_MARKER, description: t.description, inputSchema: t.inputSchema }
            : t,
        );
        // Reset flag — the fallback is a one-shot attempt per failed search
        agentWebSearchFailed = false;
      }

      // For non-tool-calling models, inject tool descriptions into the system prompt
      // using the resolved formatter for the current model
      const toolSystemPrompt =
        !this.provider.supportsToolCalling && allTools.length > 0
          ? this.formatter.buildSystemPrompt(allTools)
          : undefined;

      // For ALL providers: when the agent has web_search configured, tell the
      // model to call it instead of answering from training knowledge.
      // Native tool-calling models (e.g. Claude) receive no formatter prompt, so
      // without this hint they freely answer from training data.
      const webSearchHint = allTools.some((t) => t.name === 'web_search')
        ? 'When the user asks you to search the web, or requests current/up-to-date information, you MUST call the web_search tool. Never answer such queries from training knowledge alone — always invoke the tool and base your response on its results.'
        : undefined;

      const systemPrompt = [INJECTION_PREAMBLE, this.options.systemPrompt, toolSystemPrompt, webSearchHint]
        .filter(Boolean)
        .join('\n\n') || undefined;

      logger.debug('agent', `System prompt (${systemPrompt?.length ?? 0} chars): preamble=${systemPrompt?.includes('CONTEXT DATA') ?? false} knowledge=${systemPrompt?.includes('<knowledge') ?? false}`);

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
      // Strip native search markers — they are display-only; the provider already
      // handled the search server-side within this same streaming response.
      // The model's answer (incorporating search results) is in fullText.
      const nonNativeToolCalls = nativeToolCalls.filter(
        (tc) => tc.name !== NATIVE_SEARCH_MARKER,
      );

      let toolCalls = nonNativeToolCalls;
      let cleanedText = fullText;
      if (fullText) {
        const parsed = this.formatter.parse(fullText);
        if (parsed.toolCalls.length > 0) {
          // Deduplicate: skip parsed calls whose name+arguments match a native call
          const nativeKeys = new Set(
            nonNativeToolCalls.map((tc) => `${tc.name}:${tc.arguments}`),
          );
          const uniqueParsed = parsed.toolCalls.filter(
            (tc) => !nativeKeys.has(`${tc.name}:${tc.arguments}`),
          );
          toolCalls = [...nonNativeToolCalls, ...uniqueParsed];
          cleanedText = parsed.remainingText;
        }
      }



      if (usage) {
        lastInputTokens = usage.inputTokens;
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
        (spinner as ReturnType<Renderer['startToolSpinner']> | null)?.stop();

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

        // Track agent web search failures for native fallback on next loop iteration
        if (tc.name === 'web_search' && result.isError) {
          if (this.provider.supportsNativeSearch) {
            agentWebSearchFailed = true;
            logger.info('web_search', 'Agent web search failed — will fall back to provider native search on next turn');
          }
        } else if (tc.name === 'web_search' && !result.isError) {
          // Success — clear any previous failure flag
          agentWebSearchFailed = false;
        }

        // Wrap tool result content in XML context blocks so the injection preamble
        // can instruct the model to treat this content as inert data.
        // For the read tool, additionally wrap file content with wrapFile so the
        // path is visible and the content is clearly delimited.
        let resultContent = result.content;
        if (typeof resultContent === 'string') {
          if (tc.name === 'read' && typeof toolInput.file_path === 'string' && !result.isError) {
            resultContent = wrapToolResult(tc.name, wrapFile(toolInput.file_path, resultContent));
          } else {
            resultContent = wrapToolResult(tc.name, resultContent);
          }
        }

        toolResults.push({
          type: 'tool_result',
          toolUseId: tc.id,
          content: resultContent,
          isError: result.isError,
        });
      }

      // Always append tool results to keep conversation valid for the API.
      // Even on denial, every tool_use must have a matching tool_result.
      this.conversation.append('user', toolResults);

      // Denial aborts the entire agent turn — return to REPL immediately
      if (denied) break;
    }

    return { usage: totalUsage, lastInputTokens };
  }
}
