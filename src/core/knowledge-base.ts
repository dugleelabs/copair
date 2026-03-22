import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const KB_FILENAME = 'COPAIR_KNOWLEDGE.md';
const KB_HEADER = '# Copair Knowledge Base\n';

export class KnowledgeBase {
  private filePath: string;
  private maxSize: number;

  constructor(projectRoot: string, maxSize = 8192) {
    this.filePath = join(projectRoot, KB_FILENAME);
    this.maxSize = maxSize;
  }

  async read(): Promise<string | null> {
    if (!existsSync(this.filePath)) return null;
    try {
      return await readFile(this.filePath, 'utf8');
    } catch {
      return null;
    }
  }

  async append(entry: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const dateHeading = `## ${today}`;

    if (!existsSync(this.filePath)) {
      // Create new file with header
      const content = `${KB_HEADER}\n${dateHeading}\n\n- ${entry}\n`;
      await writeFile(this.filePath, content, 'utf8');
      return;
    }

    const content = await readFile(this.filePath, 'utf8');

    if (content.includes(dateHeading)) {
      // Append under existing date heading
      const updated = content.replace(
        dateHeading,
        `${dateHeading}\n\n- ${entry}`,
      );
      await writeFile(this.filePath, updated, 'utf8');
    } else {
      // Add new date section after the header
      const headerEnd = content.indexOf('\n\n');
      if (headerEnd === -1) {
        await appendFile(this.filePath, `\n${dateHeading}\n\n- ${entry}\n`);
      } else {
        const updated =
          content.slice(0, headerEnd + 2) +
          `${dateHeading}\n\n- ${entry}\n\n` +
          content.slice(headerEnd + 2);
        await writeFile(this.filePath, updated, 'utf8');
      }
    }

    await this.prune();
  }

  getSystemPromptSection(): string {
    // Synchronous read for system prompt injection at startup
    if (!existsSync(this.filePath)) return '';
    try {
      const content = require('node:fs').readFileSync(this.filePath, 'utf8') as string;
      if (!content.trim()) return '';
      return (
        '\nThe following project knowledge was accumulated from prior sessions:\n\n---\n' +
        content.slice(0, this.maxSize) +
        '\n---\n'
      );
    } catch {
      return '';
    }
  }

  async prune(): Promise<void> {
    const content = await this.read();
    if (!content || content.length <= this.maxSize) return;

    // Split by date headings (## YYYY-MM-DD), remove oldest sections
    const sections = content.split(/(?=^## \d{4}-\d{2}-\d{2})/m);
    const header = sections[0]; // Everything before first date heading
    const dateSections = sections.slice(1);

    // Keep removing oldest (last in array since newest are first) until under limit
    let result = header;
    for (const section of dateSections) {
      if ((result + section).length > this.maxSize) break;
      result += section;
    }

    await writeFile(this.filePath, result, 'utf8');
  }

  getFilePath(): string {
    return this.filePath;
  }
}
