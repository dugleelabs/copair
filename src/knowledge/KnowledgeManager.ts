import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ttyPrompt } from '../cli/tty-prompt.js';
import { wrapKnowledge } from '../core/context-wrapper.js';

export const KB_FILENAME = 'COPAIR_KNOWLEDGE.md';

export interface KnowledgeLoadResult {
  found: boolean;
  content: string | null;
  sizeBytes: number;
}

export interface KnowledgeConfig {
  warn_size_kb: number;
  max_size_kb: number;
}

const DEFAULT_CONFIG: KnowledgeConfig = {
  warn_size_kb: 8,
  max_size_kb: 16,
};

// Heuristics: file patterns that trigger update evaluation
const TRIGGER_PATTERNS = [
  /^[^/]+\/$/, // new top-level directory
  /(?:^|\/)(?:index|main|app|server|bin\/)\.[jt]sx?$/, // entry points
  /(?:^|\/)(?:package\.json|tsconfig.*\.json|\.env\.example|Dockerfile|docker-compose\.ya?ml)$/, // config files
];

const SKIP_PATTERNS = [
  /(?:^|\/)tests?\//, // test files
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
];


export class KnowledgeManager {
  private config: KnowledgeConfig;

  constructor(config: Partial<KnowledgeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  load(cwd: string): KnowledgeLoadResult {
    const filePath = join(cwd, KB_FILENAME);
    if (!existsSync(filePath)) {
      return { found: false, content: null, sizeBytes: 0 };
    }

    try {
      const content = readFileSync(filePath, 'utf8');
      const sizeBytes = Buffer.byteLength(content, 'utf8');
      return { found: true, content, sizeBytes };
    } catch {
      return { found: false, content: null, sizeBytes: 0 };
    }
  }

  injectIntoSystemPrompt(content: string): string {
    return wrapKnowledge(content.trim(), 'user') + '\n\n';
  }

  checkSizeBudget(sizeBytes: number): void {
    const warnBytes = this.config.warn_size_kb * 1024;
    const maxBytes = this.config.max_size_kb * 1024;

    if (sizeBytes > maxBytes) {
      throw new Error(
        `COPAIR_KNOWLEDGE.md exceeds the ${this.config.max_size_kb} KB hard cap ` +
          `(${Math.round(sizeBytes / 1024)} KB). ` +
          'Reduce the file size before starting a session.',
      );
    }

    if (sizeBytes > warnBytes) {
      process.stderr.write(
        `[knowledge] Warning: COPAIR_KNOWLEDGE.md is ${Math.round(sizeBytes / 1024)} KB ` +
          `(recommended max: ${this.config.warn_size_kb} KB). ` +
          'Consider trimming it to keep prompts efficient.\n',
      );
    }
  }

  /**
   * Evaluate whether the knowledge file needs updating after a task.
   * Returns a proposed update description if an update is warranted, null otherwise.
   */
  evaluateForUpdate(filesChanged: string[], _diff: string): string | null {
    if (filesChanged.length === 0) return null;

    // Skip if all changes are test-only
    const nonTestFiles = filesChanged.filter(
      (f) => !SKIP_PATTERNS.some((p) => p.test(f)),
    );
    if (nonTestFiles.length === 0) return null;

    // Check for trigger patterns
    const triggers = nonTestFiles.filter((f) =>
      TRIGGER_PATTERNS.some((p) => p.test(f)),
    );
    if (triggers.length === 0) return null;

    return (
      `The following changes may affect the knowledge file:\n` +
      triggers.map((f) => `  - ${f}`).join('\n') +
      '\nConsider updating COPAIR_KNOWLEDGE.md to reflect these changes.'
    );
  }

  proposeUpdate(cwd: string, proposedDiff: string): boolean {
    process.stdout.write(
      '\n[knowledge] Proposed update to COPAIR_KNOWLEDGE.md:\n\n' +
        proposedDiff +
        '\n',
    );

    const answer = ttyPrompt('Apply this update to COPAIR_KNOWLEDGE.md? (Y/n) ') ?? '';
    const declined = answer.trim().toLowerCase() === 'n' || answer.trim().toLowerCase() === 'no';

    if (declined) return false;

    this.applyUpdate(cwd, proposedDiff);
    return true;
  }

  applyUpdate(cwd: string, content: string): void {
    const filePath = join(cwd, KB_FILENAME);
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    const maxBytes = this.config.max_size_kb * 1024;

    if (sizeBytes > maxBytes) {
      throw new Error(
        `Cannot apply update: result would be ${Math.round(sizeBytes / 1024)} KB, ` +
          `exceeding the ${this.config.max_size_kb} KB cap.`,
      );
    }

    writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o644 });
  }
}
