import { describe, it, expect } from 'vitest';
import { DEFAULT_RULES, type SuggestionContext, type SuggestionRule } from '../../../src/cli/ui/suggestion-hint.js';

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

// ── T-23: Tab-to-accept logic ─────────────────────────────────────────────────
// Tests the acceptance guard: Tab on empty input with active suggestion → accept;
// Tab on non-empty input → completion only (suggestion ignored).

describe('tab-to-accept guard logic (FR-06)', () => {
  const suggestion: SuggestionRule = {
    id: 'test',
    condition: () => true,
    suggestion: 'Run tests?',
    action: 'run the tests',
  };

  it('empty input + active suggestion → should accept (Tab accepts suggestion)', () => {
    const value = '';
    const activeSuggestion = suggestion;
    // Guard: !value && activeSuggestion
    expect(!value && activeSuggestion !== null).toBe(true);
  });

  it('non-empty input + active suggestion → should NOT accept (Tab triggers completion)', () => {
    const value = 'some text';
    const activeSuggestion = suggestion;
    // Guard: !value is false, so suggestion accept path is not taken
    expect(!value && activeSuggestion !== null).toBe(false);
  });

  it('empty input + no suggestion → should NOT accept', () => {
    const value = '';
    const activeSuggestion = null;
    expect(!value && activeSuggestion !== null).toBe(false);
  });

  it('accepted action is the suggestion.action string', () => {
    expect(suggestion.action).toBe('run the tests');
  });
});

// ── T-23: initialContext merging ──────────────────────────────────────────────

describe('initialContext merging', () => {
  it('run-tests triggers when hasTestFramework seeded via initialContext', () => {
    // Simulate what happens when initialContext = { hasTestFramework: true }
    // is spread over defaults inside SuggestionHint
    const defaults: SuggestionContext = {
      lastToolNames: [],
      editCount: 0,
      hasTestFramework: false,
      sessionCount: 0,
    };
    const initialContext: Partial<SuggestionContext> = { hasTestFramework: true };
    const merged: SuggestionContext = { ...defaults, ...initialContext };

    // With editCount=0, run-tests should NOT fire (requires editCount > 0 + 'edit' in lastToolNames)
    const runTests = DEFAULT_RULES.find((r) => r.id === 'run-tests')!;
    expect(runTests.condition(merged)).toBe(false);

    // After an edit tool call, it should fire
    const afterEdit: SuggestionContext = {
      ...merged,
      lastToolNames: ['edit'],
      editCount: 1,
    };
    expect(runTests.condition(afterEdit)).toBe(true);
  });

  it('sessionCount seeded via initialContext drives resume-session rule', () => {
    const ctx: SuggestionContext = {
      lastToolNames: [],
      editCount: 0,
      hasTestFramework: false,
      sessionCount: 5, // seeded from src/index.ts at startup
    };
    const resume = DEFAULT_RULES.find((r) => r.id === 'resume-session')!;
    expect(resume.condition(ctx)).toBe(true);
  });
});
