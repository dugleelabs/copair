import React, { useState, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import { ContextBar } from './context-bar.js';
import type { AgentBridge, TokenUsage } from './agent-bridge.js';

export interface StatusBarProps {
  bridge: AgentBridge;
  model: string;
  sessionIdentifier?: string;
  visible?: boolean;
}

export function StatusBar({ bridge, model, sessionIdentifier, visible = true }: StatusBarProps) {
  const { stdout } = useStdout();
  const [usage, setUsage] = useState<TokenUsage>({
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    sessionInputTokens: 0,
    sessionOutputTokens: 0,
    sessionCost: 0,
  });
  const [contextPercent, setContextPercent] = useState(0);

  useEffect(() => {
    const onUsage = (u: TokenUsage) => setUsage(u);
    bridge.on('usage', onUsage);
    return () => { bridge.off('usage', onUsage); };
  }, [bridge]);

  if (!visible) return null;

  // Non-TTY: no status bar
  if (!stdout?.isTTY) return null;

  const tokens = `${usage.sessionInputTokens.toLocaleString()} in / ${usage.sessionOutputTokens.toLocaleString()} out`;
  const cost = `$${usage.sessionCost.toFixed(2)}`;

  return (
    <Box width="100%" justifyContent="space-between">
      <Box>
        <Text color="cyan" bold>{model}</Text>
        <Text dimColor> | </Text>
        <Text>{tokens}</Text>
        <Text dimColor> | </Text>
        <Text color="yellow">{cost}</Text>
      </Box>
      <Box>
        <ContextBar percent={contextPercent} />
        {sessionIdentifier && (
          <>
            <Text dimColor> | </Text>
            <Text dimColor>{sessionIdentifier}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
