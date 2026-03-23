import React, { useState, useEffect, useCallback, useImperativeHandle, forwardRef, useRef } from 'react';
import { render, Box, Text, Static, useApp, useInput } from 'ink';
import type { AgentBridge, TokenUsage, ToolCompleteInfo } from './agent-bridge.js';
import { BorderedInput } from './bordered-input.js';
import { StatusBar } from './status-bar.js';
import { ApprovalHandler } from './approval-handler.js';
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

type AppPhase = 'input' | 'thinking' | 'streaming' | 'approval' | 'idle';

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
  type: 'text' | 'tool' | 'error' | 'user';
  content: string;
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

// ── CopairApp ───────────────────────────────────────────────────────────────

interface CopairAppProps {
  bridge: AgentBridge;
  model: string;
  sessionIdentifier?: string;
  uiConfig?: Partial<UIConfig>;
  history?: string[];
  completionEngine?: CompletionEngine;
  onMessage?: (input: string) => Promise<void> | void;
  onHistoryAppend?: (entry: string) => void;
  onSlashCommand?: (command: string, args?: string) => Promise<void> | void;
  onExit?: () => Promise<void> | void;
}

const CopairApp = forwardRef<AppImperativeHandle, CopairAppProps>(function CopairApp(
  {
    bridge,
    model,
    sessionIdentifier,
    uiConfig: uiOverrides,
    history,
    completionEngine,
    onMessage,
    onHistoryAppend,
    onSlashCommand,
    onExit,
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

  const spinner = useSpinner(state.phase === 'thinking');

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
      // Show notification in the dynamic area (near input/status), not in output
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
      // If there was live text, finalize it to static
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
      // Finalize any remaining live text to static
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
    bridge.on('error', onError);
    bridge.on('usage', onUsage);
    bridge.on('turn-complete', onTurnComplete);
    bridge.on('thinking-start', onThinkingStart);

    return () => {
      bridge.off('stream-text', onStreamText);
      bridge.off('tool-start', onToolStart);
      bridge.off('tool-complete', onToolComplete);
      bridge.off('tool-denied', onToolDenied);
      bridge.off('error', onError);
      bridge.off('usage', onUsage);
      bridge.off('turn-complete', onTurnComplete);
      bridge.off('thinking-start', onThinkingStart);
    };
  }, [bridge]);

  const handleSubmit = useCallback((input: string) => {
    // Persist user message in scrollback
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
            case 'text':
            default:
              return <Text key={item.id} wrap="wrap">{item.content}</Text>;
          }
        }}
      </Static>

      {/* ── Dynamic area (re-rendered in place) ─────────────────────── */}

      {/* Thinking spinner */}
      {state.phase === 'thinking' && (
        <Text>  <Text color="magenta">{spinner.frame}</Text> <Text dimColor>thinking... <Text color="gray">{spinner.elapsed}</Text></Text></Text>
      )}

      {/* Live streaming text */}
      {liveText && (
        <Text wrap="wrap">{liveText}</Text>
      )}

      {/* Live tool indicator */}
      {liveTool && (
        <Text color="green">  {'\u25CF'} {liveTool}</Text>
      )}

      {/* Approval prompt */}
      <ApprovalHandler bridge={bridge} />

      {/* Notification (e.g. Ctrl+C warning) — above input, near status */}
      {state.notification && (
        <Text color="yellow">{state.notification}</Text>
      )}

      {/* Input area — full bordered box only during input phase */}
      {state.phase === 'input' ? (
        <BorderedInput
          sessionIdentifier={state.sessionIdentifier}
          bordered={config.bordered_input}
          isActive={true}
          history={history}
          completionEngine={completionEngine}
          onSubmit={handleSubmit}
          onHistoryAppend={onHistoryAppend}
          onSlashCommand={onSlashCommand}
        />
      ) : null}

      {/* Status bar */}
      <StatusBar
        bridge={bridge}
        model={state.model}
        sessionIdentifier={state.sessionIdentifier}
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
    uiConfig?: Partial<UIConfig>;
    history?: string[];
    completionEngine?: CompletionEngine;
    onMessage?: (input: string) => Promise<void> | void;
    onHistoryAppend?: (entry: string) => void;
    onSlashCommand?: (command: string, args?: string) => Promise<void> | void;
    onExit?: () => Promise<void> | void;
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
      uiConfig={options?.uiConfig}
      history={options?.history}
      completionEngine={options?.completionEngine}
      onMessage={options?.onMessage}
      onHistoryAppend={options?.onHistoryAppend}
      onSlashCommand={options?.onSlashCommand}
      onExit={options?.onExit}
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
