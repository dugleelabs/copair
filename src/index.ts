import { parseArgs } from './cli/args.js';
import { Repl } from './cli/repl.js';
import { Agent } from './core/agent.js';
import { loadConfig } from './config/loader.js';
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

async function main() {
  const cliOpts = parseArgs();
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
  const provider = providerRegistry.resolve(providerType, providerConfig, modelAlias);

  // Set up tools
  const toolRegistry = createDefaultToolRegistry(config);

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

  // Detect git context
  const gitCtx = detectGitContext(process.cwd());

  // Set up agent
  const agent = new Agent(provider, modelAlias, toolRegistry, {
    systemPrompt:
      'You are Copair, an AI coding assistant. Help the user with software development tasks. ' +
      'You have access to tools for reading, writing, and editing files, searching code, and running commands.',
  });

  // Build agent context for commands
  const agentContext = {
    cwd: process.cwd(),
    model: modelAlias,
    branch: gitCtx.branch,
  };

  // Set up REPL first (needed for command runner ref)
  let replRef: Repl | null = null;

  // Command registry
  const cmdRegistry = new CommandRegistry();

  // Add workflow command with agent runner access
  const workflowCmd = createWorkflowCommand(
    async (prompt: string) => {
      await agent.handleMessage(prompt);
    },
    async (input: string) => {
      return cmdRegistry.execute(input, { ...agentContext, model: agent.model });
    },
  );
  // Will be registered after loadAll()

  await cmdRegistry.loadAll();
  // Register workflow command (overrides placeholder if any)
  (cmdRegistry as unknown as { commands: Map<string, unknown> }).commands.set(
    'workflow',
    workflowCmd,
  );

  // Set up REPL
  const repl = new Repl(
    {
      onMessage: async (input) => {
        await agent.handleMessage(input);
      },
      onSlashCommand: async (command, args) => {
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
              newProviderConfig,
              targetModel,
            );
            await agent.switchModel(newProvider, targetModel);
            agentContext.model = targetModel;
            console.log(`Switched to model: ${targetModel}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`Error switching model: ${msg}`);
          }
          return;
        }

        // Special handling for clear
        if (command === 'clear') {
          agent.getConversation().clear();
          console.log('Conversation cleared.');
          return;
        }

        // Special handling for exit/quit
        if (command === 'exit' || command === 'quit') {
          replRef?.stop();
          return;
        }

        const handled = await cmdRegistry.execute(fullInput, ctx);
        if (!handled) {
          console.log(`Unknown command: /${command}. Type /help for available commands.`);
        }
      },
      onExit: async () => {
        await mcpManager.shutdown();
        console.log('\nGoodbye!');
      },
    },
    modelAlias,
  );

  replRef = repl;
  await repl.start();
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
});
