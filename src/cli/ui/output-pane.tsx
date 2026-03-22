import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { CodeBlock } from './code-block.js';
import type { AgentBridge } from './agent-bridge.js';

// ── Types ───────────────────────────────────────────────────────────────────

interface OutputNode {
  id: number;
  type: 'text' | 'code-block' | 'error';
  content: string;
  language?: string;
}

export interface OutputPaneProps {
  bridge: AgentBridge;
  syntaxHighlight?: boolean;
  maxNodes?: number; // sliding window size
}

// ── Markdown fence detection ────────────────────────────────────────────────

const FENCE_OPEN = /^```(\w*)$/;
const FENCE_CLOSE = /^```$/;

// ── Component ───────────────────────────────────────────────────────────────

export function OutputPane({ bridge, syntaxHighlight = true, maxNodes = 200 }: OutputPaneProps) {
  const [nodes, setNodes] = useState<OutputNode[]>([]);
  const nextId = useRef(0);
  const pendingCode = useRef<{ lang: string; lines: string[] } | null>(null);

  useEffect(() => {
    const addNode = (node: Omit<OutputNode, 'id'>) => {
      setNodes((prev) => {
        const newNode = { ...node, id: nextId.current++ };
        const updated = [...prev, newNode];
        // Sliding window: keep only the most recent maxNodes
        if (updated.length > maxNodes) {
          return updated.slice(updated.length - maxNodes);
        }
        return updated;
      });
    };

    const onText = (text: string) => {
      // Process text line by line for code fence detection
      const lines = text.split('\n');
      for (const line of lines) {
        if (pendingCode.current) {
          // Inside a code block
          if (FENCE_CLOSE.test(line.trim())) {
            // Close the code block
            addNode({
              type: 'code-block',
              content: pendingCode.current.lines.join('\n'),
              language: pendingCode.current.lang,
            });
            pendingCode.current = null;
          } else {
            pendingCode.current.lines.push(line);
          }
        } else {
          const fenceMatch = line.trim().match(FENCE_OPEN);
          if (fenceMatch && line.trim() !== '```') {
            // Opening a code block with language tag
            pendingCode.current = { lang: fenceMatch[1] || '', lines: [] };
          } else if (line.trim() === '```') {
            // Could be opening or closing — if no pending, treat as opening
            pendingCode.current = { lang: '', lines: [] };
          } else if (line) {
            addNode({ type: 'text', content: line });
          }
        }
      }
    };

    const onCodeBlock = (code: string, lang: string) => {
      addNode({ type: 'code-block', content: code, language: lang });
    };

    const onError = (message: string) => {
      addNode({ type: 'error', content: message });
    };

    bridge.on('stream-text', onText);
    bridge.on('stream-code-block', onCodeBlock);
    bridge.on('error', onError);

    return () => {
      bridge.off('stream-text', onText);
      bridge.off('stream-code-block', onCodeBlock);
      bridge.off('error', onError);
    };
  }, [bridge, maxNodes]);

  if (nodes.length === 0) return null;

  return (
    <Box flexDirection="column">
      {nodes.map((node) => {
        switch (node.type) {
          case 'code-block':
            return (
              <CodeBlock
                key={node.id}
                code={node.content}
                language={node.language}
                syntaxHighlight={syntaxHighlight}
              />
            );
          case 'error':
            return <Text key={node.id} color="red">{node.content}</Text>;
          case 'text':
          default:
            return <Text key={node.id}>{renderInlineMarkdown(node.content)}</Text>;
        }
      })}
    </Box>
  );
}

// ── Inline markdown rendering ───────────────────────────────────────────────

function renderInlineMarkdown(text: string): React.ReactNode {
  // Simple inline markdown: **bold**, *italic*, `code`
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      parts.push(<Text key={key++} bold>{boldMatch[1]}</Text>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text*
    const italicMatch = remaining.match(/^\*(.+?)\*/);
    if (italicMatch) {
      parts.push(<Text key={key++} italic>{italicMatch[1]}</Text>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Inline code: `text`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(<Text key={key++} color="cyan">{codeMatch[1]}</Text>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Plain text — consume until next special character
    const nextSpecial = remaining.search(/[*`]/);
    if (nextSpecial === -1) {
      parts.push(remaining);
      break;
    }
    if (nextSpecial === 0) {
      // Special char that didn't match any pattern — treat as literal
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      parts.push(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    }
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
