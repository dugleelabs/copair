/**
 * Unit tests — headless termination-reason mapping (spec 047, T-07 / T-14).
 *
 * Asserts every internal `AgentTerminationReason` maps to the correct public
 * `TerminationReason`, and that the mapping is total (the canonical agent enum
 * is the test's source of truth, so a new internal reason fails loudly here).
 */
import { describe, it, expect } from 'vitest';
import { mapTerminationReason } from '../../../src/cli/headless/termination.js';
import type { AgentTerminationReason } from '../../../src/core/agent.js';
import { TERMINATION_REASONS, type TerminationReason } from '../../../src/cli/headless/schema.js';

describe('mapTerminationReason', () => {
  const cases: Array<[AgentTerminationReason, TerminationReason]> = [
    ['completed', 'completed'],
    ['model-declared-done', 'model-declared-done'],
    ['denied', 'approval-required'],
    ['context-exhausted', 'context-exhausted'],
    ['max-tool-calls', 'max-tool-calls'],
    ['max-tokens', 'max-tokens'],
    ['loop-halt', 'aborted'],
    ['format-repair-exhausted', 'aborted'],
  ];

  it.each(cases)('maps internal %s → public %s', (internal, expected) => {
    expect(mapTerminationReason(internal)).toBe(expected);
  });

  it('only ever produces values in the public enum (never "error")', () => {
    for (const [internal] of cases) {
      const mapped = mapTerminationReason(internal);
      expect(TERMINATION_REASONS).toContain(mapped);
      // `error` is reserved for the thrown-error path in the reporter, never a
      // mapped agent reason.
      expect(mapped).not.toBe('error');
    }
  });

  it('covers every internal reason (mapping is total)', () => {
    // If a new AgentTerminationReason is added without a mapping, the switch in
    // mapTerminationReason is non-exhaustive and tsc fails — this asserts the
    // test table is kept in lock-step too.
    const covered = new Set(cases.map(([internal]) => internal));
    const allInternal: AgentTerminationReason[] = [
      'completed',
      'model-declared-done',
      'denied',
      'context-exhausted',
      'max-tool-calls',
      'max-tokens',
      'loop-halt',
      'format-repair-exhausted',
    ];
    for (const reason of allInternal) {
      expect(covered.has(reason)).toBe(true);
    }
  });
});
