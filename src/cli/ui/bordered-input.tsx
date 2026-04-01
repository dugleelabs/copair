import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import { CursorText } from './cursor-text.js';
import { wordBoundaryLeft, wordBoundaryRight, detectWordNav, detectWordDeletion, isPasteInput, cleanPastedInput } from './cursor-utils.js';
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
  /** Active auto-suggestion; Tab on empty input accepts it (FR-06). */
  activeSuggestion?: { action: string; suggestion: string } | null;
  /**
   * Injects a value into the input (e.g. from history search).
   * Uses a nonce so the same string can be re-injected (FR-07).
   */
  injectedValue?: { value: string; nonce: number };
}

/** Detect whether the terminal likely supports Unicode box-drawing characters. */
export function supportsUnicode(): boolean {
  const term = process.env.TERM ?? '';
  const lang = process.env.LANG ?? '';
  if (term === 'dumb' || term === 'linux') return false;
  if (/utf-?8/i.test(lang)) return true;
  return term !== '';
}

/**
 * Detect terminals where ink's multi-line dynamic area causes ghost rendering.
 * ink re-renders the dynamic area in place, but some terminals fail to properly
 * clear previous frames, leaving bordered boxes frozen in scrollback.
 */
export function hasInkGhostingIssue(): boolean {
  if (process.env.TERM_PROGRAM === 'iTerm.app') return true;
  if (process.env.TERM_PROGRAM === 'Apple_Terminal') return true;
  return false;
}

// ── Component ───────────────────────────────────────────────────────────────

