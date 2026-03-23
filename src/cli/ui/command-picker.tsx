import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface PickerItem {
  label: string;
  value: string;
  description?: string;
}

export interface CommandPickerProps {
  title: string;
  items: PickerItem[];
  onSelect: (value: string) => void;
  onCancel: () => void;
  isActive?: boolean;
}

export function CommandPicker({ title, items, onSelect, onCancel, isActive = true }: CommandPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const maxVisible = 10;

  useInput(
    (input, key) => {
      if (key.upArrow) {
        setSelectedIndex((i) => (i > 0 ? i - 1 : items.length - 1));
      } else if (key.downArrow) {
        setSelectedIndex((i) => (i < items.length - 1 ? i + 1 : 0));
      } else if (key.return) {
        if (items[selectedIndex]) {
          onSelect(items[selectedIndex].value);
        }
      } else if (key.escape) {
        onCancel();
      } else if (input >= '1' && input <= '9') {
        const idx = parseInt(input, 10) - 1;
        if (idx < items.length) {
          onSelect(items[idx].value);
        }
      }
    },
    { isActive },
  );

  if (items.length === 0) {
    return (
      <Box marginLeft={2}>
        <Text dimColor>No items available.</Text>
      </Box>
    );
  }

  const startIdx = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
  const visibleItems = items.slice(startIdx, startIdx + maxVisible);

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>{title}</Text>
      {visibleItems.map((item, i) => {
        const globalIdx = startIdx + i;
        const isSelected = globalIdx === selectedIndex;
        return (
          <Box key={item.value}>
            <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
              {isSelected ? '> ' : '  '}
              {globalIdx + 1}. {item.label}
            </Text>
            {item.description && (
              <Text dimColor> - {item.description}</Text>
            )}
          </Box>
        );
      })}
      {items.length > maxVisible && (
        <Text dimColor>  [{items.length} total, use arrows to scroll]</Text>
      )}
      <Text dimColor>  [Enter] select  [Esc] cancel  [1-9] quick pick</Text>
    </Box>
  );
}
