import type { ZodTypeAny } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
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
