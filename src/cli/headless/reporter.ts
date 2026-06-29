/**
 * Headless mode — result reporter (spec 047, T-06).
 *
 * Subscribes to the bridge to count tool calls and assistant turns, streams
 * human-readable text to STDERR (unless --quiet), and at the end builds the
 * `HeadlessResult`, validates it, and writes it as a single JSON document to
 * STDOUT. Import-isolated: AgentBridge + TokenTracker + the headless schema.
 */
import type { AgentBridge } from '../ui/agent-bridge.js';
import type { TokenTracker } from '../../core/token-tracker.js';
import type { AgentTerminationReason } from '../../core/agent.js';
import { mapTerminationReason } from './termination.js';
import {
  HeadlessResultSchema,
  RESULT_SCHEMA_VERSION,
  type HeadlessResult,
  type ResolvedConfig,
  type TaskSource,
} from './schema.js';

export interface ReporterInit {
  tokenTracker: TokenTracker;
  resolvedConfig: ResolvedConfig;
  taskSource: TaskSource;
  cwd: string;
  sessionId: string;
  eventsFile: string | null;
  /** Suppress stderr streaming when true (--quiet). */
  quiet: boolean;
}

export class HeadlessReporter {
  private toolCalls = 0;
  private assistantMessages = 0;
  private readonly startedAt = new Date();
  private readonly startMs = Date.now();

  constructor(
    private readonly bridge: AgentBridge,
    private readonly init: ReporterInit,
  ) {
    this.subscribe();
  }

  private subscribe(): void {
    // Each tool-start is one tool call (counts denials and completions alike).
    this.bridge.on('tool-start', () => {
      this.toolCalls++;
    });
    // One usage event per provider API call = one assistant turn/message.
    this.bridge.on('usage', () => {
      this.assistantMessages++;
    });

    if (!this.init.quiet) {
      // Stream the model's text to STDERR only — STDOUT is reserved for the
      // single result JSON document.
      this.bridge.on('stream-text', (text) => {
        process.stderr.write(text);
      });
    }
  }

  /**
   * Build, validate, and write the result JSON to STDOUT. Called once at the
   * end of the run with the agent's internal termination reason (or `null` +
   * an error when a throw preceded any result).
   */
  finish(
    internalReason: AgentTerminationReason | null,
    error: Error | null,
  ): HeadlessResult {
    const summary = this.init.tokenTracker.getSessionSummary();

    const termination_reason = error
      ? 'error'
      : mapTerminationReason(internalReason ?? 'model-declared-done');

    const result: HeadlessResult = {
      schema_version: RESULT_SCHEMA_VERSION,
      run: {
        task_source: this.init.taskSource,
        cwd: this.init.cwd,
        started_at: this.startedAt.toISOString(),
        duration_ms: Date.now() - this.startMs,
      },
      termination_reason,
      turns: {
        tool_calls: this.toolCalls,
        assistant_messages: this.assistantMessages,
      },
      usage: {
        input_tokens: summary.totalInput,
        output_tokens: summary.totalOutput,
        estimated_cost_usd: summary.totalCost > 0 ? summary.totalCost : null,
      },
      resolved_config: this.init.resolvedConfig,
      events_file: this.init.eventsFile,
      session_id: this.init.sessionId,
      error: error ? { message: error.message } : null,
    };

    // Validate loudly — a malformed result is a contract bug that 048 would
    // silently choke on. `parse` throws in dev/test; the runner surfaces it.
    const validated = HeadlessResultSchema.parse(result);
    // Single JSON document to STDOUT, newline-terminated.
    process.stdout.write(JSON.stringify(validated) + '\n');
    return validated;
  }
}
