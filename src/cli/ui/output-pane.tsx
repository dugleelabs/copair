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
        if (updated.length > maxNodes) {
          return updated.slice(updated.length - maxNodes);
        }
        return updated;
      });
    };

    // Append text to the last text node (streaming accumulation),
    // or create a new text node if the last node isn't text.
    const appendText = (chunk: string) => {
      setNodes((prev) => {
        const last = prev.length > 0 ? prev[prev.length - 1] : null;
        if (last && last.type === 'text') {
          // Mutate-in-place via new array — append to existing text node
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, content: last.content + chunk };
          return updated;
        }
        // No existing text node — create one
        const newNode: OutputNode = { id: nextId.current++, type: 'text', content: chunk };
        const updated = [...prev, newNode];
        if (updated.length > maxNodes) {
          return updated.slice(updated.length - maxNodes);
        }
        return updated;
      });
    };

    const onText = (text: string) => {
      // Process text for code fence detection
      // Split on newlines to detect ``` boundaries, but keep
      // non-fence text flowing in the same node.
      const lines = text.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (pendingCode.current) {
          // Inside a code block
          if (FENCE_CLOSE.test(line.trim())) {
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
          const trimmed = line.trim();
          const fenceMatch = trimmed.match(FENCE_OPEN);
          if (fenceMatch && trimmed !== '```') {
            pendingCode.current = { lang: fenceMatch[1] || '', lines: [] };
          } else if (trimmed === '```') {
            pendingCode.current = { lang: '', lines: [] };
          } else {
            // Regular text — accumulate into current text node
            // Add newline between lines (but not before the first)
            const prefix = i > 0 ? '\n' : '';
            const chunk = prefix + line;
            if (chunk) {
              appendText(chunk);
            }
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

    // On turn complete, seal the current text so next turn starts fresh
    const onTurnComplete = () => {
      // Force next text to start a new node by adding a blank separator
      addNode({ type: 'text', content: '' });
    };

    bridge.on('stream-text', onText);
    bridge.on('stream-code-block', onCodeBlock);
    bridge.on('error', onError);
    bridge.on('turn-complete', onTurnComplete);

    return () => {
      bridge.off('stream-text', onText);
      bridge.off('stream-code-block', onCodeBlock);
      bridge.off('error', onError);
      bridge.off('turn-complete', onTurnComplete);
    };
  }, [bridge, maxNodes]);

  if (nodes.length === 0) return null;

  return (
    <Box flexDirection="column">
      {nodes.map((node) => {
        if (!node.content && node.type === 'text') return null; // skip empty separators
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
            return <Text key={node.id} wrap="wrap">{renderInlineMarkdown(node.content)}</Text>;
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
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      parts.push(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    }
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
