/**
 * Headless mode — approval policy + no-hang prompt handlers (spec 047, T-08/T-08b).
 *
 * Registers bridge subscribers so a headless run never blocks on an interactive
 * callback. Import-isolated: touches only the AgentBridge type and the
 * approval-gate's `ApprovalAnswer`.
 */
import type { AgentBridge, ApprovalAnswer } from '../ui/agent-bridge.js';

/**
 * Tracks whether any tool required approval during a terminate-mode run. The
 * reporter reads this to corroborate the `denied → approval-required` mapping.
 */
export class ApprovalTracker {
  private _required = false;
  get required(): boolean {
    return this._required;
  }
  markRequired(): void {
    this._required = true;
  }
}

export interface ApprovalHandlerOptions {
  /** When true (--auto-approve), approve every request; else deny (terminate). */
  autoApprove: boolean;
  /** Notified (tool name) each time approval is required in terminate-mode. */
  onApprovalRequired?: (tool: string) => void;
}

/**
 * Install the headless approval policy.
 *
 * Terminate-mode (default): respond `'deny'` to every request, record it via
 * `onApprovalRequired`, and flag the tracker. The agent treats the denial as
 * final and ends the turn → `terminationReason: 'denied'` → public
 * `approval-required`.
 *
 * Auto-approve mode: respond `'allow'` PER request. `'all'` would set
 * `approveAllForTurn`, but the gate deliberately ignores that flag for
 * always-ask tools (web_search, cross-repo) and re-prompts — so `'allow'` per
 * request is the only answer that approves every call including always-ask
 * carve-outs. Each approval still flows through the existing audit log
 * (`approved_by: 'auto'` for needs-approval, `'user'` for always-ask via the
 * gate's allow path) — the gate logging is left untouched.
 */
export function installApprovalHandler(
  bridge: AgentBridge,
  tracker: ApprovalTracker,
  options: ApprovalHandlerOptions,
): void {
  bridge.on('approval-request', (request, respond) => {
    if (options.autoApprove) {
      const answer: ApprovalAnswer = 'allow';
      respond(answer);
      return;
    }
    tracker.markRequired();
    options.onApprovalRequired?.(request.toolName);
    respond('deny');
  });
}

/**
 * Install no-hang handlers for every bridge event that awaits a callback, so a
 * headless run can never block on interactive input (spec 047, T-08b).
 *
 * - `context-limit-action` → `'abort'` (terminates as context-exhausted; never
 *   compacts in headless mode).
 * - `input-request` → respond with empty string. The agent's `ask_user`
 *   intercept and command-intake both await this callback; answering empty
 *   ends the prompt cleanly rather than feeding a loop. We also surface a note
 *   on stderr so the operator sees that interactive input was requested.
 */
export function installNoHangPromptHandlers(bridge: AgentBridge): void {
  bridge.on('context-limit-action', (respond) => {
    respond('abort');
  });

  bridge.on('input-request', (prompt, respond) => {
    process.stderr.write(
      `[copair:headless] interactive input requested ("${prompt}") — answering empty in headless mode\n`,
    );
    respond('');
  });
}
