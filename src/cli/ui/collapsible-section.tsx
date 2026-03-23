import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface CollapsibleSectionProps {
  content: string;
  maxLines?: number;
  label?: string;
  defaultExpanded?: boolean;
  isActive?: boolean;
}

export function CollapsibleSection({
  content,
  maxLines = 30,
  label,
  defaultExpanded = false,
  isActive = false,
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const lines = content.split('\n');
  const shouldCollapse = lines.length > maxLines;

  useInput(
    (input) => {
      if (input === 'e' || input === ' ') {
        setExpanded((prev) => !prev);
      }
    },
    { isActive: isActive && shouldCollapse },
  );

  if (!shouldCollapse) {
    return (
      <Box flexDirection="column">
        {label && <Text dimColor>{label}</Text>}
        <Text>{content}</Text>
      </Box>
    );
  }

  const visibleLines = expanded ? lines : lines.slice(0, maxLines);
  const hiddenCount = lines.length - maxLines;

  return (
    <Box flexDirection="column">
      {label && <Text dimColor>{label}</Text>}
      <Text>{visibleLines.join('\n')}</Text>
      {!expanded && (
        <Text dimColor italic>
          {'  '}[+{hiddenCount} more lines]
        </Text>
      )}
      {expanded && lines.length > maxLines && (
        <Text dimColor italic>
          {'  '}[{lines.length} lines total]
        </Text>
      )}
    </Box>
  );
}
