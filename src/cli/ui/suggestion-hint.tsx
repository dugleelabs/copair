import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { AgentBridge } from './agent-bridge.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface SuggestionRule {
  id: string;
  condition: (context: SuggestionContext) => boolean;
  suggestion: string;
  action: string; // The input to submit if accepted
}

export interface SuggestionContext {
  lastToolNames: string[];
  editCount: number;
  hasTestFramework: boolean;
  sessionCount: number;
}

// ── Default rules ───────────────────────────────────────────────────────────

export const DEFAULT_RULES: SuggestionRule[] = [
  {
    id: 'run-tests',
    condition: (ctx) => ctx.editCount > 0 && ctx.hasTestFramework && ctx.lastToolNames.includes('edit'),
    suggestion: 'Run tests to verify changes?',
    action: 'run the tests for the files I just changed',
  },
  {
    id: 'commit-changes',
    condition: (ctx) => ctx.editCount >= 3,
    suggestion: 'Commit these changes?',
    action: 'commit the changes with a descriptive message',
  },
  {
    id: 'resume-session',
    condition: (ctx) => ctx.sessionCount > 0 && ctx.editCount === 0,
    suggestion: 'Resume previous session?',
    action: '/session resume',
  },
];

// ── Component ───────────────────────────────────────────────────────────────

export interface SuggestionHintProps {
  bridge: AgentBridge;
  enabled?: boolean;
  rules?: SuggestionRule[];
  /** Seed values for the suggestion context, populated at session startup. */
  initialContext?: Partial<SuggestionContext>;
  /** Fired whenever the active suggestion changes (or becomes null). */
  onSuggestionChange?: (suggestion: SuggestionRule | null) => void;
}

export function SuggestionHint({
  bridge,
  enabled = true,
  rules = DEFAULT_RULES,
  initialContext,
  onSuggestionChange,
}: SuggestionHintProps) {
  const [context, setContext] = useState<SuggestionContext>({
    lastToolNames: [],
    editCount: 0,
    hasTestFramework: false,
    sessionCount: 0,
    ...initialContext,
  });

  useEffect(() => {
    const onToolComplete = (tool: { name: string }) => {
      setContext((prev) => ({
        ...prev,
        lastToolNames: [...prev.lastToolNames.slice(-5), tool.name],
        editCount: tool.name === 'edit' || tool.name === 'write'
          ? prev.editCount + 1
          : prev.editCount,
      }));
    };

    const onTurnComplete = () => {
      setContext((prev) => ({ ...prev, lastToolNames: [] }));
    };

    bridge.on('tool-complete', onToolComplete);
    bridge.on('turn-complete', onTurnComplete);
    return () => {
      bridge.off('tool-complete', onToolComplete);
      bridge.off('turn-complete', onTurnComplete);
    };
  }, [bridge]);

  const activeSuggestion = enabled ? (rules.find((rule) => rule.condition(context)) ?? null) : null;

  // Notify parent whenever the active suggestion changes
  useEffect(() => {
    onSuggestionChange?.(activeSuggestion);
  }, [activeSuggestion, onSuggestionChange]);

  if (!enabled || activeSuggestion === null) return null;

  return (
    <Box marginLeft={2}>
      <Text dimColor italic>
        {activeSuggestion.suggestion} [Tab to accept]
      </Text>
    </Box>
  );
}
