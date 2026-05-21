import { EventEmitter } from 'node:events';

// ── Event payload types ─────────────────────────────────────────────────────

export interface ToolInfo {
  name: string;
  label: string;
  input: Record<string, unknown>;
}

export interface ToolCompleteInfo {
  name: string;
  label: string;
  durationMs: number;
  result?: string;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

export interface DiffInfo {
  filePath: string;
  hunks: DiffHunk[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionCost: number;
  contextPercent?: number;
}

export type ApprovalAnswer = 'allow' | 'always' | 'deny' | 'all' | 'similar';

/** Pre-approval diff shown at the approval prompt (before execution). */
export interface ApprovalDiffPreview {
  filePath: string;
  oldContent: string | null;
  newContent: string;
  diffText: string;
}

export interface ApprovalRequest {
  toolName: string;
  input: Record<string, unknown>;
  summary: string;
  index: number;
  total: number;
  /** Pre-approval diff preview (shown before user approves). */
  diff?: ApprovalDiffPreview | null;
  /** Present when a bash command references a sensitive system path. */
  warning?: string;
  /** Present when a bash command references a path outside the project root. */
  crossRepoBashPath?: string;
  /** Present when a read/glob/grep targets a path outside the project root. */
  crossRepoReadPath?: string;
}

// ── Typed event map ─────────────────────────────────────────────────────────

export interface AgentBridgeEvents {
  'stream-text': (text: string) => void;
  'stream-code-block': (code: string, lang: string) => void;
  'tool-start': (tool: ToolInfo) => void;
  'tool-complete': (tool: ToolCompleteInfo) => void;
  'tool-denied': (tool: { name: string; label: string }) => void;
  'approval-request': (
    request: ApprovalRequest,
    respond: (answer: ApprovalAnswer) => void,
  ) => void;
  'diff': (diff: DiffInfo) => void;
  'usage': (usage: TokenUsage) => void;
  'thinking-start': (label?: string) => void;
  'thinking-stop': () => void;
  'turn-complete': () => void;
  'error': (message: string) => void;
  'input-request': (prompt: string, respond: (input: string) => void) => void;
  'context-limit-warning': () => void;
  'context-limit-action': (respond: (action: 'compact' | 'abort') => void) => void;
  'task-complete': (data: { summary: string }) => void;
  'max-turn-warning': (data: { limit: number }) => void;
  'unclear-signal': (data: { message: string }) => void;
  /** Spec 029 F-13: loop guard nudged the model after 2 identical tool repeats. */
  'loop-nudge': (data: { message: string }) => void;
  /** Spec 029 F-13: loop guard halted the agent turn after 3 identical tool repeats. */
  'loop-halt': (data: { reason: string }) => void;
}

// ── AgentBridge ─────────────────────────────────────────────────────────────

type EventName = keyof AgentBridgeEvents;

/**
 * Event-based bridge between the agent loop and the ink UI.
 *
 * The agent loop emits events (stream chunks, tool status, approval requests)
 * and the UI subscribes to render them. Input flows back from the UI to the
 * agent via callback functions passed in event payloads.
 */
export class AgentBridge extends EventEmitter {
  /** Turn-scoped flag: when true, remaining tool calls skip approval. */
  approveAllForTurn = false;

  emit<K extends EventName>(event: K, ...args: Parameters<AgentBridgeEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  on<K extends EventName>(event: K, listener: AgentBridgeEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  once<K extends EventName>(event: K, listener: AgentBridgeEvents[K]): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  off<K extends EventName>(event: K, listener: AgentBridgeEvents[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  /** Reset turn-scoped state. Called on 'turn-complete'. */
  resetTurn(): void {
    this.approveAllForTurn = false;
  }
}
