import React, { useState, useCallback } from 'react';
import { Text, useInput } from 'ink';

// ── Types ───────────────────────────────────────────────────────────────────

export type ViModeState = 'NORMAL' | 'INSERT';

export interface ViModeInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  enabled: boolean;
  focus?: boolean;
}

// ── Component ───────────────────────────────────────────────────────────────

export function ViModeInput({ value, onChange, onSubmit, enabled, focus = true }: ViModeInputProps) {
  const [mode, setMode] = useState<ViModeState>('INSERT');
  const [cursor, setCursor] = useState(value.length);

  const handleInput = useCallback(
    (input: string, key: { escape?: boolean; return?: boolean; backspace?: boolean; delete?: boolean; leftArrow?: boolean; rightArrow?: boolean }) => {
      if (!focus || !enabled) return;

      if (mode === 'INSERT') {
        // Escape → NORMAL
        if (key.escape) {
          setMode('NORMAL');
          setCursor(Math.max(0, value.length - 1));
          return;
        }
        // Return → submit
        if (key.return) {
          onSubmit(value);
          return;
        }
        // Backspace
        if (key.backspace || key.delete) {
          if (cursor > 0) {
            const newVal = value.slice(0, cursor - 1) + value.slice(cursor);
            onChange(newVal);
            setCursor(cursor - 1);
          }
          return;
        }
        // Regular character
        if (input && !key.leftArrow && !key.rightArrow) {
          const newVal = value.slice(0, cursor) + input + value.slice(cursor);
          onChange(newVal);
          setCursor(cursor + input.length);
          return;
        }
        // Arrow keys
        if (key.leftArrow) setCursor(Math.max(0, cursor - 1));
        if (key.rightArrow) setCursor(Math.min(value.length, cursor + 1));
        return;
      }

      // NORMAL mode
      switch (input) {
        case 'i':
          setMode('INSERT');
          return;
        case 'a':
          setMode('INSERT');
          setCursor(Math.min(value.length, cursor + 1));
          return;
        case 'A':
          setMode('INSERT');
          setCursor(value.length);
          return;
        case 'I':
          setMode('INSERT');
          setCursor(0);
          return;
        case 'h':
        case '':
          if (key.leftArrow || input === 'h') setCursor(Math.max(0, cursor - 1));
          return;
        case 'l':
          if (input === 'l') setCursor(Math.min(value.length - 1, cursor + 1));
          return;
        case '0':
          setCursor(0);
          return;
        case '$':
          setCursor(Math.max(0, value.length - 1));
          return;
        case 'w': {
          // Move forward to next word boundary
          const rest = value.slice(cursor + 1);
          const match = rest.match(/\s\S/);
          setCursor(match ? cursor + 1 + match.index! + 1 : value.length - 1);
          return;
        }
        case 'b': {
          // Move backward to previous word boundary
          const before = value.slice(0, cursor);
          const match = before.match(/\S\s\S*$/);
          setCursor(match ? match.index! : 0);
          return;
        }
        case 'x': {
          // Delete char under cursor
          if (value.length > 0) {
            const newVal = value.slice(0, cursor) + value.slice(cursor + 1);
            onChange(newVal);
            if (cursor >= newVal.length) setCursor(Math.max(0, newVal.length - 1));
          }
          return;
        }
        case 'D': {
          // Delete from cursor to end
          const newVal = value.slice(0, cursor);
          onChange(newVal);
          setCursor(Math.max(0, newVal.length - 1));
          return;
        }
        case 'C': {
          // Change from cursor to end (delete + insert mode)
          onChange(value.slice(0, cursor));
          setMode('INSERT');
          return;
        }
        case 'd': {
          // dd → delete entire line (simplified: clear input)
          // We'll handle this as clear since we're single-line
          onChange('');
          setCursor(0);
          return;
        }
        default:
          if (key.rightArrow) setCursor(Math.min(value.length - 1, cursor + 1));
          if (key.leftArrow) setCursor(Math.max(0, cursor - 1));
          if (key.return) onSubmit(value);
          return;
      }
    },
    [mode, value, cursor, onChange, onSubmit, focus, enabled],
  );

  useInput(handleInput, { isActive: focus && enabled });

  return null; // This is a headless hook-based handler
}

// ── Mode Indicator ──────────────────────────────────────────────────────────

export function ViModeIndicator({ mode, enabled }: { mode: ViModeState; enabled: boolean }) {
  if (!enabled) return null;

  return (
    <Text color={mode === 'NORMAL' ? 'blue' : 'green'} bold>
      [{mode}]
    </Text>
  );
}
