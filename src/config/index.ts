export {
  CopairConfigSchema,
  ProviderConfigSchema,
  ModelConfigSchema,
  PermissionsConfigSchema,
  FeatureFlagsSchema,
  McpServerConfigSchema,
  WebSearchConfigSchema,
} from './schema.js';
export type { CopairConfig, ProviderConfig, ModelConfig } from './schema.js';
export { loadConfig } from './loader.js';
