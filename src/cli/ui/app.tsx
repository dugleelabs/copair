import React, { useState, useEffect, useCallback, useImperativeHandle, forwardRef, useRef } from 'react';
import { render, Box, Text, Static, useApp, useInput } from 'ink';
import type { AgentBridge, DiffInfo, TokenUsage, ToolCompleteInfo } from './agent-bridge.js';
import { BorderedInput } from './bordered-input.js';
import { StatusBar } from './status-bar.js';
import { ApprovalHandler } from './approval-handler.js';
import { InputRequestHandler } from './input-request-handler.js';
import { DiffView } from './diff-view.js';
import { ActivityBar } from './activity-bar.js';
import { SuggestionHint } from './suggestion-hint.js';
import { HistorySearch } from './history-search.js';
import type { SuggestionRule, SuggestionContext } from './suggestion-hint.js';
import type { CompletionEngine } from './completion-providers.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface UIConfig {
  bordered_input: boolean;
  status_bar: boolean;
  syntax_highlight: boolean;
  output_collapsing: boolean;
  vi_mode: boolean;
  suggestions: boolean;
  tab_completion: boolean;
}

const DEFAULT_UI_CONFIG: UIConfig = {
  bordered_input: true,
  status_bar: true,
  syntax_highlight: true,
  output_collapsing: true,
  vi_mode: false,
  suggestions: true,
  tab_completion: true,
};

type AppPhase = 'input' | 'thinking' | 'streaming' | 'approval' | 'idle' | 'slash-command';

interface AppState {
  phase: AppPhase;
  model: string;
  sessionIdentifier: string;
  tokenUsage: TokenUsage;
  contextWindowPercent: number;
  notification: string | null;
}

// ── Static output items (rendered once, persist in scrollback) ──────────────

interface StaticItem {
  id: number;
  type: 'text' | 'tool' | 'error' | 'user' | 'diff';
  content: string;
  diff?: DiffInfo;
}

// ── AppHandle (exposed via ref) ─────────────────────────────────────────────

export interface AppHandle {
  unmount: () => void;
  updateModel: (model: string) => void;
  updateSession: (id: string) => void;
  waitForExit: () => Promise<void>;
}

interface AppImperativeHandle {
  updateModel: (model: string) => void;
  updateSession: (id: string) => void;
}

// ── Animated spinner hook ────────────────────────────────────────────────────

const SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
const SPINNER_INTERVAL = 80;

