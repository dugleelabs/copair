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
});

export const PermissionsConfigSchema = z.object({
  mode: z.enum(['ask', 'auto-approve', 'deny']).default('ask'),
  allow_commands: z.array(z.string()).default([]),
});

export const FeatureFlagsSchema = z.object({
  model_routing: z.boolean().default(false),
});

export const McpServerConfigSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
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

export const CopairConfigSchema = z.object({
  version: z.number().int().positive(),
  default_model: z.string().optional(),
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  permissions: PermissionsConfigSchema.default({ mode: 'ask', allow_commands: [] }),
  feature_flags: FeatureFlagsSchema.default({ model_routing: false }),
  mcp_servers: z.array(McpServerConfigSchema).default([]),
  web_search: WebSearchConfigSchema.optional(),
  identity: IdentityConfigSchema.default({ name: 'Copair', email: 'copair[bot]@noreply.dugleelabs.io' }),
});

export type CopairConfig = z.infer<typeof CopairConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type IdentityConfig = z.infer<typeof IdentityConfigSchema>;
