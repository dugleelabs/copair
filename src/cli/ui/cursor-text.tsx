import React from 'react';
import { Text } from 'ink';

export interface CursorTextProps {
  value: string;
  cursorPos: number;
  active: boolean;
}

/**
 * Renders a string with an inverted-background cursor block at `cursorPos`.
 *
 * When inactive, renders the value as plain text (no cursor shown).
 * Uses codepoint-safe array spread so multi-byte Unicode characters
 * (emoji, CJK, etc.) are sliced at codepoint boundaries, not byte boundaries.
 */
export function CursorText({ value, cursorPos, active }: CursorTextProps) {
  if (!active) return <Text>{value}</Text>;

  const chars = [...value]; // spread for Unicode codepoint safety
  const before = chars.slice(0, cursorPos).join('');
  const at = chars[cursorPos] ?? ' ';
  const after = chars.slice(cursorPos + 1).join('');

  return (
    <>
      <Text>{before}</Text>
      <Text inverse>{at}</Text>
      <Text>{after}</Text>
    </>
  );
}
