import React from 'react';
import { Box, Text } from 'ink';
import type { DiffInfo, DiffHunk } from './agent-bridge.js';

export interface DiffViewProps {
  diff: DiffInfo;
  maxLines?: number;
}

export function DiffView({ diff, maxLines = 30 }: DiffViewProps) {
  let lineCount = 0;
  let truncated = false;

  const renderHunk = (hunk: DiffHunk, hunkIndex: number) => {
    const lines: React.ReactNode[] = [];
    for (const line of hunk.lines) {
      if (lineCount >= maxLines) {
        truncated = true;
        break;
      }
      lineCount++;

      if (line.startsWith('+')) {
        lines.push(
          <Text key={`${hunkIndex}-${lineCount}`} backgroundColor="green" color="black">
            {line}
          </Text>,
        );
      } else if (line.startsWith('-')) {
        lines.push(
          <Text key={`${hunkIndex}-${lineCount}`} backgroundColor="red" color="black">
            {line}
          </Text>,
        );
      } else if (line.startsWith('@@')) {
        lines.push(
          <Text key={`${hunkIndex}-${lineCount}`} color="cyan">
            {line}
          </Text>,
        );
      } else {
        lines.push(
          <Text key={`${hunkIndex}-${lineCount}`} dimColor>
            {line}
          </Text>,
        );
      }
    }
    return lines;
  };

  const allLines = diff.hunks.flatMap((hunk, i) => renderHunk(hunk, i));
  const totalLines = diff.hunks.reduce((sum, h) => sum + h.lines.length, 0);

  return (
    <Box flexDirection="column">
      <Text dimColor>  -- {diff.filePath} --</Text>
      {allLines}
      {truncated && (
        <Text dimColor>  ...{totalLines - maxLines} more lines</Text>
      )}
    </Box>
  );
}

// ── Simple diff from old/new strings ────────────────────────────────────────

export interface SimpleDiffProps {
  filePath: string;
  oldContent: string | null;
  newContent: string;
  maxLines?: number;
}

export function SimpleDiff({ filePath, oldContent, newContent, maxLines = 30 }: SimpleDiffProps) {
  const lines: React.ReactNode[] = [];
  let count = 0;

  if (oldContent === null) {
    // New file — all additions
    for (const line of newContent.split('\n')) {
      if (count >= maxLines) break;
      lines.push(
        <Text key={count} backgroundColor="green" color="black">
          {` + ${line}`}
        </Text>,
      );
      count++;
    }
  } else {
    // Edit — show removals then additions
    for (const line of oldContent.split('\n')) {
      if (count >= maxLines) break;
      lines.push(
        <Text key={`old-${count}`} backgroundColor="red" color="black">
          {` - ${line}`}
        </Text>,
      );
      count++;
    }
    for (const line of newContent.split('\n')) {
      if (count >= maxLines) break;
      lines.push(
        <Text key={`new-${count}`} backgroundColor="green" color="black">
          {` + ${line}`}
        </Text>,
      );
      count++;
    }
  }

  const totalOld = oldContent ? oldContent.split('\n').length : 0;
  const totalNew = newContent.split('\n').length;
  const total = totalOld + totalNew;

  return (
    <Box flexDirection="column">
      <Text dimColor>  -- {filePath} --</Text>
      {lines}
      {total > maxLines && (
        <Text dimColor>  ...{total - maxLines} more lines</Text>
      )}
    </Box>
  );
}
