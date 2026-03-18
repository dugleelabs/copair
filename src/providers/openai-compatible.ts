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

  // Local servers (Ollama, llama.cpp, etc.) don't require an API key.
  // The OpenAI SDK throws if apiKey is missing and OPENAI_API_KEY is unset,
  // so we provide a placeholder when no key is configured.
  const effectiveConfig = config.api_key
    ? config
    : { ...config, api_key: 'ollama' };

  const provider = createOpenAIProvider(effectiveConfig, modelAlias);

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
