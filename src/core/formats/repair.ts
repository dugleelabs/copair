import type { ParseError } from './interface.js';

/**
 * spec 029 (F-14): build the `[SYSTEM]` repair-message the agent injects as a
 * user-role message before re-streaming when tool-call markup fails to parse.
 * Kept short — each retry is an extra provider call.
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

/** Maximum repair retries within a single assistant turn (spec 029, F-14). */
export const MAX_REPAIR_RETRIES = 2;
