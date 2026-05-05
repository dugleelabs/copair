import React from 'react';
import { Text } from 'ink';

export interface ActivityBarProps {
  phase: 'input' | 'thinking' | 'streaming' | 'approval' | 'idle' | 'slash-command';
  spinnerFrame: string;
  spinnerElapsed: string;
  liveTool: string | null;
}

/**
 * Always-rendered single-line activity indicator.
 *
 * Replaces the three conditional elements (spinner, streaming indicator,
 * tool indicator) that previously caused vertical layout shifts. By being
 * always mounted, it keeps the dynamic area height stable across all phases.
 *
 * Rendering logic (priority order):
 *   liveTool set       →  "  ● <tool label>"           (green dot)
 *   thinking           →  "  ⠋ thinking… 3s"           (magenta spinner + gray elapsed)
 *   streaming          →  "  ⠋ …"                      (dim, model is writing)
 *   input/approval/idle →  " "                          (single space preserves height)
 */
export function ActivityBar({ phase, spinnerFrame, spinnerElapsed, liveTool }: ActivityBarProps) {
  if (liveTool !== null) {
    return <Text color="green">  {'\u25CF'} {liveTool}</Text>;
  }
  if (phase === 'thinking') {
    return (
      <Text>
        {'  '}
        <Text color="magenta">{spinnerFrame}</Text>
        {' '}
        <Text dimColor>{'thinking... '}<Text color="gray">{spinnerElapsed}</Text></Text>
      </Text>
    );
  }
  if (phase === 'streaming') {
    return <Text dimColor>  {spinnerFrame} ...</Text>;
  }
  // input / approval / idle — preserve height with a single space
  return <Text> </Text>;
}
