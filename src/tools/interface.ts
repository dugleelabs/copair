import type { ZodTypeAny } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Spec 029 F-15b / §24 R-8: declarative side-effects a tool can surface to the
 * agent loop. Keeps tools renderer-free — they emit events; the agent
 * dispatches each event to the matching `Renderer.show*` method (and the
 * future spec 040 logger). Optional and additive: existing tools that emit
 * no events continue to work unchanged.
 */
export type ToolEvent =
  | { kind: 'bash_truncated'; label: 'stdout' | 'stderr'; originalTokens: number }
  | { kind: 'read_overflow'; filePath: string; lineCount: number }
  | { kind: 'grep_overflow'; pattern: string; maxResults: number };

export interface ToolResult {
  content: string;
  isError?: boolean;
  /** Spec 029 F-15b: zero or more overflow/truncation events for the agent to dispatch. */
  events?: ToolEvent[];
}

export interface Tool {
  definition: ToolDefinition;
  /**
   * Zod schema for runtime validation of tool input before execution (FR-02).
   * Required for all built-in tools. MCP tools omit this field and receive
   * no schema validation (passthrough).
   */
  inputSchema?: ZodTypeAny;
  requiresPermission: boolean;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}
