import React from 'react';
import { Text } from 'ink';

export interface ContextBarProps {
  percent: number;
  segments?: number;
}

/**
 * Visual progress bar for context window usage.
 * Renders: [████████░░] 78%
 * Color: green (<70%), yellow (70-90%), red (>90%)
 */
export function ContextBar({ percent, segments = 10 }: ContextBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * segments);
  const empty = segments - filled;

  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);

  let color: string;
  if (clamped > 90) {
    color = 'red';
  } else if (clamped >= 70) {
    color = 'yellow';
  } else {
    color = 'green';
  }

  return (
    <Text color={color}>[{bar}] {Math.round(clamped)}%</Text>
  );
}
