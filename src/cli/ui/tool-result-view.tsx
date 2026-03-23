import React from 'react';
import { Box, Text } from 'ink';
import { CodeBlock } from './code-block.js';
import { SimpleDiff } from './diff-view.js';
import { fileLink } from './osc-link.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ToolResultViewProps {
  toolName: string;
  input: Record<string, unknown>;
  result?: string;
  durationMs?: number;
  syntaxHighlight?: boolean;
  maxLines?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const extMap: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rs: 'rust', go: 'go', yaml: 'yaml', yml: 'yaml',
    json: 'json', sh: 'bash', sql: 'sql', css: 'css', html: 'html',
    md: 'markdown', toml: 'toml',
  };
  return extMap[ext] ?? '';
}

function truncateLines(text: string, max: number): { text: string; truncated: number } {
  const lines = text.split('\n');
  if (lines.length <= max) return { text, truncated: 0 };
  return {
    text: lines.slice(0, max).join('\n'),
    truncated: lines.length - max,
  };
}

// ── Component ───────────────────────────────────────────────────────────────

export function ToolResultView({
  toolName,
  input,
  result,
  durationMs,
  syntaxHighlight = true,
  maxLines = 50,
}: ToolResultViewProps) {
  if (!result) return null;

  switch (toolName) {
    case 'read':
      return (
        <ReadResult
          filePath={input.file_path as string}
          result={result}
          syntaxHighlight={syntaxHighlight}
          maxLines={maxLines}
        />
      );

    case 'write':
      return (
        <WriteResult
          filePath={input.file_path as string}
          content={input.content as string | undefined}
        />
      );

    case 'edit':
      return (
        <EditResult
          filePath={input.file_path as string}
          oldStr={input.old_string as string | undefined}
          newStr={input.new_string as string | undefined}
        />
      );

    case 'bash':
      return (
        <BashResult
          command={input.command as string}
          result={result}
          maxLines={maxLines}
        />
      );

    case 'grep':
    case 'glob':
      return (
        <SearchResult
          toolName={toolName}
          result={result}
          maxLines={maxLines}
        />
      );

    default:
      return <GenericResult result={result} maxLines={maxLines} />;
  }
}

// ── Read Result ─────────────────────────────────────────────────────────────

function ReadResult({
  filePath,
  result,
  syntaxHighlight,
  maxLines,
}: {
  filePath: string;
  result: string;
  syntaxHighlight: boolean;
  maxLines: number;
}) {
  const lang = getLanguageFromPath(filePath);
  const { text, truncated } = truncateLines(result, maxLines);

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text dimColor>{fileLink(filePath)}</Text>
      <CodeBlock code={text} language={lang} syntaxHighlight={syntaxHighlight} />
      {truncated > 0 && (
        <Text dimColor italic>  [{truncated} more lines]</Text>
      )}
    </Box>
  );
}

// ── Write Result ────────────────────────────────────────────────────────────

function WriteResult({
  filePath,
  content,
}: {
  filePath: string;
  content?: string;
}) {
  const lineCount = content ? content.split('\n').length : 0;
  return (
    <Box marginLeft={2}>
      <Text dimColor>
        Wrote {fileLink(filePath)} ({lineCount} lines)
      </Text>
    </Box>
  );
}

// ── Edit Result ─────────────────────────────────────────────────────────────

function EditResult({
  filePath,
  oldStr,
  newStr,
}: {
  filePath: string;
  oldStr?: string;
  newStr?: string;
}) {
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text dimColor>{fileLink(filePath)}</Text>
      {oldStr !== undefined && newStr !== undefined && (
        <SimpleDiff oldText={oldStr} newText={newStr} maxLines={30} />
      )}
    </Box>
  );
}

// ── Bash Result ─────────────────────────────────────────────────────────────

function BashResult({
  command,
  result,
  maxLines,
}: {
  command: string;
  result: string;
  maxLines: number;
}) {
  const { text, truncated } = truncateLines(result, maxLines);
  // Check if exit code is in the last line
  const lines = result.split('\n');
  const lastLine = lines[lines.length - 1] ?? '';
  const exitMatch = lastLine.match(/^exit code: (\d+)$/i);
  const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : undefined;

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text dimColor>$ {command}</Text>
      {text && <Text>{text}</Text>}
      {truncated > 0 && (
        <Text dimColor italic>  [{truncated} more lines]</Text>
      )}
      {exitCode !== undefined && exitCode !== 0 && (
        <Text color="red">Exit code: {exitCode}</Text>
      )}
    </Box>
  );
}

// ── Search Result ───────────────────────────────────────────────────────────

function SearchResult({
  toolName,
  result,
  maxLines,
}: {
  toolName: string;
  result: string;
  maxLines: number;
}) {
  const { text, truncated } = truncateLines(result, maxLines);
  const lines = text.split('\n').filter(Boolean);

  return (
    <Box flexDirection="column" marginLeft={2}>
      {lines.map((line, i) => (
        <Text key={i} dimColor>{line}</Text>
      ))}
      {truncated > 0 && (
        <Text dimColor italic>  [{truncated} more results]</Text>
      )}
    </Box>
  );
}

// ── Generic Result ──────────────────────────────────────────────────────────

function GenericResult({ result, maxLines }: { result: string; maxLines: number }) {
  const { text, truncated } = truncateLines(result, maxLines);
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text>{text}</Text>
      {truncated > 0 && (
        <Text dimColor italic>  [{truncated} more lines]</Text>
      )}
    </Box>
  );
}
