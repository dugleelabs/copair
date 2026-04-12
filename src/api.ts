/**
 * @dugleelabs/copair — Programmatic API
 *
 * Public surface for consumers (Pro edition, future plugins).
 * CLI users should use `dist/index.js` directly.
 */

// ── Plugin API ──
export type {
  CopairPlugin,
  PluginContext,
  PreRequestEvent,
  PostRequestEvent,
  ProviderInterceptEvent,
  PreToolCallEvent,
  PostToolCallEvent,
  SessionEvent,
} from './plugins/interface.js';
export { PluginManager } from './core/plugin-manager.js';

// ── Agent composition ──
export { Agent } from './core/agent.js';
export type { AgentOptions } from './core/agent.js';
export { SessionManager } from './core/session.js';
export { ToolExecutor } from './core/tool-executor.js';
export { ApprovalGate } from './core/approval-gate.js';

// ── Registries ──
export { ProviderRegistry } from './providers/registry.js';
export { ToolRegistry } from './tools/registry.js';

// ── Types (re-exports for DX) ──
export type { Provider, ProviderOptions, StreamChunk, Message, ToolDefinition } from './providers/interface.js';
export type { Tool, ToolResult } from './tools/interface.js';
export type { CopairConfig } from './config/schema.js';

// ── Bootstrap ──
export { bootstrapCLI, getVersionString } from './bootstrap.js';
export type { BootstrapOptions } from './bootstrap.js';
