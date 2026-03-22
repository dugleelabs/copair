import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text } from 'ink';
import type { AgentBridge, TokenUsage } from './agent-bridge.js';

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

type AppPhase = 'input' | 'streaming' | 'approval' | 'idle';

interface AppState {
  phase: AppPhase;
  model: string;
  sessionIdentifier: string;
  tokenUsage: TokenUsage;
  contextWindowPercent: number;
  outputLines: string[];
}

// ── CopairApp ───────────────────────────────────────────────────────────────

interface CopairAppProps {
  bridge: AgentBridge;
  model: string;
  sessionIdentifier?: string;
  uiConfig?: Partial<UIConfig>;
}

function CopairApp({ bridge, model, sessionIdentifier, uiConfig: uiOverrides }: CopairAppProps) {
  const config = { ...DEFAULT_UI_CONFIG, ...uiOverrides };

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
    outputLines: [],
  });

  // Subscribe to bridge events
  useEffect(() => {
    const onText = (text: string) => {
      setState((prev) => ({
        ...prev,
        phase: 'streaming',
        outputLines: [...prev.outputLines, text],
      }));
    };

    const onUsage = (usage: TokenUsage) => {
      setState((prev) => ({ ...prev, tokenUsage: usage }));
    };

    const onTurnComplete = () => {
      setState((prev) => ({ ...prev, phase: 'input' }));
      bridge.resetTurn();
    };

    const onError = (message: string) => {
      setState((prev) => ({
        ...prev,
        outputLines: [...prev.outputLines, `\x1b[31m${message}\x1b[0m`],
      }));
    };

    bridge.on('stream-text', onText);
    bridge.on('usage', onUsage);
    bridge.on('turn-complete', onTurnComplete);
    bridge.on('error', onError);

    return () => {
      bridge.off('stream-text', onText);
      bridge.off('usage', onUsage);
      bridge.off('turn-complete', onTurnComplete);
      bridge.off('error', onError);
    };
  }, [bridge]);

  const updateModel = useCallback((newModel: string) => {
    setState((prev) => ({ ...prev, model: newModel }));
  }, []);

  const updateSession = useCallback((id: string) => {
    setState((prev) => ({ ...prev, sessionIdentifier: id }));
  }, []);

  return (
    <Box flexDirection="column">
      {/* Output area — placeholder for OutputPane */}
      {state.outputLines.length > 0 && (
        <Box flexDirection="column">
          {state.outputLines.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </Box>
      )}

      {/* Input area — placeholder for BorderedInput */}
      <Box>
        <Text color="cyan">copair ({state.model})</Text>
        {state.sessionIdentifier && (
          <Text dimColor> [{state.sessionIdentifier}]</Text>
        )}
        <Text color="gray"> &gt; </Text>
      </Box>
    </Box>
  );
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface AppHandle {
  unmount: () => void;
}

export function renderApp(
  bridge: AgentBridge,
  model: string,
  options?: {
    sessionIdentifier?: string;
    uiConfig?: Partial<UIConfig>;
  },
): AppHandle {
  const instance = render(
    <CopairApp
      bridge={bridge}
      model={model}
      sessionIdentifier={options?.sessionIdentifier}
      uiConfig={options?.uiConfig}
    />,
  );

  return {
    unmount: () => instance.unmount(),
  };
}

export { CopairApp };
