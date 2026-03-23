import { join } from 'node:path';
import { parseArgs } from './cli/args.js';
import { Agent } from './core/agent.js';
import { loadConfig, resolveEnvVarString } from './config/loader.js';
import { detectGitContext } from './core/git-context.js';
import {
  ProviderRegistry,
  createOpenAIProvider,
  createAnthropicProvider,
  createGoogleProvider,
  createOpenAICompatibleProvider,
} from './providers/index.js';
import { createDefaultToolRegistry } from './tools/index.js';
import { McpClientManager, McpBridge } from './mcp/index.js';
import { CommandRegistry } from './commands/index.js';
import { createWorkflowCommand } from './commands/builtins/workflow.js';
import { SessionManager, resolveSessionsDir, presentSessionPicker, warnIfSessionsTracked } from './core/session.js';
import { deriveIdentifier } from './core/session-identifier.js';
import { KnowledgeBase } from './core/knowledge-base.js';
import { setKnowledgeBase } from './tools/update-knowledge.js';
import { SessionSummarizer, resolveSummarizationModel } from './core/session-summarizer.js';
import { setSessionManagerRef } from './commands/builtins/session.js';
import { ensureProjectInit } from './core/init.js';
import { checkForUpdates } from './core/version-check.js';
import { ApprovalGate } from './core/approval-gate.js';
import { AgentBridge } from './cli/ui/agent-bridge.js';
import { renderApp, type AppHandle } from './cli/ui/app.js';
import { ToolExecutor } from './core/tool-executor.js';
import { loadAllowList } from './core/allow-list.js';
import { printBanner } from './cli/banner.js';
import { TokenTracker } from './core/token-tracker.js';
import { DEFAULT_PRICING } from './config/pricing.js';
import { resolveHistoryPath, loadHistory, appendHistory } from './cli/ui/input-history.js';
import { CompletionEngine, SlashCommandProvider, FilePathProvider } from './cli/ui/completion-providers.js';
import type { CopairConfig, ProviderConfig } from './config/schema.js';

function resolveModel(
  config: CopairConfig,
  modelOverride?: string,
): { providerName: string; modelAlias: string; providerConfig: ProviderConfig } {
  const modelAlias = modelOverride ?? config.default_model;
  if (!modelAlias) {
    throw new Error(
      'No model specified. Use --model <name> or set default_model in config.',
    );
  }

  for (const [providerName, providerConfig] of Object.entries(config.providers)) {
    if (modelAlias in providerConfig.models) {
      return { providerName, modelAlias, providerConfig };
    }
  }

  throw new Error(
    `Model "${modelAlias}" not found in any provider. Check your config.`,
  );
}

function resolveProviderConfig(config: ProviderConfig): ProviderConfig {
  if (!config.api_key) return config;
  return { ...config, api_key: resolveEnvVarString(config.api_key) };
}

function getProviderType(
  providerName: string,
  providerConfig: ProviderConfig,
): string {
  if (providerConfig.type) return providerConfig.type;
  if (providerName === 'anthropic') return 'anthropic';
  if (providerName === 'openai') return 'openai';
  if (providerName === 'google' || providerName === 'gemini') return 'google';
  return 'openai-compatible';
}

async function resumeSession(
  sessionManager: SessionManager,
  agent: Agent,
  sessionId: string,
): Promise<boolean> {
  const restored = await sessionManager.resume(sessionId);
  if (restored.summary) {
    // Use summary instead of full history to keep context small
    agent.getConversation().appendText(
      'system',
      `Resuming session "${restored.metadata.identifier}" from ${restored.metadata.lastActive}.\n\n` +
        `Session summary:\n${restored.summary}\n\nContinue from where we left off.`,
    );
  } else {
    for (const msg of restored.messages) {
      agent.getConversation().append(msg.role, msg.content);
    }
  }
  console.log(
    `Resumed session: ${restored.metadata.identifier} (${restored.messages.length} messages)`,
  );
  return true;
}

