import { parseArgs } from './cli/args.js';
import { Repl } from './cli/repl.js';
import { Agent } from './core/agent.js';
import { loadConfig } from './config/loader.js';
import {
  ProviderRegistry,
  createOpenAIProvider,
  createAnthropicProvider,
  createGoogleProvider,
  createOpenAICompatibleProvider,
} from './providers/index.js';
import { createDefaultToolRegistry } from './tools/index.js';
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

  // Find which provider has this model
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
  // Infer from name
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
  const registry = new ProviderRegistry();
  registry.register('openai', createOpenAIProvider);
  registry.register('anthropic', createAnthropicProvider);
  registry.register('google', createGoogleProvider);
  registry.register('openai-compatible', createOpenAICompatibleProvider);

  const providerType = getProviderType(providerName, providerConfig);
  const provider = registry.resolve(providerType, providerConfig, modelAlias);

  // Set up tools
  const toolRegistry = createDefaultToolRegistry();

  // Set up agent
  const agent = new Agent(provider, modelAlias, toolRegistry, {
    systemPrompt:
      'You are Copair, an AI coding assistant. Help the user with software development tasks. ' +
      'You have access to tools for reading, writing, and editing files, searching code, and running commands.',
  });

  // Set up REPL
  const repl = new Repl(
    {
      onMessage: async (input) => {
        await agent.handleMessage(input);
      },
      onSlashCommand: async (command, _args) => {
        switch (command) {
          case 'help':
            console.log('Available commands:');
            console.log('  /help    — Show this help');
            console.log('  /model   — Show current model');
            console.log('  /clear   — Clear conversation');
            console.log('  /exit    — Exit copair');
            break;
          case 'model':
            console.log(`Current model: ${agent.model}`);
            break;
          case 'clear':
            agent.getConversation().clear();
            console.log('Conversation cleared.');
            break;
          case 'exit':
          case 'quit':
            repl.stop();
            break;
          default:
            console.log(`Unknown command: /${command}. Type /help for available commands.`);
        }
      },
      onExit: async () => {
        console.log('\nGoodbye!');
      },
    },
    modelAlias,
  );

  await repl.start();
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