function useSpinner(active: boolean): { frame: string; elapsed: string } {
  const [frameIdx, setFrameIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef(0);

  useEffect(() => {
    if (!active) {
      setFrameIdx(0);
      setElapsed(0);
      return;
    }
    startTime.current = Date.now();
    const timer = setInterval(() => {
      setFrameIdx((i) => (i + 1) % SPINNER_FRAMES.length);
      setElapsed(Date.now() - startTime.current);
    }, SPINNER_INTERVAL);
    return () => clearInterval(timer);
  }, [active]);

  const secs = Math.floor(elapsed / 1000);
  const elapsedStr = secs < 60
    ? `${secs}s`
    : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;

  return { frame: SPINNER_FRAMES[frameIdx], elapsed: elapsedStr };
}

// ── Markdown rendering ──────────────────────────────────────────────────

/** Render inline markdown: **bold**, *italic*, `code` */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      parts.push(<Text key={key++} bold>{boldMatch[1]}</Text>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }
    const italicMatch = remaining.match(/^\*(.+?)\*/);
    if (italicMatch) {
      parts.push(<Text key={key++} italic>{italicMatch[1]}</Text>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(<Text key={key++} color="cyan" bold>{codeMatch[1]}</Text>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }
    const nextSpecial = remaining.search(/[*`]/);
    if (nextSpecial === -1) {
      parts.push(remaining);
      break;
    }
    if (nextSpecial === 0) {
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      parts.push(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    }
  }
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/**
 * Parse markdown text into block-level elements:
 * headers, code blocks, lists, horizontal rules, and paragraphs.
 */
function renderMarkdownBlocks(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code block
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      elements.push(
        <Box key={key++} flexDirection="column" marginY={1}>
          {lang && <Text dimColor>{lang}</Text>}
          <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
            {codeLines.map((cl, ci) => (
              <Text key={ci} color="white">{cl}</Text>
            ))}
          </Box>
        </Box>,
      );
      continue;
    }

    // Headers
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const content = headerMatch[2];
      elements.push(
        <Text key={key++} bold color={level <= 2 ? 'white' : undefined}>
          {level <= 2 ? '\n' : ''}{content}
        </Text>,
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      elements.push(
        <Text key={key++} dimColor>{'\u2500'.repeat(40)}</Text>,
      );
      i++;
      continue;
    }

    // Unordered list item
    const ulMatch = trimmed.match(/^[-*+]\s+(.*)/);
    if (ulMatch) {
      elements.push(
        <Text key={key++} wrap="wrap">  {'\u2022'} {renderInline(ulMatch[1])}</Text>,
      );
      i++;
      continue;
    }

    // Ordered list item
    const olMatch = trimmed.match(/^(\d+)[.)]\s+(.*)/);
    if (olMatch) {
      elements.push(
        <Text key={key++} wrap="wrap">  {olMatch[1]}. {renderInline(olMatch[2])}</Text>,
      );
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const content = trimmed.replace(/^>\s?/, '');
      elements.push(
        <Text key={key++} dimColor wrap="wrap">  {'\u2502'} {renderInline(content)}</Text>,
      );
      i++;
      continue;
    }

    // Empty line
    if (trimmed === '') {
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <Text key={key++} wrap="wrap">{renderInline(line)}</Text>,
    );
    i++;
  }

  return elements;
}

// ── CopairApp ───────────────────────────────────────────────────────────────

interface CopairAppProps {
  bridge: AgentBridge;
  model: string;
  sessionIdentifier?: string;
  branch?: string;
  uiConfig?: Partial<UIConfig>;
  history?: string[];
  completionEngine?: CompletionEngine;
  onMessage?: (input: string) => Promise<void> | void;
  onHistoryAppend?: (entry: string) => void;
  onSlashCommand?: (command: string, args?: string) => Promise<void> | void;
  onExit?: () => Promise<void> | void;
  /** Initial suggestion context values, set at startup by src/index.ts (FR-06). */
  initialContext?: Partial<SuggestionContext>;
}

const CopairApp = forwardRef<AppImperativeHandle, CopairAppProps>(function CopairApp(
  {
    bridge,
    model,
    sessionIdentifier,
    branch,
    uiConfig: uiOverrides,
    history,
    completionEngine,
    onMessage,
    onHistoryAppend,
    onSlashCommand,
    onExit: _onExit,
    initialContext,
  },
  ref,
) {
  const config = { ...DEFAULT_UI_CONFIG, ...uiOverrides };
  const { exit } = useApp();
  const ctrlCCount = useRef(0);
  const ctrlCTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  // Static items — rendered once via <Static>, persist in terminal scrollback
  const [staticItems, setStaticItems] = useState<StaticItem[]>([]);

  // Live streaming text — shown in dynamic area during streaming
  const [liveText, setLiveText] = useState('');

  // Live tool indicator — current tool being executed
  const [liveTool, setLiveTool] = useState<string | null>(null);

  const [state, setState] = useState<AppState>({
    phase: 'input',
    model,
    sessionIdentifier: sessionIdentifier ?? '',
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      sessionInputTokens: 0,
      sessionOutputTokens: 0,
      sessionCost: 0,
    },
    contextWindowPercent: 0,
    notification: null,
  });

  // ── Spinner (always running when active — passed to ActivityBar) ──────────
  const spinner = useSpinner(state.phase === 'thinking' || state.phase === 'streaming');

  // ── Active suggestion (lifted from SuggestionHint for Tab-to-accept) ──────
  const [activeSuggestion, setActiveSuggestion] = useState<SuggestionRule | null>(null);

  // ── History search visibility + injected input (Ctrl+R, FR-07) ───────────
  const [historySearchVisible, setHistorySearchVisible] = useState(false);
  const [injectedInput, setInjectedInput] = useState<{ value: string; nonce: number } | undefined>(undefined);
  const injectedNonce = useRef(0);

  // Expose updateModel/updateSession to parent via ref
  useImperativeHandle(ref, () => ({
    updateModel: (newModel: string) => {
      setState((prev) => ({ ...prev, model: newModel }));
    },
    updateSession: (id: string) => {
      setState((prev) => ({ ...prev, sessionIdentifier: id }));
    },
  }));

  // Handle Ctrl+C: double-press to exit
  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      ctrlCCount.current++;
      if (ctrlCCount.current >= 2) {
        if (ctrlCTimer.current) clearTimeout(ctrlCTimer.current);
        exit();
        return;
      }
      setState((prev) => ({ ...prev, notification: 'Press Ctrl+C again to exit (or /exit)' }));
      if (ctrlCTimer.current) clearTimeout(ctrlCTimer.current);
      ctrlCTimer.current = setTimeout(() => {
        ctrlCCount.current = 0;
        setState((prev) => ({ ...prev, notification: null }));
      }, 2000);
    }
  });

  // Subscribe to bridge events
  useEffect(() => {
    const onStreamText = (text: string) => {
      setState((prev) => prev.phase === 'thinking' ? { ...prev, phase: 'streaming' } : prev);
      setLiveText((prev) => prev + text);
    };

    const onToolStart = (tool: { name: string; label: string }) => {
      setState((prev) => prev.phase === 'thinking' ? { ...prev, phase: 'streaming' } : prev);
      setLiveText((prev) => {
        if (prev) {
          setStaticItems((items) => [
            ...items,
            { id: nextId.current++, type: 'text', content: prev },
          ]);
        }
        return '';
      });
      setLiveTool(tool.label);
    };

    const onToolComplete = (tool: ToolCompleteInfo) => {
      setLiveTool((prev) => {
        if (prev) {
          const dur = tool.durationMs < 1000
            ? `${Math.round(tool.durationMs)}ms`
            : `${(tool.durationMs / 1000).toFixed(1)}s`;
          setStaticItems((items) => [
            ...items,
            { id: nextId.current++, type: 'tool', content: `\u2713 ${tool.label} (${dur})` },
          ]);
        }
        return null;
      });
    };

    const onToolDenied = (tool: { name: string; label: string }) => {
      setLiveTool(null);
      setStaticItems((items) => [
        ...items,
        { id: nextId.current++, type: 'error', content: `\u2717 ${tool.label} denied` },
      ]);
    };

    const onDiff = (diff: DiffInfo) => {
      setStaticItems((items) => [
        ...items,
        { id: nextId.current++, type: 'diff', content: '', diff },
      ]);
    };

    const onError = (message: string) => {
      setStaticItems((items) => [
        ...items,
        { id: nextId.current++, type: 'error', content: message },
      ]);
    };

    const onUsage = (usage: TokenUsage) => {
      setState((prev) => ({ ...prev, tokenUsage: usage }));
    };

    const onTurnComplete = () => {
      setLiveText((prev) => {
        if (prev) {
          setStaticItems((items) => [
            ...items,
            { id: nextId.current++, type: 'text', content: prev },
          ]);
        }
        return '';
      });
      setLiveTool(null);
      setState((prev) => ({ ...prev, phase: 'input', notification: null }));
      bridge.resetTurn();
    };

    const onThinkingStart = () => {
      setState((prev) => ({ ...prev, phase: 'thinking' }));
    };

    bridge.on('stream-text', onStreamText);
    bridge.on('tool-start', onToolStart);
    bridge.on('tool-complete', onToolComplete);
    bridge.on('tool-denied', onToolDenied);
    bridge.on('diff', onDiff);
    bridge.on('error', onError);
    bridge.on('usage', onUsage);
    bridge.on('turn-complete', onTurnComplete);
    bridge.on('thinking-start', onThinkingStart);

    return () => {
      bridge.off('stream-text', onStreamText);
      bridge.off('tool-start', onToolStart);
      bridge.off('tool-complete', onToolComplete);
      bridge.off('tool-denied', onToolDenied);
      bridge.off('diff', onDiff);
      bridge.off('error', onError);
      bridge.off('usage', onUsage);
      bridge.off('turn-complete', onTurnComplete);
      bridge.off('thinking-start', onThinkingStart);
    };
  }, [bridge]);

  const handleSubmit = useCallback((input: string) => {
    setStaticItems((items) => [
      ...items,
      { id: nextId.current++, type: 'user' as StaticItem['type'], content: input },
    ]);
    setState((prev) => ({ ...prev, phase: 'thinking', notification: null }));
    setLiveText('');
    setLiveTool(null);
    Promise.resolve(onMessage?.(input)).catch((err) => {
      bridge.emit('error', err instanceof Error ? err.message : String(err));
      setState((prev) => ({ ...prev, phase: 'input' }));
    });
  }, [onMessage, bridge]);

  // Intercept history-search slash command at the app level (FR-07)
  const handleSlashCommand = useCallback(async (command: string, args?: string) => {
    if (command === 'history-search') {
      setHistorySearchVisible(true);
      return;
    }
    // Hide BorderedInput while the command runs so InputRequestHandler can
    // capture keystrokes without interference. turn-complete resets to 'input'.
    setState((prev) => ({ ...prev, phase: 'slash-command' }));
    await onSlashCommand?.(command, args);
  }, [onSlashCommand]);

  return (
    <Box flexDirection="column">
      {/* Static output — rendered once, persists in terminal scrollback */}
      <Static items={staticItems}>
        {(item) => {
          switch (item.type) {
            case 'user':
              return <Text key={item.id} color="cyan" bold>{'\u276F'} {item.content}</Text>;
            case 'error':
              return <Text key={item.id} color="red">{item.content}</Text>;
            case 'tool':
              return <Text key={item.id} dimColor>  {item.content}</Text>;
            case 'diff':
              return item.diff
                ? <DiffView key={item.id} diff={item.diff} />
                : null;
            case 'text':
            default:
              return (
                <Box key={item.id} flexDirection="column">
                  {renderMarkdownBlocks(item.content)}
                </Box>
              );
          }
        }}
      </Static>

      {/* ── Dynamic area (re-rendered in place) ─────────────────────── */}

      {/* Live streaming text */}
      {liveText && (
        <Box flexDirection="column">
          {renderMarkdownBlocks(liveText)}
        </Box>
      )}

      {/* Activity bar — always rendered, fixed height, replaces the three
          conditional elements (spinner / streaming indicator / tool indicator)
          that previously caused vertical layout shifts (FR-05). */}
      <ActivityBar
        phase={state.phase}
        spinnerFrame={spinner.frame}
        spinnerElapsed={spinner.elapsed}
        liveTool={liveTool}
      />

      {/* Auto-recommendations — gated by config.suggestions (FR-06) */}
      {config.suggestions && (
        <SuggestionHint
          bridge={bridge}
          enabled={config.suggestions}
          onSuggestionChange={setActiveSuggestion}
          initialContext={initialContext}
        />
      )}

      {/* Reverse history search overlay (FR-07) */}
      <HistorySearch
        history={history ?? []}
        visible={historySearchVisible}
        onSelect={(selected) => {
          setHistorySearchVisible(false);
          injectedNonce.current += 1;
          setInjectedInput({ value: selected, nonce: injectedNonce.current });
        }}
        onDismiss={() => setHistorySearchVisible(false)}
      />

      {/* Approval prompt */}
      <ApprovalHandler bridge={bridge} />

      {/* Inline arg collection for slash commands (dispatchWithIntake) */}
      <InputRequestHandler bridge={bridge} />

      {/* Notification (e.g. Ctrl+C warning) */}
      {state.notification && (
        <Text color="yellow">{state.notification}</Text>
      )}

      {/* Input area — hidden while history search is active to prevent
          BorderedInput's useInput from intercepting keys (FR-07). */}
      {state.phase === 'input' && !historySearchVisible ? (
        <BorderedInput
          sessionIdentifier={state.sessionIdentifier}
          bordered={config.bordered_input}
          isActive={true}
          history={history}
          completionEngine={completionEngine}
          onSubmit={handleSubmit}
          onHistoryAppend={onHistoryAppend}
          onSlashCommand={handleSlashCommand}
          activeSuggestion={activeSuggestion}
          injectedValue={injectedInput}
        />
      ) : null}

      {/* Status bar */}
      <StatusBar
        bridge={bridge}
        model={state.model}
        sessionIdentifier={state.sessionIdentifier}
        branch={branch}
        visible={config.status_bar}
      />
    </Box>
  );
});

// ── Public API ──────────────────────────────────────────────────────────────

export function renderApp(
  bridge: AgentBridge,
  model: string,
  options?: {
    sessionIdentifier?: string;
    branch?: string;
    uiConfig?: Partial<UIConfig>;
    history?: string[];
    completionEngine?: CompletionEngine;
    onMessage?: (input: string) => Promise<void> | void;
    onHistoryAppend?: (entry: string) => void;
    onSlashCommand?: (command: string, args?: string) => Promise<void> | void;
    onExit?: () => Promise<void> | void;
    initialContext?: Partial<SuggestionContext>;
  },
): AppHandle {
  let imperativeHandle: AppImperativeHandle | null = null;

  const appRef = (handle: AppImperativeHandle | null) => {
    imperativeHandle = handle;
  };

  const instance = render(
    <CopairApp
      ref={appRef}
      bridge={bridge}
      model={model}
      sessionIdentifier={options?.sessionIdentifier}
      branch={options?.branch}
      uiConfig={options?.uiConfig}
      history={options?.history}
      completionEngine={options?.completionEngine}
      onMessage={options?.onMessage}
      onHistoryAppend={options?.onHistoryAppend}
      onSlashCommand={options?.onSlashCommand}
      onExit={options?.onExit}
      initialContext={options?.initialContext}
    />,
    { exitOnCtrlC: false },
  );

  return {
    unmount: () => instance.unmount(),
    updateModel: (m: string) => imperativeHandle?.updateModel(m),
    updateSession: (id: string) => imperativeHandle?.updateSession(id),
    waitForExit: () => instance.waitUntilExit(),
  };
}

export { CopairApp };
