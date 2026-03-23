import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { getColorLevel } from './color-support.js';

// Lazy-loaded shiki instance
let shikiHighlighter: ShikiHighlighter | null = null;
let shikiLoading = false;
const loadedLanguages = new Set<string>();

interface ShikiHighlighter {
  codeToAnsi: (code: string, options: { lang: string; theme: string }) => string;
  getLoadedLanguages: () => string[];
  loadLanguage: (lang: string) => Promise<void>;
}

const SUPPORTED_LANGUAGES = new Set([
  'typescript', 'javascript', 'python', 'rust', 'go',
  'yaml', 'json', 'bash', 'sql', 'tsx', 'jsx',
  'css', 'html', 'markdown', 'toml', 'shell',
]);

// Language alias map
const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
};

function resolveLang(lang: string): string {
  const lower = lang.toLowerCase();
  return LANG_ALIASES[lower] ?? lower;
}

async function getHighlighter(): Promise<ShikiHighlighter | null> {
  if (shikiHighlighter) return shikiHighlighter;
  if (shikiLoading) return null;
  shikiLoading = true;

  try {
    const shiki = await import('shiki');
    const highlighter = await shiki.createHighlighter({
      themes: ['dark-plus'],
      langs: [], // lazy-load languages
    });
    shikiHighlighter = highlighter as unknown as ShikiHighlighter;
    return shikiHighlighter;
  } catch {
    shikiLoading = false;
    return null;
  }
}

async function ensureLanguage(highlighter: ShikiHighlighter, lang: string): Promise<boolean> {
  if (loadedLanguages.has(lang)) return true;
  if (highlighter.getLoadedLanguages().includes(lang)) {
    loadedLanguages.add(lang);
    return true;
  }

  try {
    // 100ms timeout on grammar load
    await Promise.race([
      highlighter.loadLanguage(lang as Parameters<ShikiHighlighter['loadLanguage']>[0]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 100)),
    ]);
    loadedLanguages.add(lang);
    return true;
  } catch {
    return false;
  }
}

export interface CodeBlockProps {
  code: string;
  language?: string;
  syntaxHighlight?: boolean;
}

export function CodeBlock({ code, language, syntaxHighlight = true }: CodeBlockProps) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const colorLevel = getColorLevel();
  const lang = language ? resolveLang(language) : '';
  const canHighlight = syntaxHighlight && colorLevel >= 2 && lang && SUPPORTED_LANGUAGES.has(lang);

  useEffect(() => {
    if (!canHighlight) return;

    let cancelled = false;

    (async () => {
      const highlighter = await getHighlighter();
      if (cancelled || !highlighter) return;

      const loaded = await ensureLanguage(highlighter, lang);
      if (cancelled || !loaded) return;

      try {
        const ansi = highlighter.codeToAnsi(code, { lang, theme: 'dark-plus' });
        if (!cancelled) setHighlighted(ansi);
      } catch {
        // Fall through to plain text
      }
    })();

    return () => { cancelled = true; };
  }, [code, lang, canHighlight]);

  const content = highlighted ?? code;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingLeft={1}
      paddingRight={1}
    >
      {lang && (
        <Text dimColor>{lang}</Text>
      )}
      <Text>{content}</Text>
    </Box>
  );
}
