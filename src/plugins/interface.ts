import type {
  Message,
  Provider,
  ToolDefinition,
} from '../providers/interface.js';
import type { CopairConfig } from '../config/schema.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ExecutionResult } from '../core/tool-executor.js';

// ── Plugin Context ──

export interface PluginContext {
  config: CopairConfig;
  providerRegistry: ProviderRegistry;
  toolRegistry: ToolRegistry;
  version: string;
  edition: 'community' | 'pro';
}

// ── P0 Hook Events ──

export interface PreRequestEvent {
  messages: Message[];
  tools: ToolDefinition[];
  systemPrompt: string;
  provider: Provider;
  model: string;
  /** Metadata plugins can attach — survives across hooks in the same turn */
  meta: Record<string, unknown>;
}

export interface PostRequestEvent {
  messages: Message[];
  response: {
    text: string;
    toolCalls: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }>;
    usage: { inputTokens: number; outputTokens: number } | null;
  };
  provider: Provider;
  model: string;
  meta: Record<string, unknown>;
}

export interface ProviderInterceptEvent {
  currentProvider: Provider;
  model: string;
  messages: Message[];
  tokenCount: number;
}

// ── P1 Hook Events (typed now, wired later) ──

export interface PreToolCallEvent {
  toolName: string;
  input: Record<string, unknown>;
  meta: Record<string, unknown>;
}

export interface PostToolCallEvent {
  toolName: string;
  input: Record<string, unknown>;
  result: ExecutionResult;
  meta: Record<string, unknown>;
}

export interface SessionEvent {
  sessionId: string;
  model: string;
  config: CopairConfig;
  type: 'create' | 'resume' | 'close';
}

// ── Plugin Interface ──

export interface CopairPlugin {
  /** Unique plugin name (e.g., 'copair-pro/demo') */
  name: string;

  /** Plugin version (informational, not enforced) */
  version: string;

  /**
   * Called once during bootstrap, after config is loaded.
   * Use for setup: register custom providers, tools, commands.
   */
  initialize?(context: PluginContext): Promise<void> | void;

  /**
   * Called before each LLM request.
   * Can modify messages, tools, or swap the provider.
   */
  preRequest?(
    event: PreRequestEvent,
  ): Promise<PreRequestEvent> | PreRequestEvent;

  /**
   * Called after each LLM response (full turn, after streaming completes).
   * Read-only observation point.
   */
  postRequest?(event: PostRequestEvent): Promise<void> | void;

  /**
   * Called before provider.chat() — can return a different provider.
   * This is the hook for smart model switching.
   */
  providerInterceptor?(event: ProviderInterceptEvent): Provider | undefined;

  // ── P1 hooks (added later) ──

  /** Called before a tool executes (after validation + approval) */
  preToolCall?(
    event: PreToolCallEvent,
  ): Promise<PreToolCallEvent> | PreToolCallEvent;

  /** Called after a tool executes */
  postToolCall?(event: PostToolCallEvent): Promise<void> | void;

  /** Called when a session starts or resumes */
  sessionStart?(event: SessionEvent): Promise<void> | void;

  /** Called when a session ends */
  sessionEnd?(event: SessionEvent): Promise<void> | void;

  /** Cleanup on shutdown */
  destroy?(): Promise<void> | void;
}
