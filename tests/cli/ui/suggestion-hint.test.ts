import { describe, it, expect } from 'vitest';
import { DEFAULT_RULES, type SuggestionContext } from '../../../src/cli/ui/suggestion-hint.js';

describe('suggestion-hint rules', () => {
  it('run-tests triggers after edits with test framework', () => {
    const ctx: SuggestionContext = {
      lastToolNames: ['read', 'edit'],
      editCount: 2,
      hasTestFramework: true,
      sessionCount: 0,
    };
    const rule = DEFAULT_RULES.find((r) => r.id === 'run-tests');
    expect(rule!.condition(ctx)).toBe(true);
  });

  it('run-tests does not trigger without test framework', () => {
    const ctx: SuggestionContext = {
      lastToolNames: ['edit'],
      editCount: 2,
      hasTestFramework: false,
      sessionCount: 0,
    };
    const rule = DEFAULT_RULES.find((r) => r.id === 'run-tests');
    expect(rule!.condition(ctx)).toBe(false);
  });

  it('run-tests does not trigger without edits', () => {
    const ctx: SuggestionContext = {
      lastToolNames: ['read'],
      editCount: 0,
      hasTestFramework: true,
      sessionCount: 0,
    };
    const rule = DEFAULT_RULES.find((r) => r.id === 'run-tests');
    expect(rule!.condition(ctx)).toBe(false);
  });

  it('commit-changes triggers after 3+ edits', () => {
    const ctx: SuggestionContext = {
      lastToolNames: [],
      editCount: 3,
      hasTestFramework: false,
      sessionCount: 0,
    };
    const rule = DEFAULT_RULES.find((r) => r.id === 'commit-changes');
    expect(rule!.condition(ctx)).toBe(true);
  });

  it('commit-changes does not trigger with fewer edits', () => {
    const ctx: SuggestionContext = {
      lastToolNames: [],
      editCount: 2,
      hasTestFramework: false,
      sessionCount: 0,
    };
    const rule = DEFAULT_RULES.find((r) => r.id === 'commit-changes');
    expect(rule!.condition(ctx)).toBe(false);
  });

  it('resume-session triggers with existing sessions and no edits', () => {
    const ctx: SuggestionContext = {
      lastToolNames: [],
      editCount: 0,
      hasTestFramework: false,
      sessionCount: 3,
    };
    const rule = DEFAULT_RULES.find((r) => r.id === 'resume-session');
    expect(rule!.condition(ctx)).toBe(true);
  });

  it('resume-session does not trigger with edits', () => {
    const ctx: SuggestionContext = {
      lastToolNames: [],
      editCount: 1,
      hasTestFramework: false,
      sessionCount: 3,
    };
    const rule = DEFAULT_RULES.find((r) => r.id === 'resume-session');
    expect(rule!.condition(ctx)).toBe(false);
  });
});
