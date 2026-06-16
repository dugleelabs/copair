/**
 * Headless mode — mechanism-event JSONL sink (spec 047, T-09).
 *
 * When `--events <path>` is set, every mechanism event is appended as one JSON
 * line with a monotonic `seq`, schema version `v:1`, and an ISO `ts`. Each line
 * is flushed synchronously (`appendFileSync`) so a `kill -9` mid-run still
 * leaves valid partial JSONL. Import-isolated: Node fs + the AgentBridge type +
 * the headless schema.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import type { AgentBridge } from '../ui/agent-bridge.js';
import {
  EVENT_SCHEMA_VERSION,
  HeadlessEventSchema,
  type HeadlessEvent,
  type TerminationReason,
} from './schema.js';

/**
 * Event payload minus the three envelope fields the sink fills in. Distributive
 * `Omit` over the discriminated union so each member keeps its own fields (a
 * plain `Omit<Union, K>` would collapse to only the common keys).
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventPayload = DistributiveOmit<HeadlessEvent, 'v' | 'seq' | 'ts'>;

export class EventSink {
  private seq = 0;
  private turnIndex = -1;
  private turnOpen = false;

  constructor(private readonly path: string) {
    // Truncate any prior file so a fresh run starts clean.
    writeFileSync(this.path, '', { encoding: 'utf-8' });
  }

  /** Append one validated event line, filling in envelope fields. */
  write(payload: EventPayload): void {
    const event = HeadlessEventSchema.parse({
      v: EVENT_SCHEMA_VERSION,
      seq: this.seq++,
      ts: new Date().toISOString(),
      ...payload,
    });
    appendFileSync(this.path, JSON.stringify(event) + '\n', { encoding: 'utf-8' });
  }

  /** Open a new assistant turn, emitting `turn_started` with the next index. */
  startTurn(): void {
    if (this.turnOpen) this.completeTurn();
    this.turnIndex++;
    this.turnOpen = true;
    this.write({ event: 'turn_started', turn_index: this.turnIndex });
  }

  /** Close the current assistant turn, if one is open. */
  completeTurn(): void {
    if (!this.turnOpen) return;
    this.write({ event: 'turn_completed', turn_index: this.turnIndex });
    this.turnOpen = false;
  }

  /** Record a (terminate-mode) approval-required event. */
  approvalRequired(tool: string): void {
    this.write({ event: 'approval_required', tool });
  }

  /** Final event of the stream — closes any open turn first. */
  runTerminated(reason: TerminationReason): void {
    this.completeTurn();
    this.write({ event: 'run_terminated', reason });
  }

  /**
   * Subscribe to the bridge's mechanism events and translate each into the
   * reconciled JSONL shape (spec 047, T-09 mapping table). Turn boundaries are
   * driven from `usage` (one per provider API call = one assistant turn): the
   * first usage opens turn 0, each subsequent usage closes the prior turn and
   * opens the next.
   */
  attach(bridge: AgentBridge): void {
    bridge.on('tool-call-parsed', (data) => {
      // The agent only ever emits one of the four schema-valid formatter names
      // ('dsml' | 'qwen-xml' | 'fenced-block' | 'native'); the schema validates.
      this.write({
        event: 'tool_call_parsed',
        valid: data.valid,
        formatter: data.formatter as 'dsml' | 'qwen-xml' | 'fenced-block' | 'native',
        tool: data.tool,
      });
    });

    bridge.on('format-repair', (data) => {
      this.write({ event: 'format_repair', specific_issue: data.specific_issue });
    });
    bridge.on('format-repair-exhausted', (data) => {
      this.write({ event: 'format_repair_exhausted', specific_issue: data.specific_issue });
    });

    bridge.on('loop-nudge', () => {
      this.write({ event: 'loop_nudge' });
    });
    bridge.on('loop-halt', (data) => {
      this.write({ event: 'loop_halt', reason: data.reason });
    });

    bridge.on('bash-truncated', () => {
      this.write({ event: 'output_truncated', tool: 'bash' });
    });
    bridge.on('read-overflow', () => {
      this.write({ event: 'output_truncated', tool: 'read' });
    });
    bridge.on('grep-overflow', () => {
      this.write({ event: 'output_truncated', tool: 'grep' });
    });

    bridge.on('tool-start', (tool) => {
      this.write({ event: 'tool_started', tool: tool.name });
    });
    bridge.on('tool-complete', (tool) => {
      // The renderer emits an empty `name` on tool-complete (label carries the
      // detail). Fall back to the label so the tool field is never blank.
      this.write({ event: 'tool_completed', tool: tool.name || tool.label, ok: true });
    });
    bridge.on('tool-denied', (tool) => {
      this.write({
        event: 'tool_completed',
        tool: tool.name || tool.label,
        ok: false,
        denied: true,
      });
    });

    bridge.on('usage', (usage) => {
      // Turn boundary: each provider response is one assistant turn.
      this.startTurn();
      this.write({
        event: 'usage',
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
      });
    });
  }
}
