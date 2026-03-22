import { writeFile, rename, appendFile, readFile, readdir, rm, mkdir, stat } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { gzipSync, gunzipSync } from 'node:zlib';
import { ConversationManager } from './conversation.js';
import type { Message } from '../providers/interface.js';

const COMPRESSION_THRESHOLD = 100 * 1024; // 100KB

// ---------------------------------------------------------------------------
// Atomic write utility
// ---------------------------------------------------------------------------

export async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  await writeFile(tmpPath, data, { mode: 0o600 });
  await rename(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Session directory resolution
// ---------------------------------------------------------------------------

export function resolveSessionsDir(cwd: string): string {
  // 1. Git root .copair/sessions/
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (gitRoot) {
      const dir = join(gitRoot, '.copair', 'sessions');
      mkdirSync(dir, { recursive: true });
      return dir;
    }
  } catch {
    // Not a git repo — fall through
  }

  // 2. cwd .copair/sessions/
  const cwdCopair = join(cwd, '.copair');
  if (existsSync(cwdCopair)) {
    const dir = join(cwdCopair, 'sessions');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  // 3. Global fallback
  const home = process.env['HOME'] ?? '~';
  const dir = join(resolve(home), '.copair', 'sessions');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Gitignore management
// ---------------------------------------------------------------------------

export async function ensureGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = join(projectRoot, '.copair', '.gitignore');
  const entry = 'sessions/\n';

  if (!existsSync(gitignorePath)) {
    const dir = join(projectRoot, '.copair');
    mkdirSync(dir, { recursive: true });
    await writeFile(gitignorePath, entry, { mode: 0o644 });
    return;
  }

  const content = await readFile(gitignorePath, 'utf8');
  if (!content.includes('sessions/')) {
    await appendFile(gitignorePath, entry);
  }
}

// ---------------------------------------------------------------------------
// Git tracking warning
// ---------------------------------------------------------------------------

export function warnIfSessionsTracked(cwd: string): void {
  try {
    const result = execSync('git ls-files .copair/sessions/', {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (result) {
      process.stderr.write(
        '[session] Warning: .copair/sessions/ is tracked by git. Add it to .gitignore.\n',
      );
    }
  } catch {
    // Not a git repo or git not available — skip
  }
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Session picker UI
// ---------------------------------------------------------------------------

export async function presentSessionPicker(
  sessions: SessionMetadata[],
): Promise<string | null> {
  if (sessions.length === 0) return null;

  console.log('\nPrevious sessions:');
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    console.log(
      `  ${i + 1}. ${s.identifier}  (${timeAgo(s.lastActive)}, ${s.messageCount} msgs, ${s.model})`,
    );
  }
  console.log(`  ${sessions.length + 1}. Start fresh`);
  process.stdout.write(`\nSelect [1-${sessions.length + 1}]: `);

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.once('line', (line) => {
      rl.close();
      const choice = parseInt(line.trim(), 10);
      if (choice >= 1 && choice <= sessions.length) {
        resolve(sessions[choice - 1].id);
      } else {
        resolve(null);
      }
    });
    rl.once('close', () => resolve(null));
  });
}

// ---------------------------------------------------------------------------
// Session metadata
// ---------------------------------------------------------------------------

export interface SessionMetadata {
  id: string;
  identifier: string;
  model: string;
  created: string;
  lastActive: string;
  messageCount: number;
  hasSummary: boolean;
  branch?: string;
  identifierDerived?: boolean;
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export class SessionManager {
  private metadata!: SessionMetadata;
  private sessionDir!: string;
  private sessionsDir: string;
  private saveOffset = 0;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.sessionsDir = resolveSessionsDir(projectRoot);
  }

  // -- Lifecycle ------------------------------------------------------------

  async create(model: string, branch?: string): Promise<SessionMetadata> {
    const id = randomUUID();
    this.sessionDir = join(this.sessionsDir, id);
    await mkdir(this.sessionDir, { recursive: true });

    this.metadata = {
      id,
      identifier: id.slice(0, 8),
      model,
      created: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      messageCount: 0,
      hasSummary: false,
      branch,
    };

    await atomicWrite(
      join(this.sessionDir, 'session.json'),
      JSON.stringify(this.metadata, null, 2),
    );

    // Ensure gitignore on first session creation
    await ensureGitignore(this.projectRoot);

    return { ...this.metadata };
  }

  async save(messages: Message[]): Promise<void> {
    if (!this.sessionDir) return;

    // Append only new messages since last save
    const newMessages = messages.slice(this.saveOffset);
    if (newMessages.length === 0) return;

    const jsonlPath = join(this.sessionDir, 'messages.jsonl');
    const gzPath = join(this.sessionDir, 'messages.jsonl.gz');

    const jsonl = newMessages.map((msg) => JSON.stringify(msg)).join('\n') + '\n';

    // If compressed file exists, decompress-append-recompress
    if (existsSync(gzPath)) {
      const compressed = await readFile(gzPath);
      const existing = gunzipSync(compressed).toString('utf8');
      const combined = existing + jsonl;
      await writeFile(gzPath, gzipSync(Buffer.from(combined)), { mode: 0o600 });
    } else {
      await appendFile(jsonlPath, jsonl, { mode: 0o600 });

      // Compress if over threshold
      try {
        const stats = await stat(jsonlPath);
        if (stats.size > COMPRESSION_THRESHOLD) {
          const raw = await readFile(jsonlPath);
          await writeFile(gzPath, gzipSync(raw), { mode: 0o600 });
          await rm(jsonlPath);
        }
      } catch {
        // stat/compress failure is non-fatal
      }
    }

    this.saveOffset = messages.length;
    this.metadata.lastActive = new Date().toISOString();
    this.metadata.messageCount = messages.length;

    await atomicWrite(
      join(this.sessionDir, 'session.json'),
      JSON.stringify(this.metadata, null, 2),
    );
  }

  async resume(sessionId: string): Promise<{
    metadata: SessionMetadata;
    messages: Message[];
    summary: string | null;
  }> {
    this.sessionDir = join(this.sessionsDir, sessionId);

    // Read metadata
    let metadata: SessionMetadata;
    try {
      const raw = await readFile(join(this.sessionDir, 'session.json'), 'utf8');
      metadata = JSON.parse(raw) as SessionMetadata;
    } catch {
      throw new Error(`Cannot read session metadata for ${sessionId}`);
    }
    this.metadata = metadata;

    // Read summary if available
    let summary: string | null = null;
    if (metadata.hasSummary) {
      try {
        summary = await readFile(join(this.sessionDir, 'summary.md'), 'utf8');
      } catch {
        process.stderr.write(`[session] Warning: summary.md missing for session ${sessionId}\n`);
      }
    }

    // Read messages (check for compressed first)
    let messages: Message[] = [];
    const gzPath = join(this.sessionDir, 'messages.jsonl.gz');
    const jsonlPath = join(this.sessionDir, 'messages.jsonl');
    try {
      if (existsSync(gzPath)) {
        const compressed = await readFile(gzPath);
        const data = gunzipSync(compressed).toString('utf8');
        messages = ConversationManager.fromJSONL(data);
      } else {
        const data = await readFile(jsonlPath, 'utf8');
        messages = ConversationManager.fromJSONL(data);
      }
    } catch {
      process.stderr.write(`[session] Warning: messages file missing for session ${sessionId}\n`);
    }

    this.saveOffset = messages.length;

    return { metadata, messages, summary };
  }

  async close(messages?: Message[], summarizer?: { summarize(messages: Message[]): Promise<string | null> }): Promise<void> {
    if (!this.sessionDir || !this.metadata) return;

    // Final save
    if (messages) {
      await this.save(messages);
    }

    // Summarize if enough messages
    if (summarizer && this.metadata.messageCount >= 4) {
      try {
        process.stdout.write('Saving session summary...');
        const allMessages = messages ?? [];
        const summary = await summarizer.summarize(allMessages);
        if (summary) {
          await writeFile(join(this.sessionDir, 'summary.md'), summary, { mode: 0o600 });
          this.metadata.hasSummary = true;
          await atomicWrite(
            join(this.sessionDir, 'session.json'),
            JSON.stringify(this.metadata, null, 2),
          );
          process.stdout.write(' done.\n');
        } else {
          process.stdout.write(' skipped.\n');
        }
      } catch {
        process.stderr.write('\n[session] Summarization failed, saving without summary.\n');
      }
    }
  }

  // -- Identifier -----------------------------------------------------------

  updateIdentifier(identifier: string): void {
    if (!this.metadata) return;
    this.metadata.identifier = identifier;
    this.metadata.identifierDerived = true;
  }

  rename(newName: string): void {
    if (!this.metadata) return;
    this.metadata.identifier = newName;
  }

  getMetadata(): SessionMetadata | null {
    return this.metadata ? { ...this.metadata } : null;
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  // -- Discovery (static) --------------------------------------------------

  static async listSessions(sessionsDir: string): Promise<SessionMetadata[]> {
    if (!existsSync(sessionsDir)) return [];

    const entries = await readdir(sessionsDir, { withFileTypes: true });
    const sessions: SessionMetadata[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await readFile(join(sessionsDir, entry.name, 'session.json'), 'utf8');
        sessions.push(JSON.parse(raw) as SessionMetadata);
      } catch {
        // Skip corrupt sessions
        process.stderr.write(`[session] Skipping corrupt session: ${entry.name}\n`);
      }
    }

    // Sort by lastActive descending (most recent first)
    sessions.sort((a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime());
    return sessions;
  }

  static async deleteSession(sessionsDir: string, sessionId: string): Promise<void> {
    const sessionDir = join(sessionsDir, sessionId);
    if (!existsSync(sessionDir)) return;
    await rm(sessionDir, { recursive: true, force: true });
  }

  // -- Migration ------------------------------------------------------------

  static async migrateGlobalRecovery(
    sessionsDir: string,
    projectRoot: string,
  ): Promise<SessionMetadata | null> {
    const home = process.env['HOME'] ?? '~';
    const recoveryFile = join(resolve(home), '.copair', 'sessions', 'recovery.json');

    if (!existsSync(recoveryFile)) return null;

    try {
      const raw = await readFile(recoveryFile, 'utf8');
      const snapshot = JSON.parse(raw) as { model: string; messages: Message[]; savedAt: string };

      const id = randomUUID();
      const sessionDir = join(sessionsDir, id);
      await mkdir(sessionDir, { recursive: true });

      // Write messages
      const jsonl = snapshot.messages.map((msg) => JSON.stringify(msg)).join('\n') + '\n';
      await writeFile(join(sessionDir, 'messages.jsonl'), jsonl, { mode: 0o600 });

      // Write metadata
      const hash = id.slice(0, 4);
      const metadata: SessionMetadata = {
        id,
        identifier: `recovered-session-${hash}`,
        model: snapshot.model,
        created: snapshot.savedAt,
        lastActive: snapshot.savedAt,
        messageCount: snapshot.messages.length,
        hasSummary: false,
      };
      await atomicWrite(join(sessionDir, 'session.json'), JSON.stringify(metadata, null, 2));

      // Remove old recovery file
      const { unlink } = await import('node:fs/promises');
      await unlink(recoveryFile);

      await ensureGitignore(projectRoot);

      console.log('Migrated previous session to project storage.');
      return metadata;
    } catch {
      process.stderr.write('[session] Failed to migrate recovery.json\n');
      return null;
    }
  }

  // -- Cleanup --------------------------------------------------------------

  static async cleanup(sessionsDir: string, maxSessions: number): Promise<void> {
    const sessions = await SessionManager.listSessions(sessionsDir);
    if (sessions.length <= maxSessions) return;

    const toRemove = sessions.slice(maxSessions);
    for (const session of toRemove) {
      await SessionManager.deleteSession(sessionsDir, session.id);
      process.stderr.write(`[session] Removed old session: ${session.identifier}\n`);
    }
  }
}
