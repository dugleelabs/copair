/**
 * Headless mode — termination-reason mapping (spec 047, T-07).
 *
 * The agent loop reports an internal `AgentTerminationReason`; the headless
 * result JSON and event stream expose the public `TerminationReason` enum. This
 * module is the single mapping point between the two. Import-isolated: pulls
 * only the agent's exported type and the headless schema enum.
 */
import type { AgentTerminationReason } from '../../core/agent.js';
import type { TerminationReason } from './schema.js';

/**
 * Map the agent loop's internal reason to the public enum.
 *
 * - `loop-halt` / `format-repair-exhausted` → `aborted` (the event stream
 *   disambiguates which via `loop_halt` / `format_repair_exhausted`).
 * - `denied` → `approval-required`: in terminate-mode, the ONLY thing that
 *   denies a tool is our own approval handler, so a denial means approval was
 *   required. (Auto-approve mode never denies, so this branch can't fire there.)
 * - everything else maps 1:1.
 */
export function mapTerminationReason(reason: AgentTerminationReason): TerminationReason {
  switch (reason) {
    case 'loop-halt':
    case 'format-repair-exhausted':
      return 'aborted';
    case 'denied':
      return 'approval-required';
    case 'completed':
      return 'completed';
    case 'model-declared-done':
      return 'model-declared-done';
    case 'context-exhausted':
      return 'context-exhausted';
    case 'max-tool-calls':
      return 'max-tool-calls';
    case 'max-tokens':
      return 'max-tokens';
  }
}
