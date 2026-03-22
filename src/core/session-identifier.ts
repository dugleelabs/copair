import { createHash } from 'node:crypto';
import type { Message } from '../providers/interface.js';

// ---------------------------------------------------------------------------
// Stop words — common terms that don't differentiate sessions
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  // English articles & pronouns
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
  // Common verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may',
  'might', 'shall', 'must',
  // Filler
  'please', 'help', 'want', 'need', 'like', 'just', 'also', 'some',
  'make', 'let', 'get', 'got', 'put', 'use', 'try', 'take', 'give',
  // Generic programming terms
  'file', 'files', 'code', 'function', 'class', 'method', 'variable',
  'project', 'app', 'application', 'src', 'index', 'main', 'module',
  // Prepositions & conjunctions
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by', 'about',
  'into', 'through', 'and', 'or', 'but', 'not', 'no', 'so', 'if', 'then',
]);

// ---------------------------------------------------------------------------
// Slugify
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Extract words from different signal sources
// ---------------------------------------------------------------------------

function extractMessageWords(messages: Message[]): string[] {
  // Use first user message
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        return block.text
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
      }
    }
  }
  return [];
}

function extractFileWords(messages: Message[]): string[] {
  const words: string[] = [];
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        const input = block.input as Record<string, unknown>;
        // Look for file paths in common tool input fields
        for (const key of ['file_path', 'path', 'filePath']) {
          const val = input[key];
          if (typeof val === 'string') {
            const basename = val.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
            if (basename) {
              words.push(
                ...basename
                  .split(/[^a-z0-9]+/i)
                  .map((w) => w.toLowerCase())
                  .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
              );
            }
          }
        }
      }
    }
  }
  return words;
}

function extractBranchWords(branch?: string): string[] {
  if (!branch) return [];
  // Strip type prefix (feat/, fix/, chore/, etc.)
  const stripped = branch.replace(/^(feat|fix|chore|docs|refactor|test|perf|ci|build)\/?/, '');
  return stripped
    .split(/[^a-z0-9]+/i)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

// ---------------------------------------------------------------------------
// Main derivation function
// ---------------------------------------------------------------------------

export function deriveIdentifier(messages: Message[], sessionId: string, branch?: string): string {
  const scores = new Map<string, number>();

  const addWords = (words: string[], weight: number) => {
    for (const word of words) {
      scores.set(word, (scores.get(word) ?? 0) + weight);
    }
  };

  // Score: branch words 3x, file words 2x, message words 1x
  addWords(extractBranchWords(branch), 3);
  addWords(extractFileWords(messages), 2);
  addWords(extractMessageWords(messages), 1);

  // Sort by score descending, take top 3-4
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word]) => word);

  if (ranked.length === 0) {
    ranked.push('session');
  }

  // 4-char hash suffix from session UUID
  const hash = createHash('sha256').update(sessionId).digest('hex').slice(0, 4);

  const slug = slugify(ranked.join('-'));
  const identifier = `${slug}-${hash}`;

  // Truncate to 40 chars
  return identifier.slice(0, 40).replace(/-$/, '');
}
