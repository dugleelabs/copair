import type { Provider, ContentBlock, Message, ToolDefinition, StreamChunk } from '../providers/interface.js';
import { NATIVE_SEARCH_MARKER } from '../providers/interface.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolExecutor } from './tool-executor.js';
import { ConversationManager } from './conversation.js';
import { ContextWindowManager } from './context-window.js';
import { Renderer, formatToolCallFromInput } from '../cli/renderer.js';
import { logger } from './logger.js';
import { INJECTION_PREAMBLE, wrapFile, wrapToolResult } from './context-wrapper.js';

import type { ToolCallFormatter, ParsedToolCall } from './formats/interface.js';
import type { FormatName } from './formats/index.js';
import { resolveFormatter, buildStreamingFilter, StreamingMarkupFilter, parseWithStrictFallback } from './formats/index.js';
import { buildRepairMessage, MAX_REPAIR_RETRIES } from './formats/repair.js';
import type { AgentBridge } from '../cli/ui/agent-bridge.js';
import type { PluginManager } from './plugin-manager.js';
import type { SmallModelHarness } from './small-model-harness.js';
import { askUserTool } from '../tools/ask-user.js';
import { taskCompleteTool } from '../tools/task-complete.js';
import { LoopGuard } from './loop-guard.js';

export interface AgentOptions {
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  toolCallFormat?: FormatName;
  bridge?: AgentBridge;
  pluginManager?: PluginManager;
  /** Fraction of maxTokens at which to warn about context limit (0–1, default 0.9). */
  contextLimitThresholdPct?: number;
  harness?: SmallModelHarness;
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
  private pluginManager?: PluginManager;
  private harness?: SmallModelHarness;
  // Spec 029 F-13: detects repeated identical (tool, args, result) tuples and
  // halts the turn to prevent unbounded token spend. One per Agent instance.
  private loopGuard: LoopGuard;

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
    this.pluginManager = options.pluginManager;
    this.harness = options.harness;
    this.loopGuard = new LoopGuard();
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
    // Spec 029 F-13: fresh conversation turn = fresh loop-guard deque so
    // cross-message state doesn't leak (a deterministic tool returning the
    // same result across two unrelated user messages shouldn't trip).
    this.loopGuard.reset();

    const reminder = this.harness?.getPerTurnReminder();
    const formatHint = this.harness?.getFormatHint(this.formatter);
    const preamble = [formatHint, reminder].filter(Boolean).join('\n\n');
    const messageContent = preamble ? `${preamble}\n\n${userInput}` : userInput;
    this.conversation.appendText('user', messageContent);

    let totalUsage: { inputTokens: number; outputTokens: number } | null = null;
    let lastInputTokens = 0;
    // Plugin metadata — survives across hooks within the same turn
    const meta: Record<string, unknown> = {};
    // When true, the agent web search tool failed on the previous loop iteration.
    // On the next iteration, inject the provider's native search marker so the
    // model can fall back to the provider's built-in search capability.
    let agentWebSearchFailed = false;

    // Small model tool-call cap — Infinity for large models
    let toolCallCount = 0;
    const maxToolCalls = this.harness?.isSmallModel ? (this.harness.maxToolCalls) : Infinity;