export function BorderedInput({
  sessionIdentifier: _sessionIdentifier,
  bordered = true,
  isActive = true,
  history = [],
  completionEngine,
  onSubmit,
  onHistoryAppend,
  onSlashCommand,
  activeSuggestion,
  injectedValue,
}: BorderedInputProps) {
  const [value, setValue] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [multiLineBuffer, setMultiLineBuffer] = useState<string | null>(null);
  const [completionHint, setCompletionHint] = useState<string | null>(null);
  const { stdout } = useStdout();
  const [columns, setColumns] = useState(stdout?.columns ?? 80);

  // History navigation
  const historyIdx = useRef(-1); // -1 = current input (not navigating)
  const savedInput = useRef(''); // saved current input before navigating

  // Track terminal resize
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setColumns(stdout.columns);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  // Apply injected value (from history search) — nonce ensures re-injection works
  // for the same string selected twice.
  useEffect(() => {
    if (injectedValue != null) {
      setValue(injectedValue.value);
      setCursorPos([...injectedValue.value].length);
    }
  }, [injectedValue]);

  // ── Submit processing ──────────────────────────────────────────────────────

  const processSubmit = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    historyIdx.current = -1;
    savedInput.current = '';
    setCompletionHint(null);

    // Backwards compat: /expand — buffer preview is always shown now, no-op
    if (trimmed === '/expand') {
      setValue('');
      setCursorPos(0);
      return;
    }

    // Backwards compat: /send — submit the active multiline buffer
    if (trimmed === '/send' && multiLineBuffer) {
      onHistoryAppend?.(multiLineBuffer);
      onSubmit(multiLineBuffer);
      setMultiLineBuffer(null);
      setValue('');
      setCursorPos(0);
      return;
    }

    // Slash commands → delegate to parent
    if (trimmed.startsWith('/') && onSlashCommand) {
      const spaceIdx = trimmed.indexOf(' ');
      const cmd = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
      const args = spaceIdx === -1 ? undefined : trimmed.slice(spaceIdx + 1);
      onHistoryAppend?.(trimmed);
      onSlashCommand(cmd, args);
      setValue('');
      setCursorPos(0);
      return;
    }

    // Normal submit
    onHistoryAppend?.(input);
    onSubmit(input);
    setValue('');
    setCursorPos(0);
  }, [multiLineBuffer, onSubmit, onSlashCommand, onHistoryAppend]);

  // ── Consolidated input handler ─────────────────────────────────────────────

  useInput((input, key) => {
    if (!isActive) return;

    // ── 1. Multiline buffer mode — intercepts Enter, Escape, and scroll keys ──
    if (multiLineBuffer !== null) {
      if (key.return) {
        onHistoryAppend?.(multiLineBuffer);
        onSubmit(multiLineBuffer);
        setMultiLineBuffer(null);
        setValue('');
        setCursorPos(0);
        historyIdx.current = -1;
        savedInput.current = '';
        return;
      }
      if (key.escape) {
        setMultiLineBuffer(null);
        setValue('');
        setCursorPos(0);
        return;
      }
      // All other keys fall through to normal single-line handling so the user
      // can still type / edit while the buffer preview is visible.
    }

    // ── 1b. Paste detection — must precede history/submit handling ────────────
    // Pasted content arrives as a single input string containing \n.
    // Store in buffer immediately; never pass the newline-containing string
    // through CursorText rendering (fixes the paste-freeze defect).
    if (isPasteInput(input, key)) {
      setMultiLineBuffer(cleanPastedInput(input));
      setValue('');
      setCursorPos(0);
      return;
    }

    // ── 2. History navigation ─────────────────────────────────────────────────
    if (key.upArrow && history.length > 0) {
      if (historyIdx.current === -1) savedInput.current = value;
      const newIdx = Math.min(historyIdx.current + 1, history.length - 1);
      historyIdx.current = newIdx;
      const newVal = history[history.length - 1 - newIdx];
      setValue(newVal);
      setCursorPos([...newVal].length);
      setCompletionHint(null);
      return;
    }
    if (key.downArrow) {
      if (historyIdx.current <= 0) {
        historyIdx.current = -1;
        setValue(savedInput.current);
        setCursorPos([...savedInput.current].length);
      } else {
        historyIdx.current--;
        const newVal = history[history.length - 1 - historyIdx.current];
        setValue(newVal);
        setCursorPos([...newVal].length);
      }
      setCompletionHint(null);
      return;
    }

    // ── 3. Submit ─────────────────────────────────────────────────────────────
    if (key.return) {
      processSubmit(value);
      return;
    }

    // ── 4. Line-level operations ──────────────────────────────────────────────
    // ink normalises ctrl+key: when key.ctrl is true, `input` is the letter name
    // (e.g. 'a' for Ctrl+A), NOT the raw control byte (\x01).
    // Home key: \x1b[H (xterm/Linux) or \x1b[1~ (VT100 / Windows Terminal)
    const isHome = input === '\x1b[H' || input === '\x1b[1~';
    // End key:  \x1b[F (xterm/Linux) or \x1b[4~ (VT100 / Windows Terminal)
    const isEnd  = input === '\x1b[F' || input === '\x1b[4~';

    if ((key.ctrl && input === 'a') || isHome) {
      setCursorPos(0);
      return;
    }
    if ((key.ctrl && input === 'e') || isEnd) {
      setCursorPos([...value].length);
      return;
    }
    if (key.ctrl && input === 'u') {
      // Delete from start of line to cursor
      const chars = [...value];
      setValue(chars.slice(cursorPos).join(''));
      setCursorPos(0);
      historyIdx.current = -1;
      return;
    }
    if (key.ctrl && input === 'k') {
      // Delete from cursor to end of line
      const chars = [...value];
      setValue(chars.slice(0, cursorPos).join(''));
      // cursorPos is already correct — nothing to delete rightward
      historyIdx.current = -1;
      return;
    }

    // ── 5. Word operations ────────────────────────────────────────────────────
    const wordNav = detectWordNav(input);
    if (wordNav === 'word-left') {
      setCursorPos(wordBoundaryLeft(value, cursorPos));
      return;
    }
    if (wordNav === 'word-right') {
      setCursorPos(wordBoundaryRight(value, cursorPos));
      return;
    }

    if (detectWordDeletion(input, key)) {
      const chars = [...value];
      const newPos = wordBoundaryLeft(value, cursorPos);
      setValue([...chars.slice(0, newPos), ...chars.slice(cursorPos)].join(''));
      setCursorPos(newPos);
      historyIdx.current = -1;
      return;
    }

    // ── 6. Character deletion ─────────────────────────────────────────────────
    if (key.backspace) {
      if (cursorPos > 0) {
        const chars = [...value];
        chars.splice(cursorPos - 1, 1);
        setValue(chars.join(''));
        setCursorPos(cursorPos - 1);
        historyIdx.current = -1;
      }
      return;
    }
    // ink maps \x7f (Mac Delete/Backspace key) to key.delete, NOT key.backspace.
    // ink's nonAlphanumericKeys clears `input` for ALL named keys, so we cannot
    // distinguish \x7f from \x1b[3~ (fn+Delete) — both arrive as key.delete + input=''.
    // Treat key.delete as backward delete: \x7f is the Mac Delete key (ASCII DEL
    // used as Backspace) and is far more common than fn+Delete in practice.
    if (key.delete) {
      if (cursorPos > 0) {
        const chars = [...value];
        chars.splice(cursorPos - 1, 1);
        setValue(chars.join(''));
        setCursorPos(cursorPos - 1);
        historyIdx.current = -1;
      }
      return;
    }

    // ── 7. Cursor movement ────────────────────────────────────────────────────
    if (key.leftArrow) {
      setCursorPos(Math.max(0, cursorPos - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorPos(Math.min([...value].length, cursorPos + 1));
      return;
    }

    // ── 8. Tab completion ─────────────────────────────────────────────────────
    if (key.tab) {
      // Empty input + active suggestion → accept suggestion (FR-06)
      if (!value && activeSuggestion) {
        onHistoryAppend?.(activeSuggestion.action);
        onSubmit(activeSuggestion.action);
        historyIdx.current = -1;
        savedInput.current = '';
        return;
      }
      // Non-empty input → existing completion logic (unchanged)
      if (completionEngine && value) {
        const items = completionEngine.complete(value);
        if (items.length === 1) {
          setValue(items[0].value);
          setCursorPos([...items[0].value].length);
          setCompletionHint(null);
        } else if (items.length > 1) {
          const common = completionEngine.commonPrefix(items);
          if (common.length > value.length) {
            setValue(common);
            setCursorPos([...common].length);
          }
          setCompletionHint(items.map((i) => i.label).join('  '));
        }
      }
      return;
    }

    // ── 9. Ctrl+R → reverse history search (FR-07) ───────────────────────────
    if (key.ctrl && input === 'r') {
      onSlashCommand?.('history-search');
      return;
    }

    // ── 10. Printable character insertion (catch-all) ─────────────────────────
    // Guard: filter unrecognised control sequences and modifier-prefixed keys.
    // input.codePointAt(0) >= 0x20 ensures we only insert printable characters.
    const cp = input.codePointAt(0);
    if (cp === undefined || cp < 0x20 || cp === 0x7f) return;
    if (key.ctrl || key.meta) return;

    const chars = [...value];
    const inputChars = [...input];
    chars.splice(cursorPos, 0, ...inputChars);
    setValue(chars.join(''));
    setCursorPos(cursorPos + inputChars.length);
    historyIdx.current = -1;
    setCompletionHint(null);
  }, { isActive });

  // ── Multiline preview (shared between bordered and plain paths) ────────────
  // Don't render raw content lines — arbitrary Unicode/ANSI in pasted text
  // (box-drawing chars, escape sequences) makes inline rendering unreliable.
  // Instead show a compact badge + sanitized first-line hint.

  function renderMultilinePreview() {
    if (!multiLineBuffer) return null;
    const lines = multiLineBuffer.split('\n');
    const totalLines = lines.length;
    const byteLen = Buffer.byteLength(multiLineBuffer, 'utf8');
    const sizeStr = byteLen >= 1024 ? `${(byteLen / 1024).toFixed(1)} KB` : `${byteLen} B`;

    // Sanitize first non-empty line to ASCII printable only (0x20–0x7E)
    const firstNonEmpty = lines.find((l) => l.trim()) ?? '';
    const sanitized = firstNonEmpty.replace(/[^\x20-\x7E]/g, '').trim();
    const maxHint = Math.max(20, columns - 14);
    const hint = sanitized.length > maxHint ? sanitized.slice(0, maxHint - 1) + '…' : sanitized;

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box gap={1}>
          <Text color="cyan">⎘</Text>
          <Text bold>{totalLines} line{totalLines !== 1 ? 's' : ''}</Text>
          <Text dimColor>·</Text>
          <Text dimColor>{sizeStr}</Text>
          {hint ? <Text dimColor>· "{hint}"</Text> : null}
        </Box>
        <Text dimColor>[Enter to send · Esc to discard]</Text>
      </Box>
    );
  }

  // ── Render: fallback plain prompt ─────────────────────────────────────────
  // Used when: bordered disabled, narrow terminal, or terminal with ink ghosting.
  if (!bordered || columns < 40 || hasInkGhostingIssue()) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="green" bold>{'>'} </Text>
          <CursorText value={value} cursorPos={cursorPos} active={isActive} />
        </Box>
        {completionHint && (
          <Text dimColor>  {completionHint}</Text>
        )}
        {renderMultilinePreview()}
      </Box>
    );
  }

  // ── Render: bordered layout ───────────────────────────────────────────────
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
          <CursorText value={value} cursorPos={cursorPos} active={isActive} />
        </Box>

        {/* Tab completion hint */}
        {completionHint && (
          <Box>
            <Text dimColor>  {completionHint}</Text>
          </Box>
        )}

        {/* Multiline paste preview */}
        {renderMultilinePreview()}
      </Box>
    </Box>
  );
}
