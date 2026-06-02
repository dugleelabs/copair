/**
 * Spec 029 F-15b T-J09 — per-tool overflow integration tests.
 *
 *   - bash.ts: large stdout truncates with marker + recovery hint; small
 *     stdout passes through (labelled but no hint); failure-path stderr
 *     truncates independently of failure-path stdout.
 *   - read.ts: large file without `limit` returns `[overflow]` error
 *     (NOT silent partial content); large file WITH explicit `limit`
 *     returns the requested range; small file without `limit` returns full
 *     content; emits `read_overflow` event when overflow fires.
 *   - grep.ts: many matches → overflow tail message + `grep_overflow`
 *     event (isError stays unset); few matches → clean output, no tail,
 *     no event.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bashTool, setBashOverflowTokens } from '../../src/tools/bash.js';
import { readTool, setReadOverflowLines } from '../../src/tools/read.js';
import { grepTool, setGrepDefaultMaxResults } from '../../src/tools/grep.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'copair-overflow-'));
});
afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  // Restore defaults so other tests in the suite aren't affected.
  setBashOverflowTokens(4000);
  setReadOverflowLines(1500);
  setGrepDefaultMaxResults(50);
});

// ── bash.ts overflow integration ─────────────────────────────────────────

describe('bash — overflow integration', () => {
  it('large stdout truncates with marker + recovery hint + bash_truncated event', async () => {
    // ~130 KB of stdout. Threshold is the default 4000 tokens (~16 KB), so
    // this trips truncation. Generated via `node -e` rather than a Unix shell
    // loop so the test is cross-platform (the bash tool runs cmd.exe on
    // Windows, where `for i in $(seq …)` is invalid syntax).
    const result = await bashTool.execute({
      command: `node -e "for(let i=0;i<5000;i++)console.log('line-'+i+' aaaaaaaaaaaaaaaaaaaaaa')"`,
    });
    expect(result.content).toContain('[stdout]');
    expect(result.content).toMatch(/\[\.\.\. \d+ lines truncated \.\.\.\]/);
    expect(result.content).toContain('[hint]');
    expect(result.content).toContain('head -n');
    expect(result.events).toBeDefined();
    expect(result.events).toHaveLength(1);
    expect(result.events![0]).toMatchObject({ kind: 'bash_truncated', label: 'stdout' });
  });

  it('small stdout passes through (labelled, no hint, no event)', async () => {
    const result = await bashTool.execute({ command: 'echo small-output' });
    expect(result.content).toContain('[stdout]');
    expect(result.content).toContain('small-output');
    expect(result.content).not.toContain('[hint]');
    expect(result.events).toBeUndefined();
  });

  it('failing command surfaces stderr with isError=true', async () => {
    // `node -e` for cross-platform stdout+stderr+non-zero-exit (no `sh -c`).
    const result = await bashTool.execute({
      command: `node -e "console.log('out');console.error('err');process.exit(7)"`,
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('[stdout]');
    expect(result.content).toContain('[stderr]');
    expect(result.content).toContain('out');
    expect(result.content).toContain('err');
  });

  it('failure-path stderr truncates independently of stdout', async () => {
    // Tight budget (500 tokens ≈ 2000 chars); write ~6000 chars to each stream
    // — well over budget — via `node -e` so it's cross-platform. `exit(1)`
    // forces execSync into its catch path so we exercise the failure-path branch.
    setBashOverflowTokens(500);
    try {
      const result = await bashTool.execute({
        command: `node -e "process.stdout.write('o'.repeat(6000));process.stderr.write('e'.repeat(6000));process.exit(1)"`,
      });
      expect(result.isError).toBe(true);
      const kinds = (result.events ?? []).map((e) =>
        e.kind === 'bash_truncated' ? `bash_truncated:${e.label}` : e.kind,
      );
      expect(kinds).toContain('bash_truncated:stdout');
      expect(kinds).toContain('bash_truncated:stderr');
    } finally {
      setBashOverflowTokens(4000);
    }
  });
});

// ── read.ts overflow integration ─────────────────────────────────────────

describe('read — overflow integration', () => {
  it('large file WITHOUT limit returns [overflow] error + read_overflow event', () => {
    const filePath = join(tmpDir, 'huge.txt');
    // 2000 lines joined by 1999 newlines → split('\n') gives exactly 2000.
    writeFileSync(filePath, Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n'));

    return readTool.execute({ file_path: filePath }).then((result) => {
      expect(result.isError).toBe(true);
      expect(result.content).toContain('[overflow]');
      expect(result.content).toContain('2000 lines');
      expect(result.content).toContain('limit');
      expect(result.events).toEqual([
        { kind: 'read_overflow', filePath, lineCount: 2000 },
      ]);
    });
  });

  it('large file WITH explicit limit returns the requested range (no overflow event)', async () => {
    const filePath = join(tmpDir, 'huge2.txt');
    writeFileSync(filePath, Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n'));

    const result = await readTool.execute({ file_path: filePath, limit: 10 });
    expect(result.isError).toBeUndefined();
    expect(result.content.split('\n')).toHaveLength(10);
    expect(result.content).toContain('line 0');
    expect(result.events).toBeUndefined();
  });

  it('small file without limit returns full content (no overflow event)', async () => {
    const filePath = join(tmpDir, 'small.txt');
    writeFileSync(filePath, 'a\nb\nc\n');

    const result = await readTool.execute({ file_path: filePath });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('a');
    expect(result.events).toBeUndefined();
  });

  it('threshold respects the runtime override', async () => {
    setReadOverflowLines(5);
    try {
      const filePath = join(tmpDir, 'small-but-over.txt');
      writeFileSync(filePath, 'a\nb\nc\nd\ne\nf\ng\n');

      const result = await readTool.execute({ file_path: filePath });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('[overflow]');
    } finally {
      setReadOverflowLines(1500);
    }
  });
});

// ── grep.ts overflow integration ─────────────────────────────────────────

describe('grep — overflow integration', () => {
  it('many matches → overflow tail message + grep_overflow event (no isError)', async () => {
    // Seed a directory with enough TODO matches to bust the default max.
    const dir = join(tmpDir, 'many-matches');
    require('node:fs').mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 60; i++) {
      writeFileSync(join(dir, `f${i}.txt`), 'TODO foo\n');
    }

    const result = await grepTool.execute({ pattern: 'TODO', path: dir });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('[overflow]');
    expect(result.content).toMatch(/More than 50 matches/);
    expect(result.events).toEqual([{ kind: 'grep_overflow', pattern: 'TODO', maxResults: 50 }]);
  });

  it('few matches → clean output (no overflow event, no tail)', async () => {
    const dir = join(tmpDir, 'few-matches');
    require('node:fs').mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'TODO one\n');
    writeFileSync(join(dir, 'b.txt'), 'TODO two\n');

    const result = await grepTool.execute({ pattern: 'TODO', path: dir });
    expect(result.isError).toBeUndefined();
    expect(result.content).not.toContain('[overflow]');
    expect(result.events).toBeUndefined();
  });

  it('default_max_results override honored', async () => {
    setGrepDefaultMaxResults(3);
    try {
      const dir = join(tmpDir, 'override-max');
      require('node:fs').mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(dir, `m${i}.txt`), 'TODO override\n');
      }

      const result = await grepTool.execute({ pattern: 'TODO', path: dir });
      expect(result.content).toContain('[overflow]');
      expect(result.content).toMatch(/More than 3 matches/);
      expect(result.events).toEqual([{ kind: 'grep_overflow', pattern: 'TODO', maxResults: 3 }]);
    } finally {
      setGrepDefaultMaxResults(50);
    }
  });
});
