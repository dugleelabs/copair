import type { ParseError } from './interface.js';

/**
 * Spec 029 F-14 (design §20.2): build the `[SYSTEM]` repair-message sent to
 * the model when its tool-call markup fails to parse. The agent loop injects
 * this as a user-role message before re-streaming the assistant turn.
 *
 * The output is a deterministic, snapshot-testable template — `MAX_REPAIR_RETRIES`
 * applies per assistant turn, and each retry consumes one additional provider
 * call so the message is intentionally short to keep token overhead low (NF-04).
 */
export function buildRepairMessage(err: ParseError): string {
  return [
    `[SYSTEM] Your tool call failed to parse.`,
    ``,
    `Specific issue: ${err.specific_issue.replace(/_/g, ' ')}`,
    `What you wrote (truncated): ${err.offending_substring}`,
    ``,
    `Expected format:`,
    err.expected_format_example,
    ``,
    `Retry with one valid call.`,
  ].join('\n');
}

/** Maximum repair retries within a single assistant turn (spec 029 §20.3). */
export const MAX_REPAIR_RETRIES = 2;
