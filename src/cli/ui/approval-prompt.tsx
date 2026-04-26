import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { SimpleDiff } from './diff-view.js';
import type { ApprovalRequest, ApprovalAnswer } from './agent-bridge.js';

export interface ApprovalPromptProps {
  request: ApprovalRequest;
  onRespond: (answer: ApprovalAnswer) => void;
}

export function ApprovalPrompt({ request, onRespond: _onRespond }: ApprovalPromptProps) {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;

  // Full-width adaptive box — no truncation (FR-11, US-10)
  const boxWidth = Math.min(columns - 4, 120);

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="yellow"
        width={boxWidth}
        paddingLeft={1}
        paddingRight={1}
      >
        {/* Header with counter */}
        <Box>
          <Text color="yellow" bold>
            {'\u26A0'} Approval required
          </Text>
          {request.total > 1 && (
            <Text dimColor> [{request.index + 1}/{request.total}]</Text>
          )}
        </Box>

        {/* Sensitive path warning — shown before command summary when present */}
        {request.warning && (
          <Box marginTop={1}>
            <Text color="red" bold>{'\u26A0'} WARNING: </Text>
            <Text wrap="wrap">
              {'This command accesses a sensitive system path outside the project root ('}
              {request.warning}
              {')'}
            </Text>
          </Box>
        )}

        {/* Cross-repo bash warning */}
        {request.crossRepoBashPath && (
          <Box marginTop={1}>
            <Text color="red" bold>{'\u26A0'} WARNING: </Text>
            <Text wrap="wrap">
              {'This bash command references a path outside the project root ('}
              {request.crossRepoBashPath}
              {')'}
            </Text>
          </Box>
        )}

        {/* Cross-repo read warning */}
        {request.crossRepoReadPath && (
          <Box marginTop={1}>
            <Text color="yellow" bold>{'\u26A0'} </Text>
            <Text wrap="wrap">
              {'This path is outside the current project root — approval required ('}
              {request.crossRepoReadPath}
              {')'}
            </Text>
          </Box>
        )}

        {/* Tool name and full summary — NO truncation */}
        <Box marginTop={1}>
          <Text bold>{request.toolName}: </Text>
          <Text wrap="wrap">{request.summary}</Text>
        </Box>

        {/* Diff preview shown before approval (F-03) */}
        {request.diff && (
          <Box marginTop={1}>
            <SimpleDiff
              filePath={request.diff.filePath}
              oldContent={request.diff.oldContent}
              newContent={request.diff.newContent}
              maxLines={20}
            />
          </Box>
        )}

        {/* Quick keys */}
        <Box marginTop={1}>
          <Text color="green">[y] </Text><Text>allow  </Text>
          <Text color="cyan">[a] </Text><Text>always  </Text>
          <Text color="red">[n] </Text><Text>deny  </Text>
          <Text color="yellow">[A] </Text><Text>all  </Text>
          <Text color="magenta">[s] </Text><Text>similar</Text>
        </Box>
      </Box>
    </Box>
  );
}