async function main() {
  const cliOpts = parseArgs();
  checkForUpdates(); // non-blocking background check
  const config = loadConfig();

  const { providerName, modelAlias, providerConfig } = resolveModel(
    config,
    cliOpts.model,
  );

  // Set up provider registry
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register('openai', createOpenAIProvider);
  providerRegistry.register('anthropic', createAnthropicProvider);
  providerRegistry.register('google', createGoogleProvider);
  providerRegistry.register('openai-compatible', createOpenAICompatibleProvider);

  const providerType = getProviderType(providerName, providerConfig);
  const provider = providerRegistry.resolve(providerType, resolveProviderConfig(providerConfig), modelAlias);

  // Set up tools
  const toolRegistry = createDefaultToolRegistry(config);
  const allowList = loadAllowList();
  const gate = new ApprovalGate(config.permissions.mode, allowList);
  const executor = new ToolExecutor(toolRegistry, gate);

  // Agent ↔ UI bridge — events flow through this once ink replaces readline (Phase 2)
  const agentBridge = new AgentBridge();
  gate.setBridge(agentBridge);

  // Deferred MCP initialization — starts after REPL is up
  const mcpManager = new McpClientManager();
  if (config.mcp_servers.length > 0) {
    setImmediate(async () => {
      try {
        await mcpManager.initialize(config.mcp_servers);
        const bridge = new McpBridge(mcpManager, toolRegistry);
        await bridge.registerAll();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[mcp] Failed to initialize MCP servers: ${msg}\n`);
      }
    });
  }

  // Auto-init .copair/ scaffolding on first launch
  const firstInit = ensureProjectInit(process.cwd());
  if (firstInit) {
    console.log('Initialized .copair/ for this project. Config: .copair.yaml');
  }

  // Trust .copair/ directory so scaffolding writes skip approval (even in deny mode)
  gate.addTrustedPath(join(process.cwd(), '.copair'));
  gate.addTrustedPath(join(process.cwd(), '.copair.yaml'));

  // Detect git context
  const gitCtx = detectGitContext(process.cwd());

  // Initialize knowledge base
  const knowledgeBase = new KnowledgeBase(process.cwd(), config.context.knowledge_max_size);
  setKnowledgeBase(knowledgeBase);
  const kbSection = knowledgeBase.getSystemPromptSection();

  // Set up agent (bridge connects renderer events to ink UI)
  const agent = new Agent(provider, modelAlias, toolRegistry, executor, {
    bridge: agentBridge,
    systemPrompt:
      'You are Copair, an AI coding assistant.\n\n' +
      `Environment:\n` +
      `- Working directory: ${process.cwd()}\n` +
      `- All file paths MUST be absolute (start with ${process.cwd()}/)\n\n` +
      'Context awareness:\n' +
      '- Your context includes this system prompt, the full conversation history (all prior messages in this session), and any project knowledge shown below.\n' +
      '- When asked about context, awareness, or what you know — answer from the conversation history and the knowledge section below. Do NOT read COPAIR_KNOWLEDGE.md or any other file to answer meta-questions about your own state.\n' +
      '- The knowledge base below (if present) was already loaded from COPAIR_KNOWLEDGE.md at startup. Use the update_knowledge tool only to ADD new entries, not to read existing ones.\n\n' +
      'Rules:\n' +
      '- You MUST use tools to perform actions. NEVER describe or narrate actions — execute them.\n' +
      '- NEVER simulate, roleplay, or pretend to run commands. If you need to do something, call the tool.\n' +
      '- Be brief. No preamble, no filler. No summaries between steps.\n' +
      '- If a tool returns an error, adjust your approach — do NOT repeat the same call.\n\n' +
      'Work habits:\n' +
      '- Read before editing. Keep changes minimal.\n' +
      '- Auto-commit each discrete feature, fix, or refactor. Do not batch unrelated changes.\n' +
      '- When you learn something project-specific (conventions, patterns, architectural decisions), use the update_knowledge tool to record it.\n\n' +
      'Git:\n' +
      '- Branches: <type>/<kebab-desc> (feat, fix, chore, docs, refactor, test, perf)\n' +
      '- Commits: <type>(<scope>): <imperative subject, max 72 chars>\n' +
      '  Body: 2-3 concise bullets. Co-authored-by is auto-appended.\n' +
      '- NEVER use --no-verify, --force, or --no-gpg-sign.' +
      kbSection,
  });

  // Initialize session manager
  const sessionManager = new SessionManager(process.cwd());
  const sessionsDir = resolveSessionsDir(process.cwd());

  // Git tracking warning
  warnIfSessionsTracked(process.cwd());

  // Migration check
  await SessionManager.migrateGlobalRecovery(sessionsDir, process.cwd());

  // Session cleanup
  await SessionManager.cleanup(sessionsDir, config.context.max_sessions);

  // Handle session resume — only consider the most recent session with history
  let sessionResumed = false;
  const sessions = await SessionManager.listSessions(sessionsDir);

  if (cliOpts.resume) {
    // --resume flag: find specific session
    let targetId: string | undefined;

    if (cliOpts.resume === true || cliOpts.resume === 'latest') {
      targetId = sessions[0]?.id;
    } else {
      const match = sessions.find(
        (s) => s.identifier === cliOpts.resume || s.id.startsWith(cliOpts.resume as string),
      );
      targetId = match?.id;
    }

    if (targetId) {
      sessionResumed = await resumeSession(sessionManager, agent, targetId);
    } else {
      console.log('No matching session found. Starting fresh.');
    }
  } else {
    // Auto-resume: only offer the most recent session if it has meaningful history
    const lastSession = sessions[0];
    if (lastSession && lastSession.messageCount >= 2) {
      const selectedId = await presentSessionPicker([lastSession]);
      if (selectedId) {
        sessionResumed = await resumeSession(sessionManager, agent, selectedId);
      }
    }
  }

  // Create new session if not resumed
  if (!sessionResumed) {
    await sessionManager.create(modelAlias, gitCtx.branch);
  }

  let identifierDerived = sessionResumed;

  // Wire session manager into /session command
  setSessionManagerRef(sessionManager);

  // Build agent context for commands
  const agentContext = {
    cwd: process.cwd(),
    model: modelAlias,
    branch: gitCtx.branch,
  };

  // Command registry
  const cmdRegistry = new CommandRegistry();

  // Add workflow command with agent runner access
  const workflowCmd = createWorkflowCommand(
    async (prompt: string) => {
      await agent.handleMessage(prompt);
    },
    async (input: string) => {
      const result = await cmdRegistry.execute(input, { ...agentContext, model: agent.model });
      if (result && result.prompt) {
        await agent.handleMessage(result.prompt);
      }
      return !!result;
    },
  );

  await cmdRegistry.loadAll();
  (cmdRegistry as unknown as { commands: Map<string, unknown> }).commands.set(
    'workflow',
    workflowCmd,
  );

  // Token tracking for usage stats
  const tokenTracker = new TokenTracker(DEFAULT_PRICING);

  // Input history
  const historyPath = resolveHistoryPath(process.cwd());
  const inputHistory = loadHistory(historyPath);

  // Tab completion engine
  const completionEngine = new CompletionEngine();
  // Get command names for slash completion
  const cmdNames = new Map<string, string>();
  const cmdMap = (cmdRegistry as unknown as { commands: Map<string, { description?: string }> }).commands;
  for (const [name, cmd] of cmdMap) {
    cmdNames.set(name, cmd.description ?? '');
  }
  // Add built-in commands
  cmdNames.set('exit', 'Exit copair');
  cmdNames.set('quit', 'Exit copair');
  cmdNames.set('clear', 'Clear conversation');
  cmdNames.set('model', 'Switch model');
  completionEngine.addProvider(new SlashCommandProvider(cmdNames));
  completionEngine.addProvider(new FilePathProvider(process.cwd()));

  // Banner is printed before ink takes over — ink will manage the terminal from here
  printBanner(modelAlias);
  // Small delay to let banner render before ink clears the screen
  await new Promise((r) => setTimeout(r, 50));

  // ── Exit handler ──────────────────────────────────────────────────────────
  let appHandle: AppHandle | null = null;

  const doExit = async () => {
    const messages = agent.getConversation().getHistory();
    let summarizer: SessionSummarizer | undefined;

    const resolved = await resolveSummarizationModel(
      config.context.summarization_model,
      agent.model,
    );
    if (resolved) {
      summarizer = new SessionSummarizer(provider, resolved.model);
    }

    await sessionManager.close(messages, summarizer);
    await mcpManager.shutdown();
    appHandle?.unmount();
    console.log('\nGoodbye!');
    process.exit(0);
  };

  // ── Render ink UI ─────────────────────────────────────────────────────────
  appHandle = renderApp(agentBridge, modelAlias, {
    sessionIdentifier: identifierDerived
      ? sessionManager.getMetadata()?.identifier
      : undefined,
    uiConfig: config.ui,
    history: inputHistory,
    completionEngine,
    onHistoryAppend: (entry: string) => {
      inputHistory.push(entry);
      appendHistory(historyPath, entry);
    },
    onMessage: async (input: string) => {
      const result = await agent.handleMessage(input);

      // Track token usage and emit to bridge for status bar
      if (result.usage) {
        tokenTracker.record(
          result.usage.inputTokens,
          result.usage.outputTokens,
          agent.model,
          '',
        );
        const summary = tokenTracker.getSessionSummary();
        agentBridge.emit('usage', {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cost: 0,
          sessionInputTokens: summary.totalInput,
          sessionOutputTokens: summary.totalOutput,
          sessionCost: summary.totalCost,
        });
      }

      // Signal turn complete so UI re-enables input
      agentBridge.emit('turn-complete');

      // Save session after each turn
      const messages = agent.getConversation().getHistory();
      await sessionManager.save(messages);

      // Derive identifier after first exchange (user + assistant)
      if (!identifierDerived && messages.length >= 2) {
        const meta = sessionManager.getMetadata();
        if (meta) {
          const identifier = deriveIdentifier(messages, meta.id, gitCtx.branch);
          sessionManager.updateIdentifier(identifier);
          await sessionManager.save(messages);
          appHandle?.updateSession(identifier);
          identifierDerived = true;
        }
      }
    },
    onSlashCommand: async (command: string, args?: string) => {
      const fullInput = args ? `${command} ${args}` : command;
      const ctx = { ...agentContext, model: agent.model };

      // Special handling for model switching
      if (command === 'model' && args) {
        const targetModel = args.trim();
        try {
          const {
            providerName: newProviderName,
            providerConfig: newProviderConfig,
          } = resolveModel(config, targetModel);
          const newProviderType = getProviderType(newProviderName, newProviderConfig);
          const newProvider = providerRegistry.resolve(
            newProviderType,
            resolveProviderConfig(newProviderConfig),
            targetModel,
          );
          await agent.switchModel(newProvider, targetModel);
          agentContext.model = targetModel;
          appHandle?.updateModel(targetModel);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          agentBridge.emit('error', `Error switching model: ${msg}`);
        }
        agentBridge.emit('turn-complete');
        return;
      }

      // Special handling for clear
      if (command === 'clear') {
        agent.getConversation().clear();
        agentBridge.emit('turn-complete');
        return;
      }

      // Special handling for exit/quit
      if (command === 'exit' || command === 'quit') {
        await doExit();
        return;
      }

      const result = await cmdRegistry.execute(fullInput, ctx);
      if (!result) {
        agentBridge.emit('error', `Unknown command: /${command}. Type /help for available commands.`);
      } else if (result.prompt) {
        await agent.handleMessage(result.prompt);
      }
      agentBridge.emit('turn-complete');
    },
  });

  // Wait for ink to exit (Ctrl+C handled by ink)
  await appHandle.waitForExit().then(doExit);
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
});
