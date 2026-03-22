import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { AgentBridge, ToolInfo, ToolCompleteInfo } from './agent-bridge.js';

// ── FSM States ──────────────────────────────────────────────────────────────

type GroupState = 'SINGLE' | 'COLLAPSING' | 'SUMMARY';

interface ToolGroup {
  toolName: string;
  count: number;
  lastLabel: string;
  state: GroupState;
  failed: boolean;
}

// ── Display format definitions ──────────────────────────────────────────────

const DISPLAY_FORMATS: Record<string, { collapsing: string; summary: string }> = {
  read:  { collapsing: 'Reading',   summary: 'Read' },
  write: { collapsing: 'Writing',   summary: 'Wrote' },
  edit:  { collapsing: 'Editing',   summary: 'Edited' },
  grep:  { collapsing: 'Searching', summary: 'Searched' },
  glob:  { collapsing: 'Globbing',  summary: 'Globbed' },
  bash:  { collapsing: 'Running',   summary: 'Ran' },
};

function getCollapsingText(toolName: string, count: number, label: string): string {
  const fmt = DISPLAY_FORMATS[toolName];
  if (fmt) return `${fmt.collapsing} (${count}) ${label}...`;
  return `${toolName} (${count}) ${label}...`;
}

function getSummaryText(toolName: string, count: number): string {
  const fmt = DISPLAY_FORMATS[toolName];
  if (fmt) {
    const noun = toolName === 'grep' || toolName === 'glob' ? 'patterns' : 'files';
    const unit = toolName === 'bash' ? 'commands' : noun;
    return `${fmt.summary} ${count} ${unit}`;
  }
  return `${toolName}: ${count} calls`;
}

// ── Component ───────────────────────────────────────────────────────────────

export interface ToolCallGroupProps {
  bridge: AgentBridge;
  collapsingEnabled?: boolean;
  verbose?: boolean;
}

interface ToolCallEntry {
  id: number;
  name: string;
  label: string;
  durationMs?: number;
  status: 'running' | 'complete' | 'denied';
  isError?: boolean;
}

export function ToolCallGroup({ bridge, collapsingEnabled = true, verbose = false }: ToolCallGroupProps) {
  const [entries, setEntries] = useState<ToolCallEntry[]>([]);
  const [currentGroup, setCurrentGroup] = useState<ToolGroup | null>(null);
  const [completedGroups, setCompletedGroups] = useState<Array<{ text: string; count: number }>>([]);
  const nextId = React.useRef(0);

  useEffect(() => {
    const shouldCollapse = collapsingEnabled && !verbose;

    const onToolStart = (tool: ToolInfo) => {
      if (!shouldCollapse) {
        // No collapsing — show every tool individually
        setEntries((prev) => [
          ...prev,
          { id: nextId.current++, name: tool.name, label: tool.label, status: 'running' },
        ]);
        return;
      }

      setCurrentGroup((prev) => {
        if (!prev) {
          // First tool — SINGLE state
          return { toolName: tool.name, count: 1, lastLabel: tool.label, state: 'SINGLE', failed: false };
        }

        if (prev.toolName === tool.name && !prev.failed) {
          // Same tool — transition to COLLAPSING
          return { ...prev, count: prev.count + 1, lastLabel: tool.label, state: 'COLLAPSING' };
        }

        // Different tool — finalize current group as SUMMARY, start new
        if (prev.count > 1) {
          setCompletedGroups((g) => [
            ...g,
            { text: getSummaryText(prev.toolName, prev.count), count: prev.count },
          ]);
        }
        return { toolName: tool.name, count: 1, lastLabel: tool.label, state: 'SINGLE', failed: false };
      });
    };

    const onToolComplete = (tool: ToolCompleteInfo) => {
      if (!shouldCollapse) {
        setEntries((prev) =>
          prev.map((e) =>
            e.status === 'running' && e.name === tool.name
              ? { ...e, status: 'complete', durationMs: tool.durationMs }
              : e,
          ),
        );
        return;
      }

      // In collapsing mode, tool-complete just updates the group
      // (the rendering is handled by currentGroup state)
    };

    const onToolDenied = (tool: { name: string; label: string }) => {
      if (!shouldCollapse) {
        setEntries((prev) =>
          prev.map((e) =>
            e.status === 'running' && e.name === tool.name
              ? { ...e, status: 'denied' }
              : e,
          ),
        );
        return;
      }

      // Failed/denied tools break the collapsing sequence
      setCurrentGroup((prev) => {
        if (prev) {
          return { ...prev, failed: true };
        }
        return prev;
      });
    };

    const onText = () => {
      if (!shouldCollapse) return;
      // Text output breaks the collapsing sequence
      setCurrentGroup((prev) => {
        if (prev && prev.count > 1) {
          setCompletedGroups((g) => [
            ...g,
            { text: getSummaryText(prev.toolName, prev.count), count: prev.count },
          ]);
        }
        return null;
      });
    };

    const onTurnComplete = () => {
      // Finalize any remaining group
      setCurrentGroup((prev) => {
        if (prev && prev.count > 1) {
          setCompletedGroups((g) => [
            ...g,
            { text: getSummaryText(prev.toolName, prev.count), count: prev.count },
          ]);
        }
        return null;
      });
      setEntries([]);
    };

    bridge.on('tool-start', onToolStart);
    bridge.on('tool-complete', onToolComplete);
    bridge.on('tool-denied', onToolDenied);
    bridge.on('stream-text', onText);
    bridge.on('turn-complete', onTurnComplete);

    return () => {
      bridge.off('tool-start', onToolStart);
      bridge.off('tool-complete', onToolComplete);
      bridge.off('tool-denied', onToolDenied);
      bridge.off('stream-text', onText);
      bridge.off('turn-complete', onTurnComplete);
    };
  }, [bridge, collapsingEnabled, verbose]);

  return (
    <Box flexDirection="column">
      {/* Completed groups (summaries) */}
      {completedGroups.map((group, i) => (
        <Text key={`group-${i}`} dimColor>
          {'  '}{'\u2713'} {group.text}
        </Text>
      ))}

      {/* Current collapsing group */}
      {currentGroup && currentGroup.state === 'COLLAPSING' && (
        <Text color="green">
          {'  '}{'\u25CF'} {getCollapsingText(currentGroup.toolName, currentGroup.count, currentGroup.lastLabel)}
        </Text>
      )}

      {/* Current single tool (non-collapsed) */}
      {currentGroup && currentGroup.state === 'SINGLE' && (
        <Text color="green">
          {'  '}{'\u25CF'} {currentGroup.lastLabel}
        </Text>
      )}

      {/* Individual entries (verbose / non-collapsing mode) */}
      {entries.map((entry) => (
        <Box key={entry.id}>
          {entry.status === 'running' && (
            <Text color="green">{'  '}{'\u25CF'} {entry.label}</Text>
          )}
          {entry.status === 'complete' && (
            <Text dimColor>
              {'  '}{'\u2713'} {entry.label}
              {entry.durationMs !== undefined && ` (${formatDuration(entry.durationMs)})`}
            </Text>
          )}
          {entry.status === 'denied' && (
            <Text color="red">{'  '}{'\u2717'} {entry.label} denied</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
