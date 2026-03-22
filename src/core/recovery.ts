/**
 * @deprecated This module is deprecated and kept only for migration purposes.
 * Session persistence is now handled by SessionManager in src/core/session.ts.
 * This module will be removed in a future release.
 */
import { readFile, writeFile, unlink, chmod } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Message } from '../providers/interface.js';

const RECOVERY_DIR = resolve(process.env['HOME'] ?? '~', '.copair', 'sessions');
const RECOVERY_FILE = join(RECOVERY_DIR, 'recovery.json');

export interface RecoverySnapshot {
  model: string;
  messages: Message[];
  savedAt: string;
}

export async function writeRecovery(snapshot: RecoverySnapshot): Promise<void> {
  try {
    mkdirSync(RECOVERY_DIR, { recursive: true });
    const json = JSON.stringify(snapshot, null, 2);
    await writeFile(RECOVERY_FILE, json, { encoding: 'utf8' });
    await chmod(RECOVERY_FILE, 0o600);
  } catch {
    // Non-fatal — recovery is best-effort
  }
}

export async function deleteRecovery(): Promise<void> {
  try {
    await unlink(RECOVERY_FILE);
  } catch {
    // Already gone — fine
  }
}

export async function loadRecovery(): Promise<RecoverySnapshot | null> {
  if (!existsSync(RECOVERY_FILE)) return null;
  try {
    const json = await readFile(RECOVERY_FILE, 'utf8');
    return JSON.parse(json) as RecoverySnapshot;
  } catch {
    return null;
  }
}

export async function promptRecovery(snapshot: RecoverySnapshot): Promise<boolean> {
  const savedAt = new Date(snapshot.savedAt).toLocaleString();
  process.stdout.write(
    `\nPrevious session found (${savedAt}, model: ${snapshot.model}, ${snapshot.messages.length} messages).\n` +
      'Recover? [y/N] ',
  );

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.once('line', (line) => {
      rl.close();
      resolve(line.trim().toLowerCase() === 'y');
    });
    // Default to no if stdin closes immediately (non-interactive)
    rl.once('close', () => resolve(false));
  });
}
