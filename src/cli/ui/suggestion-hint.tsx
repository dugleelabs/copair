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
}

export function SuggestionHint({ bridge, enabled = true, rules = DEFAULT_RULES }: SuggestionHintProps) {
  const [context, setContext] = useState<SuggestionContext>({
    lastToolNames: [],
    editCount: 0,
    hasTestFramework: false,
    sessionCount: 0,
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
      // Reset tool tracking for fresh suggestions
      setContext((prev) => ({ ...prev, lastToolNames: [] }));
    };

    bridge.on('tool-complete', onToolComplete);
    bridge.on('turn-complete', onTurnComplete);
    return () => {
      bridge.off('tool-complete', onToolComplete);
      bridge.off('turn-complete', onTurnComplete);
    };
  }, [bridge]);

  if (!enabled) return null;

  const activeSuggestion = rules.find((rule) => rule.condition(context));
  if (!activeSuggestion) return null;

  return (
    <Box marginLeft={2}>
      <Text dimColor italic>
        {activeSuggestion.suggestion} [Tab to accept]
      </Text>
    </Box>
  );
}
