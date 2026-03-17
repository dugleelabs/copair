import type { Provider } from './interface.js';
import type { ProviderConfig } from '../config/schema.js';
import { createOpenAIProvider } from './openai.js';

export function createOpenAICompatibleProvider(
  config: ProviderConfig,
  modelAlias: string,
): Provider {
  if (!config.base_url) {
    throw new Error(
      'OpenAI-compatible provider requires "base_url" in config (e.g., http://localhost:11434/v1)',
    );
  }

  const provider = createOpenAIProvider(config, modelAlias);

  // Override the name to distinguish from native OpenAI
  return {
    ...provider,
    name: 'openai-compatible',
    supportsToolCalling:
      config.models[modelAlias]?.supports_tool_calling ?? false,
    supportsStreaming:
      config.models[modelAlias]?.supports_streaming ?? true,
  };
}
