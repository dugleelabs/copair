import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { KnowledgeBase } from '../../src/core/knowledge-base.js';

describe('KnowledgeBase', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'copair-kb-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('read() returns null when file does not exist', async () => {
    const kb = new KnowledgeBase(tmpDir);
    expect(await kb.read()).toBeNull();
  });

  it('append() creates file with header on first write', async () => {
    const kb = new KnowledgeBase(tmpDir);
    await kb.append('Project uses TypeScript strict mode');

    const content = readFileSync(join(tmpDir, 'COPAIR_KNOWLEDGE.md'), 'utf8');
    expect(content).toContain('# Copair Knowledge Base');
    expect(content).toContain('Project uses TypeScript strict mode');
  });

  it('append() adds entry under existing date heading', async () => {
    const kb = new KnowledgeBase(tmpDir);
    await kb.append('First fact');
    await kb.append('Second fact');

    const content = readFileSync(join(tmpDir, 'COPAIR_KNOWLEDGE.md'), 'utf8');
    expect(content).toContain('First fact');
    expect(content).toContain('Second fact');

    // Should only have one date heading for today
    const today = new Date().toISOString().slice(0, 10);
    const matches = content.match(new RegExp(`## ${today}`, 'g'));
    expect(matches).toHaveLength(1);
  });

  it('getSystemPromptSection() returns formatted section', () => {
    const kb = new KnowledgeBase(tmpDir);
    // No file yet
    expect(kb.getSystemPromptSection()).toBe('');

    // Create file
    require('node:fs').writeFileSync(
      join(tmpDir, 'COPAIR_KNOWLEDGE.md'),
      '# Copair Knowledge Base\n\n## 2026-03-23\n\n- Uses vitest\n',
    );

    const section = kb.getSystemPromptSection();
    expect(section).toContain('project knowledge was accumulated');
    expect(section).toContain('Uses vitest');
  });

  it('prune() removes oldest entries when over maxSize', async () => {
    const kb = new KnowledgeBase(tmpDir, 200); // Very small max

    // Write a large knowledge base manually
    const { writeFile } = require('node:fs/promises');
    const content =
      '# Copair Knowledge Base\n\n' +
      '## 2026-03-23\n\n- New important fact that should be kept\n\n' +
      '## 2026-03-22\n\n- Older fact\n\n' +
      '## 2026-03-21\n\n- Even older fact with lots of text to push over the limit and force pruning of old entries\n';
    await writeFile(join(tmpDir, 'COPAIR_KNOWLEDGE.md'), content);

    await kb.prune();

    const pruned = await kb.read();
    expect(pruned!.length).toBeLessThanOrEqual(200);
    // Newest entry should be preserved
    expect(pruned).toContain('2026-03-23');
  });

  it('getFilePath() returns expected path', () => {
    const kb = new KnowledgeBase(tmpDir);
    expect(kb.getFilePath()).toBe(join(tmpDir, 'COPAIR_KNOWLEDGE.md'));
  });
});
