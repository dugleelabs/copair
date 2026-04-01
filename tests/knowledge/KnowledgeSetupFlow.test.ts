import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock tty-prompt before KnowledgeSetupFlow is imported.
// KnowledgeSetupFlow uses ttyPrompt (for confirm) and readFromTty (for ask).
vi.mock('../../src/cli/tty-prompt.js', () => ({
  ttyPrompt: vi.fn(),
  readFromTty: vi.fn(),
}));

import * as ttyPromptModule from '../../src/cli/tty-prompt.js';
import { KnowledgeSetupFlow } from '../../src/knowledge/KnowledgeSetupFlow.js';
import { KB_FILENAME } from '../../src/knowledge/KnowledgeManager.js';

// SECTIONS order: directory-map, tech-stack, naming-conventions (skippable),
// entry-points, off-limits (skippable)

describe('KnowledgeSetupFlow', () => {
  let tmpDir: string;
  let flow: KnowledgeSetupFlow;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ksf-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    flow = new KnowledgeSetupFlow();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(ttyPromptModule.ttyPrompt).mockReset();
    vi.mocked(ttyPromptModule.readFromTty).mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns false immediately when user declines initial prompt', async () => {
    vi.mocked(ttyPromptModule.ttyPrompt).mockReturnValueOnce('n');

    const result = await flow.run(tmpDir);

    expect(result).toBe(false);
    expect(() => readFileSync(join(tmpDir, KB_FILENAME))).toThrow();
  });

  it('writes file and returns true when user provides all sections and confirms', async () => {
    // confirm calls: initial 'Y', final 'Y'
    vi.mocked(ttyPromptModule.ttyPrompt)
      .mockReturnValueOnce('Y')
      .mockReturnValueOnce('Y');
    // ask (readFromTty) calls: directory-map, tech-stack, naming-conventions, entry-points, off-limits
    vi.mocked(ttyPromptModule.readFromTty)
      .mockReturnValueOnce('src/ — source')
      .mockReturnValueOnce('TypeScript')
      .mockReturnValueOnce('skip')
      .mockReturnValueOnce('bin/copair.ts')
      .mockReturnValueOnce('skip');

    const result = await flow.run(tmpDir);

    expect(result).toBe(true);
    const content = readFileSync(join(tmpDir, KB_FILENAME), 'utf8');
    expect(content).toContain('# Copair Knowledge Base');
    expect(content).toContain('## Directory Map');
    expect(content).toContain('src/ — source');
    expect(content).toContain('## Tech Stack');
    expect(content).toContain('TypeScript');
    expect(content).toContain('## Entry Points');
    expect(content).toContain('bin/copair.ts');
    // Skipped sections should not appear
    expect(content).not.toContain('## Naming Conventions');
    expect(content).not.toContain('## Off-Limits');
  });

  it('returns false and writes no file when user declines final write prompt', async () => {
    vi.mocked(ttyPromptModule.ttyPrompt)
      .mockReturnValueOnce('Y')
      .mockReturnValueOnce('n');
    vi.mocked(ttyPromptModule.readFromTty)
      .mockReturnValueOnce('src/ — source')
      .mockReturnValueOnce('TypeScript')
      .mockReturnValueOnce('skip')
      .mockReturnValueOnce('bin/copair.ts')
      .mockReturnValueOnce('skip');

    const result = await flow.run(tmpDir);

    expect(result).toBe(false);
    expect(() => readFileSync(join(tmpDir, KB_FILENAME))).toThrow();
  });

  it('returns false and skips file when all sections are empty', async () => {
    // Only initial confirm — no final confirm reached since all sections empty
    vi.mocked(ttyPromptModule.ttyPrompt).mockReturnValueOnce('Y');
    vi.mocked(ttyPromptModule.readFromTty)
      .mockReturnValueOnce('')    // directory-map: empty
      .mockReturnValueOnce('')    // tech-stack: empty
      .mockReturnValueOnce('skip') // naming-conventions: skipped
      .mockReturnValueOnce('')    // entry-points: empty
      .mockReturnValueOnce('skip'); // off-limits: skipped

    const result = await flow.run(tmpDir);

    expect(result).toBe(false);
    expect(() => readFileSync(join(tmpDir, KB_FILENAME))).toThrow();
  });

  it('prefixes plain lines with a dash in the written file', async () => {
    vi.mocked(ttyPromptModule.ttyPrompt)
      .mockReturnValueOnce('Y')
      .mockReturnValueOnce('Y');
    vi.mocked(ttyPromptModule.readFromTty)
      .mockReturnValueOnce('my-dir')
      .mockReturnValueOnce('Node.js')
      .mockReturnValueOnce('skip')
      .mockReturnValueOnce('index.ts')
      .mockReturnValueOnce('skip');

    await flow.run(tmpDir);

    const content = readFileSync(join(tmpDir, KB_FILENAME), 'utf8');
    expect(content).toContain('- my-dir');
    expect(content).toContain('- Node.js');
    expect(content).toContain('- index.ts');
  });

  it('does not double-prefix lines that already start with a dash', async () => {
    vi.mocked(ttyPromptModule.ttyPrompt)
      .mockReturnValueOnce('Y')
      .mockReturnValueOnce('Y');
    vi.mocked(ttyPromptModule.readFromTty)
      .mockReturnValueOnce('- src/')
      .mockReturnValueOnce('TypeScript')
      .mockReturnValueOnce('skip')
      .mockReturnValueOnce('- bin/')
      .mockReturnValueOnce('skip');

    await flow.run(tmpDir);

    const content = readFileSync(join(tmpDir, KB_FILENAME), 'utf8');
    expect(content).toContain('- src/');
    expect(content).not.toContain('- - src/');
  });
});