    // Agent loop — keep calling provider until no more tool calls.
    // F-25: the streaming filter is reset inside `streamOnce` so
    // `suppressAfterMatch` (qwen-xml, dsml) scopes to one model response —
    // both the outer iteration AND the inner F-14 repair-retry stream get a
    // fresh filter.
    while (true) {
      const messages = await this.contextWindow.checkAndTruncate(
        this.conversation.getHistory(),
        this.provider,
      );

      const registryTools = this.toolRegistry.getAllDefinitions();
      // ask_user and task_complete are injected into the tool list for small models only.
      // They are intercepted in the loop below and never reach the executor.
      const allTools = this.harness?.isSmallModel
        ? [...registryTools, askUserTool.definition, taskCompleteTool.definition]
        : registryTools;

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

      const smallModelAddition = this.harness?.getSystemPromptAddition();
      const systemPrompt = [INJECTION_PREAMBLE, this.options.systemPrompt, smallModelAddition, toolSystemPrompt, webSearchHint]
        .filter(Boolean)
        .join('\n\n') || undefined;

      logger.debug('agent', `System prompt (${systemPrompt?.length ?? 0} chars): preamble=${systemPrompt?.includes('CONTEXT DATA') ?? false} knowledge=${systemPrompt?.includes('<knowledge') ?? false}`);

      // ── Plugin hooks: preRequest + provider intercept ──
      let activeProvider = this.provider;
      let activeMessages = messages;
      let activeTools = tools;
      let activeSystemPrompt = systemPrompt;

      if (this.pluginManager) {
        const preEvent = await this.pluginManager.preRequest({
          messages,
          tools,
          systemPrompt: systemPrompt ?? '',
          provider: this.provider,
          model: this._model,
          meta,
        });
        activeMessages = preEvent.messages;
        activeTools = preEvent.tools;
        activeSystemPrompt = preEvent.systemPrompt || undefined;

        activeProvider = this.pluginManager.interceptProvider({
          currentProvider: this.provider,
          model: this._model,
          messages: activeMessages,
          tokenCount: 0,
        });
      }

      const firstStream = await this.streamOnce(
        activeProvider,
        activeMessages,
        activeTools,
        activeSystemPrompt,
      );
      // `fullText` is reassigned by the F-14 repair loop below; the rest are not.
      let fullText = firstStream.fullText;
      const { nativeToolCalls, usage } = firstStream;

      if (usage) {
        lastInputTokens = usage.inputTokens;
        totalUsage = totalUsage
          ? {
              inputTokens: totalUsage.inputTokens + usage.inputTokens,
              outputTokens: totalUsage.outputTokens + usage.outputTokens,
            }
          : { ...usage };
      }

      // Strip native search markers — they are display-only; the provider already
      // handled the search server-side within this same streaming response.
      // The model's answer (incorporating search results) is in fullText.
      let nonNativeToolCalls = nativeToolCalls.filter(
        (tc) => tc.name !== NATIVE_SEARCH_MARKER,
      );

      let toolCalls: ParsedToolCall[] = nonNativeToolCalls;
      let cleanedText = fullText;
      let repairExhausted = false;
      if (fullText) {
        // Spec 029 F-14: tool-call format-error repair loop. Small models
        // occasionally emit malformed markup (unclosed tags, invalid JSON,
        // missing name fields). The repair loop asks the model to retry with
        // a structured `[SYSTEM]` nudge, capped at MAX_REPAIR_RETRIES per
        // assistant turn (design §20.3, NF-04 budget).
        //
        // Engagement policy: small-tier only. Large models with reliable
        // native tool calling rarely fail format, so we skip the extra parse
        // round-trip on their successful turns.
        if (this.harness?.isSmallModel) {
          let parseResult = parseWithStrictFallback(this.formatter, fullText);
          let repairAttempts = 0;
          while (
            !parseResult.ok &&
            nonNativeToolCalls.length === 0 &&
            repairAttempts < MAX_REPAIR_RETRIES
          ) {
            repairAttempts++;
            this.renderer.showFormatRepair(parseResult.error.specific_issue);
            // Inject as a user-role [SYSTEM] message, matching the loop-guard
            // nudge pattern in §19.2 — no new instance state.
            this.conversation.appendText('user', buildRepairMessage(parseResult.error));

            const reMessages = await this.contextWindow.checkAndTruncate(
              this.conversation.getHistory(),
              activeProvider,
            );
            const reStream = await this.streamOnce(
              activeProvider,
              reMessages,
              activeTools,
              activeSystemPrompt,
            );
            if (reStream.usage) {
              lastInputTokens = reStream.usage.inputTokens;
              totalUsage = totalUsage
                ? {
                    inputTokens: totalUsage.inputTokens + reStream.usage.inputTokens,
                    outputTokens: totalUsage.outputTokens + reStream.usage.outputTokens,
                  }
                : { ...reStream.usage };
            }
            fullText = reStream.fullText;
            cleanedText = reStream.fullText;
            // If the retry produced native tool calls, accept them and exit
            // the repair loop — the model recovered via the native channel.
            const retryNative = reStream.nativeToolCalls.filter(
              (tc) => tc.name !== NATIVE_SEARCH_MARKER,
            );
            if (retryNative.length > 0) {
              nonNativeToolCalls = retryNative;
              toolCalls = retryNative;
              parseResult = { ok: true, toolCalls: [], remainingText: reStream.fullText };
              break;
            }
            parseResult = parseWithStrictFallback(this.formatter, fullText);
          }

          if (!parseResult.ok) {
            this.renderer.showFormatRepairExhausted(parseResult.error);
            repairExhausted = true;
          } else if (parseResult.toolCalls.length > 0) {
            const nativeKeys = new Set(
              nonNativeToolCalls.map((tc) => `${tc.name}:${tc.arguments}`),
            );
            const uniqueParsed = parseResult.toolCalls.filter(
              (tc) => !nativeKeys.has(`${tc.name}:${tc.arguments}`),
            );
            toolCalls = [...nonNativeToolCalls, ...uniqueParsed];
            cleanedText = parseResult.remainingText;
          }
        } else {
          // Large-model legacy path — same behavior as before spec 029 F-14.
          // Some providers (e.g. DeepSeek) leak their native markup (DSML)
          // into text content even when using the OpenAI-compatible tool
          // calling API; we still merge any leaked calls with native calls.
          const parsed = this.formatter.parse(fullText);
          if (parsed.toolCalls.length > 0) {
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
      }

      if (repairExhausted) {
        // Format-repair retries exhausted — surface to user (already shown
        // via showFormatRepairExhausted) and break the outer iteration loop.
        break;
      }

      // ── Plugin hook: postRequest (observation only) ──
      if (this.pluginManager) {
        await this.pluginManager.postRequest({
          messages: activeMessages,
          response: {
            text: cleanedText ?? '',
            toolCalls: toolCalls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              input: JSON.parse(tc.arguments || '{}') as Record<string, unknown>,
            })),
            usage: usage ?? null,
          },
          provider: activeProvider,
          model: this._model,
          meta,
        });
      }

