import type { ToolRegistry } from '../tools/registry.js';
import type { ApprovalGate } from './approval-gate.js';
import { PathGuard } from './path-guard.js';
import { redact } from './redactor.js';
import { logger } from './logger.js';
import { McpTimeoutError } from '../mcp/client.js';
import type { AuditLog } from './audit-log.js';

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
 * This is the only path through which a tool may run. The execution order is:
 *   1. FR-02: Zod schema validation (rejects malformed input before anything else)
 *   2. Approval gate (unconditional — cannot be bypassed)
 *   3. FR-03: PathGuard boundary check (centralized — individual tools never call PathGuard)
 *   4. Tool execution
 *   5. FR-04: Redact secrets from output before returning to agent
 *
 * The agent has no reference to the ApprovalGate or PathGuard and cannot
 * influence whether these checks run.
 */
export class ToolExecutor {
  private readonly pathGuard: PathGuard;
  private auditLog: AuditLog | null = null;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly gate: ApprovalGate,
    pathGuardOrCwd?: PathGuard | string,
  ) {
    if (pathGuardOrCwd instanceof PathGuard) {
      this.pathGuard = pathGuardOrCwd;
    } else {
      this.pathGuard = new PathGuard(pathGuardOrCwd ?? process.cwd());
    }
  }

  setAuditLog(log: AuditLog): void {
    this.auditLog = log;
  }

  async execute(
    toolName: string,
    rawInput: Record<string, unknown>,
    onApproved?: () => void,
  ): Promise<ExecutionResult> {
    const tool = this.registry.get(toolName);
    if (!tool) {
      return { content: `Unknown tool "${toolName}"`, isError: true };
    }

    // FR-02: Validate input against Zod schema before anything else.
    // MCP tools have no inputSchema and skip this step (passthrough).
    if (tool.inputSchema) {
      const parsed = tool.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        logger.debug('tool-executor', `Schema rejection [${toolName}]: ${detail}`);
        void this.auditLog?.append({
          event: 'schema_rejection',
          tool: toolName,
          outcome: 'error',
          detail,
        });
        return { content: `Invalid tool input: ${detail}`, isError: true };
      }
    }

    const allowed = await this.gate.allow(toolName, rawInput);
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

    // FR-03: Centralized path boundary check for all file-touching tools.
    // Individual tools receive the resolved path in their input — they never
    // call PathGuard directly.
    const pathError = this.checkPaths(toolName, rawInput);
    if (pathError) return pathError;

    // Time only the actual tool execution, not the approval prompt
    const start = performance.now();
    let result: Awaited<ReturnType<typeof tool.execute>>;
    try {
      result = await tool.execute(rawInput);
    } catch (err) {
      if (err instanceof McpTimeoutError) {
        return { content: err.message, isError: true };
      }
      throw err;
    }
    const elapsed = performance.now() - start;

    // FR-04: Redact secrets from tool output before returning to agent.
    const safeResult =
      typeof result.content === 'string'
        ? { ...result, content: redact(result.content) }
        : result;

    void this.auditLog?.append({
      event: 'tool_call',
      tool: toolName,
      input_summary: JSON.stringify(rawInput),
      outcome: safeResult.isError ? 'error' : 'allowed',
      detail: `${Math.round(elapsed)}ms`,
    });

    return { ...safeResult, _durationMs: elapsed };
  }

  /**
   * Inspect tool input for known path fields and run each through PathGuard.
   * Returns an error ExecutionResult if any path is denied, otherwise null.
   * Mutates input[field] with the resolved (realpath) value on success so the
   * tool uses a canonical path rather than a potentially traversal-containing one.
   *
   * Centralised here so individual tools never need to call PathGuard directly.
   */
  private checkPaths(
    toolName: string,
    input: Record<string, unknown>,
  ): ExecutionResult | null {
    const PATH_FIELDS = ['file_path', 'path', 'pattern'] as const;
    // These tools operate on existing files/directories — path must exist.
    const mustExistTools = new Set(['read', 'glob', 'grep']);

    for (const field of PATH_FIELDS) {
      const raw = input[field];
      if (typeof raw !== 'string') continue;

      const mustExist = mustExistTools.has(toolName);
      const result = this.pathGuard.check(raw, mustExist);

      if (!result.allowed) {
        const reason =
          result.reason === 'parent-missing'
            ? 'Parent directory does not exist.'
            : 'Access denied: the requested path is not accessible.';
        void this.auditLog?.append({
          event: 'path_block',
          tool: toolName,
          input_summary: String(raw),
          outcome: 'denied',
          detail: result.reason,
        });
        return { content: reason, isError: true };
      }

      // Replace raw path with resolved path so tool uses realpath
      input[field] = result.resolvedPath;
    }

    return null;
  }
}
