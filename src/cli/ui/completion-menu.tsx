import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CompletionItem } from './completion-providers.js';

export interface CompletionMenuProps {
  items: CompletionItem[];
  visible: boolean;
  onSelect: (value: string) => void;
  onDismiss: () => void;
}

export function CompletionMenu({ items, visible, onSelect, onDismiss }: CompletionMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput(
    (input, key) => {
      if (!visible || items.length === 0) return;

      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (key.return || key.tab) {
        onSelect(items[selectedIndex].value);
        setSelectedIndex(0);
        return;
      }
      if (key.escape) {
        onDismiss();
        setSelectedIndex(0);
        return;
      }
    },
    { isActive: visible && items.length > 0 },
  );

  if (!visible || items.length === 0) return null;

  // Cap displayed items
  const maxVisible = 8;
  const displayItems = items.slice(0, maxVisible);

  return (
    <Box flexDirection="column" marginLeft={2}>
      {displayItems.map((item, i) => (
        <Box key={item.value}>
          <Text
            color={i === selectedIndex ? 'cyan' : undefined}
            bold={i === selectedIndex}
          >
            {i === selectedIndex ? '> ' : '  '}
            {item.label}
          </Text>
          {item.description && (
            <Text dimColor> - {item.description}</Text>
          )}
        </Box>
      ))}
      {items.length > maxVisible && (
        <Text dimColor>  ...and {items.length - maxVisible} more</Text>
      )}
    </Box>
  );
}
