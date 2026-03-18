import type { ToolRegistry } from '../tools/registry.js';
import type { ApprovalGate } from './approval-gate.js';

export interface ExecutionResult {
  content: string;
  isError?: boolean;
  /** True when the gate blocked execution. The agent sees this as a tool error. */
  denied?: boolean;
  /** Actual tool execution time in ms (excludes approval prompt wait). */
  _durationMs?: number;
}

/**
 * Executes tools on behalf of the agent loop.
 *
 * This is the only path through which a tool may run. The gate check is
 * unconditional — it fires on every call regardless of the tool's own
 * metadata. The agent has no reference to the ApprovalGate and cannot
 * influence whether the check runs.
 *
 * Flow:
 *   agent loop → ToolExecutor.execute() → ApprovalGate.allow() → tool.execute()
 *                                                ↓ denied
 *                                         ExecutionResult { denied: true }
 *                                         (fed back into conversation as a
 *                                          tool error so the agent knows)
 */
export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly gate: ApprovalGate,
  ) {}

  async execute(
    toolName: string,
    input: Record<string, unknown>,
    onApproved?: () => void,
  ): Promise<ExecutionResult> {
    const tool = this.registry.get(toolName);
    if (!tool) {
      return { content: `Unknown tool "${toolName}"`, isError: true };
    }

    const allowed = await this.gate.allow(toolName, input);
    if (!allowed) {
      return {
        content: `Operation denied by user: ${toolName}`,
        isError: true,
        denied: true,
      };
    }

    // Notify caller that approval passed — lets the agent start a spinner
    // only after the prompt is dismissed (avoids overlapping output).
    onApproved?.();

    // Time only the actual tool execution, not the approval prompt
    const start = performance.now();
    const result = await tool.execute(input);
    const elapsed = performance.now() - start;

    return { ...result, _durationMs: elapsed };
  }
}