      // F-10: UNCLEAR: signal detection — only for small models
      if (this.harness?.isSmallModel && fullText) {
        const unclearMatches = fullText.match(/^UNCLEAR:\s+.+/gm);
        if (unclearMatches) {
          for (const line of unclearMatches) {
            this.renderer.showUnclearSignal(line.replace(/^UNCLEAR:\s+/, ''));
          }
        }
      }

      // F-05: Detect context limit (Qwen silent cutoff and threshold-based detection).
      // Placed after plugin hooks so observation-only hooks always fire.
      if (this.detectContextLimit(lastInputTokens, fullText, toolCalls)) {
        this.renderer.showContextLimitWarning();
        const action = await this.renderer.promptContextLimitAction();
        if (action === 'compact') {
          this.contextWindow.markForCompaction();
        }
        break;
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
      let taskCompleted = false;
      for (const tc of toolCalls) {
        toolCallCount++;

        // Small model max-turn guard
        if (toolCallCount > maxToolCalls) {
          this.renderer.showMaxTurnWarning(maxToolCalls);
          // Stub out remaining tool results so the API conversation stays valid
          for (let i = toolCalls.indexOf(tc); i < toolCalls.length; i++) {
            toolResults.push({
              type: 'tool_result',
              toolUseId: toolCalls[i].id,
              content: 'Aborted: maximum tool calls reached.',
              isError: true,
            });
          }
          denied = true;
          break;
        }

        const toolInput = JSON.parse(tc.arguments || '{}') as Record<string, unknown>;
        const label = formatToolCallFromInput(tc.name, toolInput);

        // Intercept ask_user: collect an answer from the user and inject as tool result
        if (tc.name === 'ask_user') {
          const question = String(toolInput.question ?? '');
          const answer = await this.collectUserAnswer(question);
          toolResults.push({
            type: 'tool_result',
            toolUseId: tc.id,
            content: answer,
          });
          continue;
        }

        // Intercept task_complete: signal done and break the outer loop
        if (tc.name === 'task_complete') {
          const summary = String(toolInput.summary ?? '');
          this.renderer.showTaskComplete(summary);
          // Stub out this and any remaining tool results
          toolResults.push({
            type: 'tool_result',
            toolUseId: tc.id,
            content: `Task marked complete: ${summary}`,
          });
          const currentIdx = toolCalls.indexOf(tc);
          for (let i = currentIdx + 1; i < toolCalls.length; i++) {
            toolResults.push({
              type: 'tool_result',
              toolUseId: toolCalls[i].id,
              content: 'Aborted: task_complete was called.',
              isError: true,
            });
          }
          taskCompleted = true;
          break;
        }

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

        // Spec 029 F-15b (§24 R-8): dispatch any overflow/truncation events
        // the tool surfaced. Tools stay renderer-free; the agent translates
        // declarative events into Renderer.show* calls (and spec 040 logger
        // sites once that ships).
        for (const ev of result.events ?? []) {
          switch (ev.kind) {
            case 'bash_truncated':
              this.renderer.showBashTruncated(ev.label, ev.originalTokens);
              break;
            case 'read_overflow':
              this.renderer.showReadOverflow(ev.filePath, ev.lineCount);
              break;
            case 'grep_overflow':
              this.renderer.showGrepOverflow(ev.pattern, ev.maxResults);
              break;
          }
        }

        // Spec 029 F-13: observe the (tool, args, result) tuple. The guard
        // hashes the raw result string (pre-context-wrapping) so that
        // wrapping artifacts can't mask a true repeat. On nudge, inject a
        // [SYSTEM] user-role message that the next iteration will see. On
        // halt, push a synthetic tool_result and break the outer loop via
        // the existing `denied` pattern used by the max-tool-calls guard.
        const guardAction = this.loopGuard.observe(tc.name, toolInput, result.content);
        if (guardAction.kind === 'halt') {
          this.renderer.showLoopHalt(guardAction.reason);
          toolResults.push({
            type: 'tool_result',
            toolUseId: tc.id,
            content: `[SYSTEM] ${guardAction.reason} Returning partial result.`,
            isError: true,
          });
          // Stub out any remaining tool results so the API conversation
          // stays valid (mirrors the max-tool-calls branch above).
          const currentIdx = toolCalls.indexOf(tc);
          for (let i = currentIdx + 1; i < toolCalls.length; i++) {
            toolResults.push({
              type: 'tool_result',
              toolUseId: toolCalls[i].id,
              content: 'Aborted: loop guard halted the turn.',
              isError: true,
            });
          }
          denied = true;
          break;
        }
        if (guardAction.kind === 'nudge') {
          this.renderer.showLoopNudge(guardAction.message);
          // Inject as a user-role message so the next iteration's provider
          // call surfaces it to the model. Piggybacks on the existing
          // conversation mechanism — no new instance state on Agent.
          this.conversation.appendText('user', `[SYSTEM] ${guardAction.message}`);
        }

        // Show rich output for tool results
        if (!result.isError) {
          if (tc.name === 'git') {
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

      // task_complete or max-turn exceeded — end the agent turn
      if (taskCompleted || denied) break;
    }

    return { usage: totalUsage, lastInputTokens };
  }

  /**
   * Spec 029 F-14 (design §20.3): wrap a single provider streaming call so
   * the same logic is callable from both the outer iteration loop AND the
   * inner format-repair retry loop. No new behavior over the previous
   * inline block — this is an extract-method refactor that makes re-streaming
   * with the same provider/tools/system-prompt straightforward.
   *
   * Resets the streaming markup filter at the top so `suppressAfterMatch`
   * formatters scope to a single response.
   */
  private async streamOnce(
    activeProvider: Provider,
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string | undefined,
  ): Promise<{
    fullText: string;
    nativeToolCalls: ParsedToolCall[];
    usage: { inputTokens: number; outputTokens: number } | null;
  }> {
    this.textFilter.reset();
    const stream: AsyncIterableIterator<StreamChunk> = activeProvider.chat(messages, tools, {
      model: this._model,
      stream: true,
      systemPrompt,
      maxTokens: this.options.maxTokens,
      temperature: this.options.temperature,
    });
    const { toolCalls, usage, fullText } = await this.renderer.render(stream, this.textFilter);
    return { fullText, nativeToolCalls: toolCalls, usage };
  }

  /** Prompt the user for input and return their answer (used by ask_user intercept). */
  private async collectUserAnswer(question: string): Promise<string> {
    process.stdout.write(`\n[copair] ${question}\n> `);
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.includes('\n')) {
          chunks.push(Buffer.from(text.split('\n')[0]));
          process.stdin.removeListener('data', onData);
          resolve(Buffer.concat(chunks).toString().trim());
        } else {
          chunks.push(chunk);
        }
      };
      process.stdin.once('readable', () => {
        process.stdin.on('data', onData);
      });
      // If stdin is already flowing, attach directly
      if (process.stdin.readableFlowing) {
        process.stdin.on('data', onData);
      } else {
        process.stdin.resume();
        process.stdin.on('data', onData);
      }
    });
  }

  /**
   * Detect whether the model likely hit its context limit this turn.
   * Two signals:
   *   1. Token threshold: input tokens ≥ contextLimitThresholdPct of maxTokens
   *   2. Truncation heuristic: text present, no tool calls, and response ends
   *      without terminal punctuation (sentence was cut off mid-stream)
   */
  private detectContextLimit(
    lastInputTokens: number,
    fullText: string,
    toolCalls: unknown[],
  ): boolean {
    const maxTokens = this.contextWindow.maxTokens;
    const threshold = this.options.contextLimitThresholdPct ?? 0.9;

    if (maxTokens > 0 && lastInputTokens >= maxTokens * threshold) {
      return true;
    }

    // Heuristic: text-only response (no tool calls) ending without punctuation.
    // Only applies to long responses (≥ 500 chars) — short completions that end with
    // a command name or list item are not truncated, just complete without punctuation.
    if (toolCalls.length === 0 && fullText.trim().length >= 500) {
      const trimmed = fullText.trimEnd();
      const lastChar = trimmed[trimmed.length - 1];
      if (lastChar && !/[.!?:;\n]/.test(lastChar)) {
        return true;
      }
    }

    return false;
  }
}
