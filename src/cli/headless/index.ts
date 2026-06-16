/**
 * Headless mode — bootstrap entry (spec 047, T-05).
 *
 * `runHeadlessCommand` is the non-interactive counterpart to the REPL bootstrap.
 * It resolves a task, builds the agent stack WITHOUT ink/readline/TTY, runs a
 * single `agent.handleMessage`, then writes the result JSON to stdout and an
 * optional mechanism-event JSONL stream to `--events`.
 *
 * IMPORT ISOLATION (US-4 / design §11): this module — and everything under
 * `src/cli/headless/` — must not import ink, React, readline, or
 * `src/cli/tty-prompt.ts`. It reuses ONLY core construction (agent, config,
 * provider, capabilities, session, token-tracker, agent-bridge). Helpers that
 * live in `bootstrap.ts` are deliberately re-implemented here because
 * `bootstrap.ts` pulls in the ink app.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CliOptions } from '../args.js';
import { loadConfigWithSources, resolveEnvVarString } from '../../config/loader.js';
import type { CopairConfig, ProviderConfig } from '../../config/schema.js';
import { Agent } from '../../core/agent.js';
import { getCapabilities, UnknownModelError } from '../../core/model-capabilities.js';
import {
  ProviderRegistry,
  createOpenAIProvider,
  createAnthropicProvider,
  createGoogleProvider,
  createOpenAICompatibleProvider,
} from '../../providers/index.js';
import { createDefaultToolRegistry } from '../../tools/index.js';
import { ApprovalGate } from '../../core/approval-gate.js';
import { ToolExecutor } from '../../core/tool-executor.js';
import { loadAllowList } from '../../core/allow-list.js';
import { TokenTracker } from '../../core/token-tracker.js';
import { DEFAULT_PRICING } from '../../config/pricing.js';
import { AgentBridge } from '../ui/agent-bridge.js';
import { SmallModelHarness } from '../../core/small-model-harness.js';
import { SessionManager } from '../../core/session.js';
import { AuditLog } from '../../core/audit-log.js';
import { resolveFormatter } from '../../core/formats/index.js';
import { detectGitContext } from '../../core/git-context.js';

import {
  ApprovalTracker,
  installApprovalHandler,
  installNoHangPromptHandlers,
} from './approval.js';
import { EventSink } from './events.js';
import { HeadlessReporter } from './reporter.js';
import type { AgentTerminationReason } from '../../core/agent.js';
import type { Formatter, ResolvedConfig, TaskSource, Tier } from './schema.js';

// ── Local construction helpers (re-implemented from bootstrap.ts to keep the
//    headless path free of ink imports) ─────────────────────────────────────

function resolveModel(
  config: CopairConfig,
  modelOverride?: string,
): { providerName: string; modelAlias: string; providerConfig: ProviderConfig } {
  const modelAlias = modelOverride ?? config.default_model;
  if (!modelAlias) {
    throw new Error('No model specified. Use --model <name> or set default_model in config.');
  }
  for (const [providerName, providerConfig] of Object.entries(config.providers)) {
    if (modelAlias in providerConfig.models) {
      return { providerName, modelAlias, providerConfig };
    }
  }
  throw new Error(`Model "${modelAlias}" not found in any provider. Check your config.`);
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

function getProviderType(providerName: string, providerConfig: ProviderConfig): string {
  if (providerConfig.type) return providerConfig.type;
  if (providerName === 'anthropic') return 'anthropic';
  if (providerName === 'openai') return 'openai';
  if (providerName === 'google' || providerName === 'gemini') return 'google';
  return 'openai-compatible';
}

// ── Task-source resolution ───────────────────────────────────────────────────

/** Read all of stdin synchronously when it is piped (not a TTY). Empty otherwise. */
function readStdin(): string {
  if (process.stdin.isTTY) return '';
  try {
    return readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

function resolveTask(cliOpts: CliOptions): { task: string; source: TaskSource } | null {
  // Precedence: positional task → -f file → stdin.
  if (cliOpts.task && cliOpts.task.trim()) {
    return { task: cliOpts.task, source: 'arg' };
  }
  if (cliOpts.file) {
    const contents = readFileSync(cliOpts.file, 'utf-8');
    if (contents.trim()) return { task: contents, source: 'file' };
  }
  const stdin = readStdin();
  if (stdin.trim()) return { task: stdin, source: 'stdin' };
  return null;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function runHeadlessCommand(cliOpts: CliOptions): Promise<void> {
  // 1. Apply --cwd before anything resolves relative paths.
  if (cliOpts.cwd) {
    try {
      process.chdir(cliOpts.cwd);
    } catch (err) {
      process.stderr.write(`--cwd: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  }
  const cwd = process.cwd();

  // 2. Resolve the task source. An empty run is never started.
  const resolvedTask = resolveTask(cliOpts);
  if (!resolvedTask) {
    process.stderr.write(
      'No task provided. Pass a task argument, --file <path>, or pipe one via stdin.\n',
    );
    process.exit(1);
  }
  const { task, source: taskSource } = resolvedTask;

  // 3. Load config (isolated honors --isolated; -c honored as the explicit path).
  //    A config/provider error here is a pre-result failure → exit 1 with no
  //    result document.
  let config: CopairConfig;
  let configSources: string[];
  try {
    const loaded = loadConfigWithSources({
      projectDir: cwd,
      isolated: cliOpts.isolated,
      explicitConfigPath: cliOpts.config,
    });
    config = loaded.config;
    configSources = loaded.sources;
  } catch (err) {
    process.stderr.write(`Config error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  // 4. Resolve model + provider. Strict-unknown models fail before any state.
  let modelAlias: string;
  let provider: ReturnType<ProviderRegistry['resolve']>;
  try {
    const resolved = resolveModel(config, cliOpts.model);
    modelAlias = resolved.modelAlias;
    getCapabilities(modelAlias); // strict-unknowns guard (spec 029 §17.5)

    const providerRegistry = new ProviderRegistry();
    providerRegistry.register('openai', createOpenAIProvider);
    providerRegistry.register('anthropic', createAnthropicProvider);
    providerRegistry.register('google', createGoogleProvider);
    providerRegistry.register('openai-compatible', createOpenAICompatibleProvider);

    const providerType = getProviderType(resolved.providerName, resolved.providerConfig);
    provider = providerRegistry.resolve(
      providerType,
      resolveProviderConfig(resolved.providerConfig, config.network?.provider_timeout_ms),
      modelAlias,
    );
  } catch (err) {
    if (err instanceof UnknownModelError) {
      process.stderr.write(err.message + '\n');
    } else {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    }
    process.exit(1);
  }

  // 5. Tools, approval gate (deny mode — headless never prompts), executor.
  const toolRegistry = createDefaultToolRegistry(config);
  const allowList = loadAllowList();
  // Gate mode 'deny' is irrelevant once our handler answers every request, but
  // keeps the config-driven mode out of the headless decision: the approval
  // handler is the single policy point (T-08).
  const gate = new ApprovalGate(config.permissions.mode, allowList);
  const executor = new ToolExecutor(toolRegistry, gate);

  const bridge = new AgentBridge();
  gate.setBridge(bridge);
  gate.addTrustedPath(join(cwd, '.copair'));

  // 6. Harness + per-feature toggles (T-11). force_format threads into the
  //    formatter override below.
  const harness = new SmallModelHarness(modelAlias, config.small_models ?? {}, cliOpts.smallModel);

  // 7. Session + audit log (a session id is required by the result schema).
  const gitCtx = detectGitContext(cwd);
  const sessionManager = new SessionManager(cwd);
  const sessionMeta = await sessionManager.create(modelAlias, gitCtx.branch);
  const auditLog = new AuditLog(sessionManager.getSessionDir());
  executor.setAuditLog(auditLog);
  gate.setAuditLog(auditLog);
  await auditLog.append({ event: 'session_start', outcome: 'allowed', detail: modelAlias });

  // 8. Token tracker.
  const tokenTracker = new TokenTracker(DEFAULT_PRICING);

  // 9. Agent. force_format (T-11) overrides the capability-resolved formatter.
  const forceFormat = config.small_models?.force_format;
  const agent = new Agent(provider, modelAlias, toolRegistry, executor, {
    bridge,
    harness,
    toolCallFormat: forceFormat,
    maxToolCallsOverride: cliOpts.maxToolCalls,
    maxTokensBudget: cliOpts.maxTokens,
    systemPrompt:
      'You are Copair, an AI coding assistant.\n\n' +
      `Environment:\n` +
      `- Working directory: ${cwd}\n` +
      `- All file paths MUST be absolute (start with ${cwd}/)\n\n` +
      'Rules:\n' +
      '- You MUST use tools to perform actions. NEVER describe or narrate actions — execute them.\n' +
      '- NEVER simulate, roleplay, or pretend to run commands. If you need to do something, call the tool.\n' +
      '- Be brief. No preamble, no filler. No summaries between steps.\n' +
      '- If a tool returns an error, adjust your approach — do NOT repeat the same call.',
  });

  // 10. Resolved-config snapshot for the result JSON.
  const caps = getCapabilities(modelAlias);
  const effectiveFormatter = resolveFormatter(provider.name, modelAlias, forceFormat);
  // Native tool-calling models route through provider SDKs, not a text
  // formatter; report 'native' so 048 reads the right validity denominator.
  const formatter: Formatter = provider.supportsToolCalling
    ? 'native'
    : (effectiveFormatter.name as Formatter);

  const resolvedConfig: ResolvedConfig = {
    model: modelAlias,
    provider: provider.name,
    tier: (harness.isSmallModel ? 'small' : caps.tier) as Tier,
    formatter,
    toggles: {
      loop_guard: harness.enableLoopGuard,
      format_repair: harness.enableFormatRepair,
      inspect_before_act: harness.enableInspectBeforeAct,
      // Truncation is always on (no per-run toggle in Phase 1); reported true.
      truncation: true,
    },
    permissions: cliOpts.autoApprove ? 'headless-auto-approve' : 'headless-terminate',
    limits: {
      max_tool_calls: cliOpts.maxToolCalls ?? null,
      max_tokens: cliOpts.maxTokens ?? null,
    },
    config_sources: configSources,
  };

  // 11. Wire bridge subscribers — NO ink. Events sink (optional), approval
  //     policy, no-hang prompt handlers, and the reporter.
  const eventSink = cliOpts.events ? new EventSink(cliOpts.events) : null;
  eventSink?.attach(bridge);

  const approvalTracker = new ApprovalTracker();
  installApprovalHandler(bridge, approvalTracker, {
    autoApprove: cliOpts.autoApprove,
    onApprovalRequired: (tool) => eventSink?.approvalRequired(tool),
  });
  installNoHangPromptHandlers(bridge);

  const reporter = new HeadlessReporter(bridge, {
    tokenTracker,
    resolvedConfig,
    taskSource,
    cwd,
    sessionId: sessionMeta.id,
    eventsFile: cliOpts.events ?? null,
    quiet: cliOpts.quiet,
  });

  // 12. Run the single turn. Record usage into the tracker exactly as the REPL
  //     does. A thrown error → termination 'error'; the result is still written.
  let internalReason: AgentTerminationReason | null = null;
  let runError: Error | null = null;
  try {
    const result = await agent.handleMessage(task);
    internalReason = result.terminationReason;
    if (result.usage) {
      tokenTracker.record(result.usage.inputTokens, result.usage.outputTokens, modelAlias, '');
    }
  } catch (err) {
    runError = err instanceof Error ? err : new Error(String(err));
  }

  // 13. Emit the result JSON (stdout) and close the event stream.
  const publicReason = reporter.finish(internalReason, runError).termination_reason;
  eventSink?.runTerminated(publicReason);

  // Best-effort session/audit close — never fail the run on cleanup.
  try {
    await auditLog.append({ event: 'session_end', outcome: 'allowed' });
    await sessionManager.save(agent.getConversation().getHistory());
  } catch {
    /* ignore cleanup errors */
  }

  // 14. Exit code: 0 once a result was emitted (even on agent error — the JSON
  //     carries the error). Pre-result failures already exited 1 above.
  process.exit(0);
}
