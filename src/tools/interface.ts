import type { ZodTypeAny } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * spec 029 (F-15b): declarative side-effects a tool surfaces to the agent loop,
 * which dispatches each to the matching `Renderer.show*` method. Keeps tools
 * renderer-free; additive (tools emitting no events are unaffected).
 */
export type ToolEvent =
  | { kind: 'bash_truncated'; label: 'stdout' | 'stderr'; originalTokens: number }
  | { kind: 'read_overflow'; filePath: string; lineCount: number }
  | { kind: 'grep_overflow'; pattern: string; maxResults: number };

export interface ToolResult {
  content: string;
  isError?: boolean;
  /** spec 029 (F-15b): overflow/truncation events for the agent to dispatch. */
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
