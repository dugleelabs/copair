/**
 * spec 029 (F-13): result-aware tool-call loop guard. Observes the
 * (toolName, args, result) tuple from every tool execution and catches the
 * agent getting stuck on the same call with the same result — a common
 * small-model failure mode.
 *
 * Policy: 2 consecutive identical tuples → nudge (a [SYSTEM] message injected
 * into the next iteration); 3 → halt the turn with a synthetic tool_result.
 * Bounded memory (last 3 tuple hashes). Runs for both tiers in v1.
 */
import { createHash } from 'node:crypto';

const NUDGE_THRESHOLD = 2; // 2 identical repeats → nudge the model
const HALT_THRESHOLD = 3; // 3 identical repeats → hard-stop the turn
const DEQUE_SIZE = 3;

export type LoopGuardAction =
  | { kind: 'continue' }
  | { kind: 'nudge'; message: string }
  | { kind: 'halt'; reason: string };

/**
 * Stable, sorted-key JSON serialization. `{a:1,b:2}` and `{b:2,a:1}` hash
 * identically so the loop guard doesn't get fooled by argument-order
 * variation from the model. Pure function; safe to call from anywhere.
 *
 * @throws when `v` contains BigInt, symbols, functions, or circular
 *   references — `JSON.stringify` propagates the underlying TypeError.
 *   Callers (e.g. `LoopGuard.observe`) are expected to catch and degrade
 *   gracefully.
 */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) + ':' + canonicalJson((v as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}

export class LoopGuard {
  private readonly recent: string[] = [];

  /**
   * Record a tool call and its result. Returns the action the agent loop
   * should take. Idempotent on the recent deque — only the call itself
   * mutates state.
   */
  observe(toolName: string, args: unknown, result: string): LoopGuardAction {
    const tuple = this.hashTuple(toolName, args, result);
    this.recent.push(tuple);
    if (this.recent.length > DEQUE_SIZE) this.recent.shift();

    const consecutiveRepeats = this.consecutiveRepeats(tuple);

    if (consecutiveRepeats >= HALT_THRESHOLD) {
      return {
        kind: 'halt',
        reason: `Tool \`${toolName}\` returned identical results ${HALT_THRESHOLD} times in a row. Stopping to avoid wasted turns.`,
      };
    }
    if (consecutiveRepeats >= NUDGE_THRESHOLD) {
      return {
        kind: 'nudge',
        message: `You called \`${toolName}\` with these args and got the same result ${NUDGE_THRESHOLD} times. Try a different approach, or call \`task_complete\` if you have what you need.`,
      };
    }
    return { kind: 'continue' };
  }

  /** Clear the deque. Called at the start of each new user-message turn. */
  reset(): void {
    this.recent.length = 0;
  }

  private hashTuple(toolName: string, args: unknown, result: string): string {
    // canonicalJson can throw on BigInt / symbols / circular references.
    // Tool args from a formatter are expected to be JSON-safe (the formatter
    // would have failed to parse them otherwise), but we don't assume — any
    // throw here yields a per-call sentinel so the loop guard effectively
    // no-ops for this call (the sentinel will never match a previous hash,
    // so observe() returns 'continue').
    let argsJson: string;
    try {
      argsJson = canonicalJson(args);
    } catch (err) {
      // Intentional: surface to the user when their model produces unhashable arg shapes.
      console.warn(
        `[LoopGuard] canonicalJson failed for tool=${toolName}; skipping guard for this call. Cause: ${err instanceof Error ? err.message : String(err)}`,
      );
      argsJson = `__unhashable_${Date.now()}_${Math.random()}__`;
    }
    // Hash the result first so a 5MB identical output doesn't bloat the deque.
    const resultHash = createHash('sha256').update(result).digest('hex');
    return createHash('sha256')
      .update(toolName)
      .update('\0')
      .update(argsJson)
      .update('\0')
      .update(resultHash)
      .digest('hex');
  }

  private consecutiveRepeats(tuple: string): number {
    let count = 0;
    for (let i = this.recent.length - 1; i >= 0; i--) {
      if (this.recent[i] === tuple) count++;
      else break;
    }
    return count;
  }
}
