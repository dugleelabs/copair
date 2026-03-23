import React, { useState, useCallback } from 'react';
import { Box, useInput } from 'ink';
import { ApprovalPrompt } from './approval-prompt.js';
import type { AgentBridge, ApprovalRequest, ApprovalAnswer } from './agent-bridge.js';

export interface ApprovalHandlerProps {
  bridge: AgentBridge;
}

/**
 * Listens for approval-request events from the bridge and renders
 * the ApprovalPrompt with single-keystroke input handling.
 *
 * Uses ink's useInput() — no manual raw mode, no echo duplication.
 */
export function ApprovalHandler({ bridge }: ApprovalHandlerProps) {
  const [pending, setPending] = useState<{
    request: ApprovalRequest;
    respond: (answer: ApprovalAnswer) => void;
  } | null>(null);

  // Listen for approval requests
  React.useEffect(() => {
    const onRequest = (request: ApprovalRequest, respond: (answer: ApprovalAnswer) => void) => {
      setPending({ request, respond });
    };
    bridge.on('approval-request', onRequest);
    return () => { bridge.off('approval-request', onRequest); };
  }, [bridge]);

  const handleResponse = useCallback((answer: ApprovalAnswer) => {
    if (!pending) return;
    pending.respond(answer);
    setPending(null);
  }, [pending]);

  // Single-keystroke handling via ink's useInput — no duplicate echo (FR-12, US-10)
  useInput(
    (input, key) => {
      if (!pending) return;

      switch (input.toLowerCase()) {
        case 'y':
          handleResponse('allow');
          break;
        case 'a':
          // Lowercase 'a' = always allow this operation
          handleResponse('always');
          break;
        case 'n':
          handleResponse('deny');
          break;
        case 's':
          handleResponse('similar');
          break;
      }

      // Uppercase 'A' = approve all remaining in turn
      if (input === 'A') {
        handleResponse('all');
      }

      // Escape = deny
      if (key.escape) {
        handleResponse('deny');
      }
    },
    { isActive: pending !== null },
  );

  if (!pending) return null;

  return (
    <Box>
      <ApprovalPrompt
        request={pending.request}
        onRespond={handleResponse}
      />
    </Box>
  );
}
