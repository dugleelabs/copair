import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We mock readline at the module level so KnowledgeSetupFlow uses our controlled input
vi.mock('node:readline', () => {
  return {
    createInterface: vi.fn(),
  };
});

import * as readline from 'node:readline';
import { KnowledgeSetupFlow } from '../../src/knowledge/KnowledgeSetupFlow.js';
import { KB_FILENAME } from '../../src/knowledge/KnowledgeManager.js';

function makeRlMock(answers: string[]) {
  let callCount = 0;
  return {
    question: vi.fn((_q: string, cb: (a: string) => void) => {
      cb(answers[callCount++] ?? '');
    }),
    close: vi.fn(),
  };
}

describe('KnowledgeSetupFlow', () => {
  let tmpDir: string;
  let flow: KnowledgeSetupFlow;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ksf-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    flow = new KnowledgeSetupFlow();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns false immediately when user declines initial prompt', async () => {
    const rl = makeRlMock(['n']);
    vi.mocked(readline.createInterface).mockReturnValue(rl as unknown as readline.Interface);

    const result = await flow.run(tmpDir);

    expect(result).toBe(false);
    // No file should be written
    expect(() => readFileSync(join(tmpDir, KB_FILENAME))).toThrow();
  });

  it('writes file and returns true when user provides all sections and confirms', async () => {
    // Answers: initial Y, dir map, tech stack, skip naming, entry points, skip off-limits, final Y
    const rl = makeRlMock(['Y', 'src/ — source', 'TypeScript', 'skip', 'bin/copair.ts', 'skip', 'Y']);
    vi.mocked(readline.createInterface).mockReturnValue(rl as unknown as readline.Interface);

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
    const rl = makeRlMock(['Y', 'src/ — source', 'TypeScript', 'skip', 'bin/copair.ts', 'skip', 'n']);
    vi.mocked(readline.createInterface).mockReturnValue(rl as unknown as readline.Interface);

    const result = await flow.run(tmpDir);

    expect(result).toBe(false);
    expect(() => readFileSync(join(tmpDir, KB_FILENAME))).toThrow();
  });

  it('returns false and skips file when all sections are empty', async () => {
    // Provide empty answers for required sections, skip skippable ones
    const rl = makeRlMock(['Y', '', '', 'skip', '', 'skip']);
    vi.mocked(readline.createInterface).mockReturnValue(rl as unknown as readline.Interface);

    const result = await flow.run(tmpDir);

    expect(result).toBe(false);
    expect(() => readFileSync(join(tmpDir, KB_FILENAME))).toThrow();
  });

  it('prefixes plain lines with a dash in the written file', async () => {
    const rl = makeRlMock(['Y', 'my-dir', 'Node.js', 'skip', 'index.ts', 'skip', 'Y']);
    vi.mocked(readline.createInterface).mockReturnValue(rl as unknown as readline.Interface);

    await flow.run(tmpDir);

    const content = readFileSync(join(tmpDir, KB_FILENAME), 'utf8');
    expect(content).toContain('- my-dir');
    expect(content).toContain('- Node.js');
    expect(content).toContain('- index.ts');
  });

  it('does not double-prefix lines that already start with a dash', async () => {
    const rl = makeRlMock(['Y', '- src/', 'TypeScript', 'skip', '- bin/', 'skip', 'Y']);
    vi.mocked(readline.createInterface).mockReturnValue(rl as unknown as readline.Interface);

    await flow.run(tmpDir);

    const content = readFileSync(join(tmpDir, KB_FILENAME), 'utf8');
    expect(content).toContain('- src/');
    expect(content).not.toContain('- - src/');
  });
});
