import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AgentBridge } from './agent-bridge.js';

interface Pending {
  prompt: string;
  respond: (value: string) => void;
}

interface InputRequestHandlerProps {
  bridge: AgentBridge;
}

/**
 * Renders an inline text input when the bridge emits 'input-request'.
 * Used by dispatchWithIntake to collect missing required command args
 * without freezing the terminal.
 */
export function InputRequestHandler({ bridge }: InputRequestHandlerProps) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    const onRequest = (prompt: string, respond: (value: string) => void) => {
      setPending({ prompt, respond });
      setValue('');
    };
    bridge.on('input-request', onRequest);
    return () => { bridge.off('input-request', onRequest); };
  }, [bridge]);

  const submit = useCallback(() => {
    if (!pending) return;
    pending.respond(value);
    setPending(null);
    setValue('');
  }, [pending, value]);

  useInput(
    (input, key) => {
      if (key.return) { submit(); return; }
      if (key.backspace || key.delete) { setValue((prev) => prev.slice(0, -1)); return; }
      if (!key.ctrl && !key.meta && input) { setValue((prev) => prev + input); }
    },
    { isActive: pending !== null },
  );

  if (!pending) return null;

  return (
    <Box flexDirection="column" marginY={1} paddingX={1}>
      <Text color="cyan">{pending.prompt}</Text>
      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text>{value}<Text color="cyan" bold>█</Text></Text>
      </Box>
    </Box>
  );
}
