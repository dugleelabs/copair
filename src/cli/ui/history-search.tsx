import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

export interface HistorySearchProps {
  history: string[];
  visible: boolean;
  onSelect: (value: string) => void;
  onDismiss: () => void;
}

export function HistorySearch({ history, visible, onSelect, onDismiss }: HistorySearchProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Fuzzy filter: all query characters must appear in order
  const filtered = useMemo(() => {
    if (!query) return history.slice(0, 20);
    const lowerQuery = query.toLowerCase();
    return history.filter((entry) => {
      const lower = entry.toLowerCase();
      let qi = 0;
      for (let i = 0; i < lower.length && qi < lowerQuery.length; i++) {
        if (lower[i] === lowerQuery[qi]) qi++;
      }
      return qi === lowerQuery.length;
    }).slice(0, 20);
  }, [history, query]);

  useInput(
    (_input, key) => {
      if (!visible) return;
      if (key.escape) {
        setQuery('');
        setSelectedIndex(0);
        onDismiss();
        return;
      }
      if (key.return) {
        if (filtered.length > 0) {
          onSelect(filtered[selectedIndex]);
        }
        setQuery('');
        setSelectedIndex(0);
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
        return;
      }
    },
    { isActive: visible },
  );

  if (!visible) return null;

  const maxVisible = 10;
  const displayItems = filtered.slice(0, maxVisible);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingLeft={1} paddingRight={1}>
      <Box>
        <Text color="yellow" bold>reverse-i-search: </Text>
        <TextInput value={query} onChange={(v) => { setQuery(v); setSelectedIndex(0); }} focus={visible} />
      </Box>
      {displayItems.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {displayItems.map((entry, i) => (
            <Text
              key={i}
              color={i === selectedIndex ? 'cyan' : undefined}
              bold={i === selectedIndex}
            >
              {i === selectedIndex ? '> ' : '  '}{entry}
            </Text>
          ))}
          {filtered.length > maxVisible && (
            <Text dimColor>  ...{filtered.length - maxVisible} more matches</Text>
          )}
        </Box>
      ) : (
        <Text dimColor>  No matches</Text>
      )}
    </Box>
  );
}
