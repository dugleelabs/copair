import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ttyPrompt, readFromTty } from '../cli/tty-prompt.js';
import { logger } from '../core/logger.js';
import { KB_FILENAME } from './KnowledgeManager.js';

interface Section {
  key: string;
  heading: string;
  question: string;
  skippable: boolean;
}

const SECTIONS: Section[] = [
  {
    key: 'directory-map',
    heading: '## Directory Map',
    question:
      'What are the key directories in this project and what does each own?\n' +
      '(e.g. "src/ — all TypeScript source", "bin/ — CLI entry point")',
    skippable: false,
  },
  {
    key: 'tech-stack',
    heading: '## Tech Stack',
    question:
      'What language, runtime, and key frameworks are in use?\n' +
      '(e.g. "TypeScript / Node.js 20+, pnpm, vitest")',
    skippable: false,
  },
  {
    key: 'naming-conventions',
    heading: '## Naming Conventions',
    question:
      'Any naming conventions for files, components, variables, or API routes?\n' +
      '(Type "skip" to omit this section)',
    skippable: true,
  },
  {
    key: 'entry-points',
    heading: '## Entry Points',
    question:
      'What are the key entry points — main file, config files, bootstrap?\n' +
      '(e.g. "bin/copair.ts — CLI entry", "src/session/SessionBootstrap.ts — startup")',
    skippable: false,
  },
  {
    key: 'off-limits',
    heading: '## Off-Limits',
    question:
      'Any files or directories Copair must not touch without explicit instruction?\n' +
      '(Type "skip" to omit this section)',
    skippable: true,
  },
];

function ask(question: string): string | null {
  process.stdout.write(question + '\n> ');
  return readFromTty();
}

function confirm(question: string): boolean | null {
  const answer = ttyPrompt(question);
  if (answer === null) return null;
  const lower = answer.trim().toLowerCase();
  return lower !== 'n' && lower !== 'no';
}

export class KnowledgeSetupFlow {
  /**
   * Prompts the user to set up a COPAIR_KNOWLEDGE.md.
   * Returns true if a file was written, false if the user declined.
   */
  async run(cwd: string): Promise<boolean> {
    const shouldSetup = confirm('No knowledge file found. Set one up now? (Y/n) ');
    if (shouldSetup === null) {
      logger.info('knowledge', 'TTY unavailable — skipping knowledge setup');
      return false;
    }
    if (!shouldSetup) return false;

    process.stdout.write(
      "\nLet's build your COPAIR_KNOWLEDGE.md — a navigation map for Copair.\n" +
        'Answer each section (press Enter to confirm).\n\n',
    );

    const sections: { heading: string; content: string }[] = [];

    for (const section of SECTIONS) {
      process.stdout.write(`--- ${section.heading.replace('## ', '')} ---\n`);
      const answer = ask(section.question);

      if (answer === null) {
        logger.info('knowledge', 'TTY unavailable mid-setup — aborting');
        return false;
      }

      if (section.skippable && answer.toLowerCase() === 'skip') {
        process.stdout.write('Skipped.\n\n');
        continue;
      }

      if (!answer.trim()) {
        process.stdout.write('Skipped (empty).\n\n');
        continue;
      }

      sections.push({ heading: section.heading, content: answer });
      process.stdout.write('\n');
    }

    if (sections.length === 0) {
      process.stdout.write('No sections provided — skipping knowledge file creation.\n');
      return false;
    }

    // Build file content
    const lines = ['# Copair Knowledge Base', ''];
    for (const { heading, content } of sections) {
      lines.push(heading);
      // Format as bullet list if user provided plain lines
      const contentLines = content.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of contentLines) {
        lines.push(line.startsWith('-') ? line : `- ${line}`);
      }
      lines.push('');
    }
    const fileContent = lines.join('\n');

    // Show full draft
    process.stdout.write('\n--- Draft COPAIR_KNOWLEDGE.md ---\n\n');
    process.stdout.write(fileContent);
    process.stdout.write('\n--- End of draft ---\n\n');

    const write = confirm('Write COPAIR_KNOWLEDGE.md? (Y/n) ');
    if (write === null) {
      logger.info('knowledge', 'TTY unavailable — skipping write');
      return false;
    }
    if (!write) {
      process.stdout.write('Skipped — will prompt again next session start.\n');
      return false;
    }

    writeFileSync(join(cwd, KB_FILENAME), fileContent, {
      encoding: 'utf8',
      mode: 0o644,
    });

    process.stdout.write(
      `\nWrote ${KB_FILENAME}. Commit it to version control like README.md.\n\n`,
    );
    return true;
  }
}
