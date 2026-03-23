import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { CompletionEngine } from './completion-providers.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface BorderedInputProps {
  sessionIdentifier?: string;
  bordered?: boolean;
  isActive?: boolean;
  history?: string[];
  completionEngine?: CompletionEngine;
  onSubmit: (value: string) => void;
  onHistoryAppend?: (entry: string) => void;
  onSlashCommand?: (command: string, args?: string) => void;
}

/** Detect whether the terminal likely supports Unicode box-drawing characters. */
export function supportsUnicode(): boolean {
  const term = process.env.TERM ?? '';
  const lang = process.env.LANG ?? '';
  if (term === 'dumb' || term === 'linux') return false;
  if (/utf-?8/i.test(lang)) return true;
  return term !== '';
}

// ── Component ───────────────────────────────────────────────────────────────

export function BorderedInput({
  sessionIdentifier,
  bordered = true,
  isActive = true,
  history = [],
  completionEngine,
  onSubmit,
  onHistoryAppend,
  onSlashCommand,
}: BorderedInputProps) {
  const [value, setValue] = useState('');
  const [multiLineBuffer, setMultiLineBuffer] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { stdout } = useStdout();
  const [columns, setColumns] = useState(stdout?.columns ?? 80);

  // History navigation
  const historyIdx = useRef(-1); // -1 = current input (not navigating)
  const savedInput = useRef(''); // saved current input before navigating

  // Tab completion
  const [completionHint, setCompletionHint] = useState<string | null>(null);

  // Track terminal resize
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setColumns(stdout.columns);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  // Handle up/down arrow for history, tab for completion
  useInput((_input, key) => {
    if (!isActive) return;

    // Up arrow — navigate history backward
    if (key.upArrow && history.length > 0) {
      if (historyIdx.current === -1) {
        savedInput.current = value;
      }
      const newIdx = Math.min(historyIdx.current + 1, history.length - 1);
      historyIdx.current = newIdx;
      setValue(history[history.length - 1 - newIdx]);
      setCompletionHint(null);
      return;
    }

    // Down arrow — navigate history forward
    if (key.downArrow) {
      if (historyIdx.current <= 0) {
        historyIdx.current = -1;
        setValue(savedInput.current);
      } else {
        historyIdx.current--;
        setValue(history[history.length - 1 - historyIdx.current]);
      }
      setCompletionHint(null);
      return;
    }

    // Tab — complete
    if (key.tab && completionEngine && value) {
      const items = completionEngine.complete(value);
      if (items.length === 1) {
        setValue(items[0].value);
        setCompletionHint(null);
      } else if (items.length > 1) {
        const common = completionEngine.commonPrefix(items);
        if (common.length > value.length) {
          setValue(common);
        }
        setCompletionHint(items.map((i) => i.label).join('  '));
      }
      return;
    }
  }, { isActive });

  const handleChange = useCallback((newValue: string) => {
    // Reset history navigation on manual edit
    historyIdx.current = -1;
    setCompletionHint(null);

    // Detect pasted multi-line content
    if (newValue.includes('\n')) {
      setMultiLineBuffer(newValue);
      setExpanded(false);
      const firstLine = newValue.split('\n')[0];
      setValue(firstLine);
    } else {
      if (multiLineBuffer !== null && !newValue.startsWith(value)) {
        setMultiLineBuffer(null);
      }
      setValue(newValue);
    }
  }, [multiLineBuffer, value]);

  const handleSubmit = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Reset history state
    historyIdx.current = -1;
    savedInput.current = '';
    setCompletionHint(null);

    // Handle /expand and /send commands for multi-line buffers
    if (trimmed === '/expand' && multiLineBuffer) {
      setExpanded(!expanded);
      setValue('');
      return;
    }

    if (trimmed === '/send' && multiLineBuffer) {
      onHistoryAppend?.(multiLineBuffer);
      onSubmit(multiLineBuffer);
      setMultiLineBuffer(null);
      setExpanded(false);
      setValue('');
      return;
    }

    // Check for slash commands
    if (trimmed.startsWith('/') && onSlashCommand) {
      const spaceIdx = trimmed.indexOf(' ');
      const cmd = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
      const args = spaceIdx === -1 ? undefined : trimmed.slice(spaceIdx + 1);
      onHistoryAppend?.(trimmed);
      onSlashCommand(cmd, args);
      setValue('');
      return;
    }

    // Submit the full multi-line buffer if we have one, otherwise the single line
    const toSubmit = multiLineBuffer ?? input;
    onHistoryAppend?.(toSubmit);
    onSubmit(toSubmit);
    setMultiLineBuffer(null);
    setExpanded(false);
    setValue('');
  }, [multiLineBuffer, expanded, onSubmit, onSlashCommand, onHistoryAppend]);

  // Multi-line info
  const lineCount = multiLineBuffer ? multiLineBuffer.split('\n').length : 0;

  // Narrow terminal fallback (< 40 columns): plain prompt, no border
  if (!bordered || columns < 40) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="green" bold>{'>'} </Text>
          <TextInput
            value={value}
            onChange={handleChange}
            onSubmit={handleSubmit}
            focus={isActive}
          />
          {multiLineBuffer && !expanded && (
            <Text dimColor> [{lineCount} lines - /expand to view, /send to submit]</Text>
          )}
        </Box>
        {completionHint && (
          <Text dimColor>  {completionHint}</Text>
        )}
        {expanded && multiLineBuffer && (
          <Box flexDirection="column" marginLeft={2}>
            {multiLineBuffer.split('\n').map((line, i) => (
              <Text key={i} dimColor>{line}</Text>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Bordered layout — full terminal width
  const borderStyle = supportsUnicode() ? 'round' : 'classic';
  return (
    <Box flexDirection="column">
      <Box
        flexDirection="column"
        borderStyle={borderStyle}
        borderColor="gray"
        width={columns}
        paddingLeft={1}
        paddingRight={1}
      >
        {/* Input row */}
        <Box>
          <Text color="green" bold>{'>'} </Text>
          <TextInput
            value={value}
            onChange={handleChange}
            onSubmit={handleSubmit}
            focus={isActive}
          />
        </Box>

        {/* Tab completion hint */}
        {completionHint && (
          <Box>
            <Text dimColor>  {completionHint}</Text>
          </Box>
        )}

        {/* Multi-line indicator */}
        {multiLineBuffer && !expanded && (
          <Box>
            <Text dimColor>[{lineCount} lines pasted - /expand to view, /send to submit]</Text>
          </Box>
        )}

        {/* Expanded multi-line view */}
        {expanded && multiLineBuffer && (
          <Box flexDirection="column" marginTop={1}>
            {multiLineBuffer.split('\n').map((line, i) => (
              <Text key={i} dimColor>{line}</Text>
            ))}
            <Text dimColor>[/send to submit, /expand to collapse]</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
