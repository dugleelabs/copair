import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { GlobalInitManager } from './init/GlobalInitManager.js';
import { ProjectInitManager, DECLINED_MESSAGE } from './init/ProjectInitManager.js';
import { GitignoreManager } from './init/GitignoreManager.js';
import { KnowledgeManager } from './knowledge/KnowledgeManager.js';
import { KnowledgeSetupFlow } from './knowledge/KnowledgeSetupFlow.js';
import { isCI } from './utils/environmentUtils.js';
import { logger, LogLevel } from './core/logger.js';
import { AuditLog } from './core/audit-log.js';
import { runAuditCommand } from './cli/commands/audit.js';
import { PluginManager } from './core/plugin-manager.js';
import type { CopairPlugin } from './plugins/interface.js';
import { SmallModelHarness } from './core/small-model-harness.js';
import { readFromTty } from './cli/tty-prompt.js';

// ── Version helper ────────────────────────────────────────────────────────────

const _dir = dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);
const _pkg = (() => {
  for (const rel of ['../package.json', '../../package.json']) {
    try { return _require(resolve(_dir, rel)); } catch { /* skip */ }
  }
  return { version: process.env['COPAIR_VERSION'] ?? '0.0.0-dev' };
})();

export function getVersionString(): string {
  return `copair ${_pkg.version} (community)`;
}

// ── Bootstrap options ─────────────────────────────────────────────────────────

export interface BootstrapOptions {
  edition?: 'community' | 'pro';
  editionVersion?: string;
  plugins?: CopairPlugin[];
  argv?: string[];
}

// ── Helpers (moved from index.ts) ─────────────────────────────────────────────

function detectTestFramework(cwd: string): boolean {
  const patterns = [
    'vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs',
    'jest.config.ts', 'jest.config.js', 'jest.config.mjs',
  ];
  if (patterns.some((f) => existsSync(join(cwd, f)))) return true;
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    return Boolean(pkg.scripts?.test);
  } catch {
    return false;
  }
}

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

