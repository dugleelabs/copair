import { z } from 'zod';

export const ModelConfigSchema = z.object({
  id: z.string(),
  max_tokens: z.number().positive().optional(),
  context_window: z.number().positive().optional(),
  supports_tool_calling: z.boolean().optional(),
  supports_streaming: z.boolean().optional(),
  tool_call_format: z.enum(['dsml', 'qwen-xml', 'fenced-block']).optional(),
});

export const ProviderConfigSchema = z.object({
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
  type: z
    .enum(['anthropic', 'openai', 'google', 'openai-compatible'])
    .optional(),
  models: z.record(z.string(), ModelConfigSchema),
  /** Provider API call timeout in ms. Populated by config loader from network.provider_timeout_ms. */
  timeout_ms: z.number().int().positive().optional(),
});

export const PermissionsConfigSchema = z.object({
  mode: z.enum(['ask', 'auto-approve', 'deny']).default('ask'),
  allow_commands: z.array(z.string()).default([]),
  /** Glob patterns of paths outside the project root the agent may request access to. */
  allow_paths: z.array(z.string()).default([]),
  /**
   * Glob patterns unconditionally denied regardless of approval mode. When non-empty,
   * replaces the built-in deny list entirely. Leave empty to use built-in defaults.
   */
  deny_paths: z.array(z.string()).default([]),
});

export const FeatureFlagsSchema = z.object({
  model_routing: z.boolean().default(false),
});

export const McpServerConfigSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  /** Per-server tool call timeout in ms. Overrides the global default of 30s. */
  timeout_ms: z.number().int().positive().optional(),
  /**
   * When true, inherit the full process.env rather than the minimal safe set.
   * Default: false (principle of least privilege — FR-13).
   */
  inherit_env: z.boolean().optional(),
});

export const WebSearchConfigSchema = z.object({
  provider: z.enum(['tavily', 'serper', 'searxng']),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
  max_results: z.number().positive().default(5),
});

export const IdentityConfigSchema = z.object({
  name: z.string().default('Copair'),
  email: z.string().email().default('copair[bot]@noreply.dugleelabs.io'),
});

export const ContextConfigSchema = z.object({
  summarization_model: z.string().optional(),
  max_sessions: z.number().int().positive().default(1),
  knowledge_max_size: z.number().int().positive().default(8192),
});

export const KnowledgeConfigSchema = z.object({
  warn_size_kb: z.number().int().positive().default(8),
  max_size_kb: z.number().int().positive().default(16),
});

export const UIConfigSchema = z.object({
  bordered_input: z.boolean().default(true),
  status_bar: z.boolean().default(true),
  syntax_highlight: z.boolean().default(true),
  output_collapsing: z.boolean().default(true),
  vi_mode: z.boolean().default(false),
  suggestions: z.boolean().default(true),
  tab_completion: z.boolean().default(true),
});

export const SecurityConfigSchema = z.object({
  /** 'strict' denies all out-of-project paths; 'warn' allows but logs (testing only). */
  path_validation: z.enum(['strict', 'warn']).default('strict'),
  /** When true, also redact high-entropy base64-like strings from logs and tool output. */
  redact_high_entropy: z.boolean().default(false),
});

export const NetworkConfigSchema = z.object({
  /** Timeout for web search HTTP calls in milliseconds. */
  web_search_timeout_ms: z.number().int().positive().default(15_000),
  /** Timeout for provider API calls in milliseconds. */
  provider_timeout_ms: z.number().int().positive().default(120_000),
});

export const SmallModelsConfigSchema = z.object({
  /**
   * Per-model tier override map (model ID → tier). Wins over the built-in
   * `classifyModel()` classifier but loses to the `--small-model` /
   * `--no-small-model` CLI flag. Use to flag a custom fine-tune as small,
   * or to opt a known-small model out of the harness.
   *
   * **Backwards compatible with spec 029**: at config-load time, entries
   * here are folded into the top-level `model_overrides` field below as
   * `{ tier: 'small' | 'large' }`. If both fields are set for the same
   * model, `model_overrides` wins on conflict (it's the newer, more
   * expressive field).
   */
  tier_overrides: z.record(z.string(), z.enum(['small', 'large'])).optional(),
  /** Maximum number of tool calls permitted per agent turn for small models (default: 20). */
  max_tool_calls: z.number().int().positive().optional(),
});

/**
 * Per-model capability override (spec 029). All fields optional; deep-merged
 * onto the base capabilities derived by `getCapabilities()` from generic logic.
 *
 * Re-imported from `model-capabilities.ts` to keep the schema definition in
 * one place (the capabilities module owns the contract; config just references
 * it as a record value).
 */
import { ModelOverrideSchema } from '../core/model-capabilities.js';

export const CopairConfigSchema = z.object({
  version: z.number().int().positive(),
  default_model: z.string().optional(),
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  permissions: PermissionsConfigSchema.default(() => PermissionsConfigSchema.parse({})),
  feature_flags: FeatureFlagsSchema.default({ model_routing: false }),
  mcp_servers: z.array(McpServerConfigSchema).default([]),
  plugins: z.array(z.string()).optional().default([]),
  web_search: WebSearchConfigSchema.optional(),
  identity: IdentityConfigSchema.default({ name: 'Copair', email: 'copair[bot]@noreply.dugleelabs.io' }),
  context: ContextConfigSchema.default(() => ContextConfigSchema.parse({})),
  knowledge: KnowledgeConfigSchema.default(() => KnowledgeConfigSchema.parse({})),
  ui: UIConfigSchema.default(() => UIConfigSchema.parse({})),
  security: SecurityConfigSchema.optional(),
  network: NetworkConfigSchema.optional(),
  small_models: SmallModelsConfigSchema.optional(),
  /**
   * Per-model capability overrides (spec 029). Keys are normalized at
   * config-load time via `normalizeModelId` so users can write the model ID
   * in any host's form (Bedrock-prefixed, OpenRouter-prefixed, etc.) and
   * lookups resolve correctly. Deep-merged on top of base capabilities
   * derived by generic logic. See `docs/model-capabilities.md` for examples.
   */
  model_overrides: z.record(z.string(), ModelOverrideSchema).optional(),
});

export type CopairConfig = z.infer<typeof CopairConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type IdentityConfig = z.infer<typeof IdentityConfigSchema>;
export type ContextConfig = z.infer<typeof ContextConfigSchema>;
export type KnowledgeConfig = z.infer<typeof KnowledgeConfigSchema>;
export type UIConfig = z.infer<typeof UIConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type NetworkConfig = z.infer<typeof NetworkConfigSchema>;
export type SmallModelsConfig = z.infer<typeof SmallModelsConfigSchema>;
