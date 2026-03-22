import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useStdout } from 'ink';
import TextInput from 'ink-text-input';

// ── Types ───────────────────────────────────────────────────────────────────

export interface BorderedInputProps {
  model: string;
  sessionIdentifier?: string;
  bordered?: boolean;
  isActive?: boolean;
  onSubmit: (value: string) => void;
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
  model,
  sessionIdentifier,
  bordered = true,
  isActive = true,
  onSubmit,
  onSlashCommand,
}: BorderedInputProps) {
  const [value, setValue] = useState('');
  const [multiLineBuffer, setMultiLineBuffer] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { stdout } = useStdout();
  const [columns, setColumns] = useState(stdout?.columns ?? 80);

  // Track terminal resize
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setColumns(stdout.columns);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  const handleChange = useCallback((newValue: string) => {
    // Detect pasted multi-line content
    if (newValue.includes('\n')) {
      setMultiLineBuffer(newValue);
      setExpanded(false);
      // Show only first line in the input
      const firstLine = newValue.split('\n')[0];
      setValue(firstLine);
    } else {
      // Single line — clear multi-line buffer if it was set
      if (multiLineBuffer !== null && !newValue.startsWith(value)) {
        setMultiLineBuffer(null);
      }
      setValue(newValue);
    }
  }, [multiLineBuffer, value]);

  const handleSubmit = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Handle /expand and /send commands for multi-line buffers
    if (trimmed === '/expand' && multiLineBuffer) {
      setExpanded(!expanded);
      setValue('');
      return;
    }

    if (trimmed === '/send' && multiLineBuffer) {
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
      onSlashCommand(cmd, args);
      setValue('');
      return;
    }

    // Submit the full multi-line buffer if we have one, otherwise the single line
    onSubmit(multiLineBuffer ?? input);
    setMultiLineBuffer(null);
    setExpanded(false);
    setValue('');
  }, [multiLineBuffer, expanded, onSubmit, onSlashCommand]);

  // Multi-line info
  const lineCount = multiLineBuffer ? multiLineBuffer.split('\n').length : 0;

  // Narrow terminal fallback (< 40 columns): plain prompt, no border
  if (!bordered || columns < 40) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="cyan">copair ({model})</Text>
          {sessionIdentifier && <Text dimColor> [{sessionIdentifier}]</Text>}
          <Text color="gray"> {'>'} </Text>
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

  // Bordered layout
  const borderStyle = supportsUnicode() ? 'round' : 'classic';
  return (
    <Box flexDirection="column">
      <Box
        flexDirection="column"
        borderStyle={borderStyle}
        borderColor="gray"
        width={Math.min(columns, 120)}
        paddingLeft={1}
        paddingRight={1}
      >
        {/* Header row */}
        <Box>
          <Text color="cyan" bold>{model}</Text>
          {sessionIdentifier && (
            <Text dimColor> [{sessionIdentifier}]</Text>
          )}
        </Box>

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