function resolveProviderConfig(config: ProviderConfig, timeoutMs?: number): ProviderConfig {
  const resolved = config.api_key
    ? { ...config, api_key: resolveEnvVarString(config.api_key) }
    : { ...config };
  if (timeoutMs !== undefined && resolved.timeout_ms === undefined) {
    resolved.timeout_ms = timeoutMs;
  }
  return resolved;
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

// ── Main bootstrap ────────────────────────────────────────────────────────────

export async function bootstrapCLI(options: BootstrapOptions = {}): Promise<void> {
  // ── Subcommand dispatch (before main REPL) ──
  const rawArgv = options.argv ?? process.argv;
  if (rawArgv[2] === 'audit') {
    await runAuditCommand(rawArgv.slice(3));
    return;
  }

  // Programmatic plugins can override the --version identifier (e.g. Pro edition).
  // First plugin declaring `versionIdentifier` wins; else fall back to community default.
  const versionString =
    options.plugins?.find((p) => p.versionIdentifier)?.versionIdentifier ??
    getVersionString();

  const cliOpts = parseArgs(options.argv, versionString);

  if (cliOpts.debug) {
    logger.setLevel(LogLevel.DEBUG);
  } else if (cliOpts.verbose) {
    logger.setLevel(LogLevel.INFO);
  }

  checkForUpdates(); // non-blocking background check

  const ci = isCI();
  const cwd = process.cwd();

  // ── Step 1: Global init (first-ever machine startup) ──────────────────────
  const globalInitManager = new GlobalInitManager();
  await globalInitManager.check({ ci });

  // ── Step 2: Project trust + init ──────────────────────────────────────────
  const projectInitManager = new ProjectInitManager();
  const projectInit = await projectInitManager.check(cwd, { ci });
  if (projectInit.declined) {
    console.log(DECLINED_MESSAGE);
    process.exit(0);
  }

  // ── Step 3: Gitignore (runs every startup — skips silently if covered) ────
  const gitignoreManager = new GitignoreManager();
  await gitignoreManager.ensureCovered(cwd, { ci });

  // ── Step 4: Config load ────────────────────────────────────────────────────
  const config = loadConfig();

  const { providerName, modelAlias, providerConfig } = resolveModel(
    config,
    cliOpts.model,
  );

  // ── Step 5: Plugin system ─────────────────────────────────────────────────
  const pluginManager = new PluginManager();

  // Register programmatic plugins first (e.g., from Pro)
  for (const plugin of options.plugins ?? []) {
    pluginManager.register(plugin);
  }

  // Load config-based plugins
  await pluginManager.loadFromConfig(config.plugins ?? []);

  // Set up provider registry
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register('openai', createOpenAIProvider);
  providerRegistry.register('anthropic', createAnthropicProvider);
  providerRegistry.register('google', createGoogleProvider);
  providerRegistry.register('openai-compatible', createOpenAICompatibleProvider);

  // Set up tools
  const toolRegistry = createDefaultToolRegistry(config);
  const allowList = loadAllowList();
  const gate = new ApprovalGate(config.permissions.mode, allowList);
  const executor = new ToolExecutor(toolRegistry, gate);

  // Initialize plugins (they can register custom providers/tools here)
  await pluginManager.initialize({
    config,
    providerRegistry,
    toolRegistry,
    version: _pkg.version,
    edition: options.edition ?? 'community',
  });

  const providerType = getProviderType(providerName, providerConfig);
  const provider = providerRegistry.resolve(providerType, resolveProviderConfig(providerConfig, config.network?.provider_timeout_ms), modelAlias);

  // Agent <-> UI bridge — events flow through this once ink replaces readline (Phase 2)
  const agentBridge = new AgentBridge();
  gate.setBridge(agentBridge);

  // MCP initialization is deferred until after the ink UI is mounted — see below.
  const mcpManager = new McpClientManager();

  // Trust .copair/ directory so scaffolding writes skip approval (even in deny mode)
  gate.addTrustedPath(join(cwd, '.copair'));

  // Detect git context
  const gitCtx = detectGitContext(cwd);

  // ── Step 6: Knowledge load + inject ───────────────────────────────────────
  const knowledgeManager = new KnowledgeManager({
    warn_size_kb: config.knowledge.warn_size_kb,
    max_size_kb: config.knowledge.max_size_kb,
  });
  const knowledgeResult = knowledgeManager.load(cwd);
  let knowledgePrefix = '';

  if (knowledgeResult.found && knowledgeResult.content) {
    knowledgeManager.checkSizeBudget(knowledgeResult.sizeBytes);
    knowledgePrefix = knowledgeManager.injectIntoSystemPrompt(knowledgeResult.content);
    logger.debug('knowledge', `Loaded COPAIR_KNOWLEDGE.md (${knowledgeResult.sizeBytes} bytes)`);
  } else if (!ci) {
    const setupFlow = new KnowledgeSetupFlow();
    const written = await setupFlow.run(cwd);
    if (written) {
      const refreshed = knowledgeManager.load(cwd);
      if (refreshed.found && refreshed.content) {
        knowledgeManager.checkSizeBudget(refreshed.sizeBytes);
        knowledgePrefix = knowledgeManager.injectIntoSystemPrompt(refreshed.content);
      }
    }
  }

  // Keep legacy KnowledgeBase for the update_knowledge tool (will be replaced in a follow-up)
  const knowledgeBase = new KnowledgeBase(cwd, config.context.knowledge_max_size);
  setKnowledgeBase(knowledgeBase);

  // Determine small-model mode: CLI flag overrides config; config overrides auto-detect
  const harness = new SmallModelHarness(
    modelAlias,
    config.small_models ?? {},
    cliOpts.smallModel,
  );

  // Set up agent (bridge connects renderer events to ink UI)
  const agent = new Agent(provider, modelAlias, toolRegistry, executor, {
    bridge: agentBridge,
    pluginManager,
    harness,
    systemPrompt:
      'You are Copair, an AI coding assistant.\n\n' +
      `Environment:\n` +
      `- Working directory: ${cwd}\n` +
      `- All file paths MUST be absolute (start with ${cwd}/)\n\n` +
      // [2] Knowledge block — injected before file context
      knowledgePrefix +
      'Context awareness:\n' +
      '- Your context includes this system prompt, the full conversation history (all prior messages in this session), and any project knowledge shown above in <knowledge> tags.\n' +
      '- When asked about context, awareness, or what you know — answer from the conversation history and the knowledge section. Do NOT read COPAIR_KNOWLEDGE.md to answer meta-questions about your own state.\n' +
      '- COPAIR_KNOWLEDGE.md is a navigation map, not a context dump. Never write ephemeral notes or session context into it. Propose targeted diffs only when structure, conventions, or entry points change.\n\n' +
      'Rules:\n' +
      '- You MUST use tools to perform actions. NEVER describe or narrate actions — execute them.\n' +
      '- NEVER simulate, roleplay, or pretend to run commands. If you need to do something, call the tool.\n' +
      '- Be brief. No preamble, no filler. No summaries between steps.\n' +
      '- If a tool returns an error, adjust your approach — do NOT repeat the same call.\n\n' +
      'Work habits:\n' +
      '- Read before editing. Keep changes minimal.\n' +
      '- Auto-commit each discrete feature, fix, or refactor. Do not batch unrelated changes.\n\n' +
      'Git:\n' +
      '- Branches: <type>/<kebab-desc> (feat, fix, chore, docs, refactor, test, perf)\n' +
      '- Commits: <type>(<scope>): <imperative subject, max 72 chars>\n' +
      '  Body: 2-3 concise bullets. Co-authored-by is auto-appended.\n' +
      '- NEVER use --no-verify, --force, or --no-gpg-sign.',
  });

  // Initialize session manager
  const sessionManager = new SessionManager(cwd);
  const sessionsDir = resolveSessionsDir(cwd);

  // Git tracking warning
  warnIfSessionsTracked(cwd);

  // Migration check
  await SessionManager.migrateGlobalRecovery(sessionsDir, cwd);

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
    // Cleanup again after creation so we never exceed max_sessions on disk
    await SessionManager.cleanup(sessionsDir, config.context.max_sessions);
  }

  // ── Audit log setup (P1) ──────────────────────────────────────────────────
  const auditLog = new AuditLog(sessionManager.getSessionDir());
  executor.setAuditLog(auditLog);
  gate.setAuditLog(auditLog);
  mcpManager.setAuditLog(auditLog);
  await auditLog.append({ event: 'session_start', outcome: 'allowed', detail: modelAlias });

  let identifierDerived = sessionResumed;

  // Wire session manager into /session command
  setSessionManagerRef(sessionManager);

  // Build agent context for commands
  const agentContext = {
    cwd,
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
    async (command: string) => gate.allow('bash', { command }),
  );

  await cmdRegistry.loadAll();
  (cmdRegistry as unknown as { commands: Map<string, unknown> }).commands.set(
    'workflow',
    workflowCmd,
  );

  // Token tracking for usage stats
  const tokenTracker = new TokenTracker(DEFAULT_PRICING);

  // Input history
  const historyPath = resolveHistoryPath(cwd);
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
  completionEngine.addProvider(new FilePathProvider(cwd));

  // Banner is printed before ink takes over — ink will manage the terminal from here
  printBanner(modelAlias, versionString);
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

    await auditLog.append({ event: 'session_end', outcome: 'allowed' });
    await sessionManager.close(messages, summarizer);
    await mcpManager.shutdown();
    await pluginManager.destroy();
    appHandle?.unmount();
    console.log('\nGoodbye!');
    process.exit(0);
  };

  // ── Render ink UI ─────────────────────────────────────────────────────────
  appHandle = renderApp(agentBridge, modelAlias, {
    sessionIdentifier: identifierDerived
      ? sessionManager.getMetadata()?.identifier
      : undefined,
    branch: gitCtx.branch ?? undefined,
    uiConfig: config.ui,
    history: inputHistory,
    completionEngine,
    initialContext: {
      hasTestFramework: detectTestFramework(cwd),
      sessionCount: 0,
    },
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
        const contextPercent = Math.min(
          100,
          Math.round(result.lastInputTokens / provider.maxContextWindow * 100),
        );
        agentBridge.emit('usage', {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cost: 0,
          sessionInputTokens: summary.totalInput,
          sessionOutputTokens: summary.totalOutput,
          sessionCost: summary.totalCost,
          contextPercent,
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

      const resolved = cmdRegistry.resolve(fullInput);
      if (!resolved) {
        agentBridge.emit('error', `Unknown command: /${command}. Type /help for available commands.`);
        agentBridge.emit('turn-complete');
        return;
      }

      const { command: cmd, args: cmdArgs } = resolved;
      const intake = await cmdRegistry.dispatchWithIntake(
        cmd,
        cmdArgs,
        ctx,
        harness.isSmallModel,
        async (prompt: string) => {
          // Bridge mode: use the input-request event; legacy mode: read from tty
          if (agentBridge.listenerCount('input-request') > 0) {
            return new Promise<string>((res) => {
              agentBridge.emit('input-request', res);
            });
          }
          process.stdout.write(`${prompt}: `);
          return readFromTty() ?? '';
        },
      );
      if (typeof intake === 'string' && intake) {
        await agent.handleMessage(intake);
      }
      agentBridge.emit('turn-complete');
    },
  });

  // ── MCP initialization (after ink is mounted — avoids racing session picker) ─
  if (config.mcp_servers.length > 0) {
    setImmediate(async () => {
      try {
        await mcpManager.initialize(config.mcp_servers);
        const bridge = new McpBridge(mcpManager, toolRegistry);
        await bridge.registerAll();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        agentBridge.emit('error', `[mcp] Failed to initialize MCP servers: ${msg}`);
      }
    });
  }

  // Wait for ink to exit (Ctrl+C handled by ink)
  await appHandle.waitForExit().then(doExit);
}
