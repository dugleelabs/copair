import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const MAX_HISTORY = 500;

/**
 * Resolve the history file path.
 * Prefers project-level `.copair/history` if it exists.
 * Falls back to global `~/.copair/history`.
 */
export function resolveHistoryPath(cwd: string): string {
  const projectPath = join(cwd, '.copair', 'history');
  if (existsSync(join(cwd, '.copair'))) {
    return projectPath;
  }
  return join(homedir(), '.copair', 'history');
}

export function loadHistory(historyPath: string): string[] {
  try {
    const content = readFileSync(historyPath, 'utf-8');
    return content.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export function saveHistory(historyPath: string, entries: string[]): void {
  const trimmed = entries.slice(-MAX_HISTORY);
  const dir = dirname(historyPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(historyPath, trimmed.join('\n') + '\n', 'utf-8');
}

export function appendHistory(historyPath: string, entry: string): void {
  const entries = loadHistory(historyPath);
  // Deduplicate consecutive entries
  if (entries[entries.length - 1] !== entry) {
    entries.push(entry);
  }
  saveHistory(historyPath, entries);
}
