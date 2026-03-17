import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readTool } from '../../src/tools/read.js';
import { writeTool } from '../../src/tools/write.js';
import { editTool } from '../../src/tools/edit.js';
import { bashTool } from '../../src/tools/bash.js';
import { globTool } from '../../src/tools/glob.js';

const testDir = join(tmpdir(), `copair-tool-test-${Date.now()}`);

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('Read tool', () => {
  it('reads a file', async () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'hello.txt'), 'line1\nline2\nline3\n');

    const result = await readTool.execute({ file_path: join(testDir, 'hello.txt') });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('line1');
    expect(result.content).toContain('line2');
  });

  it('returns error for missing file', async () => {
    const result = await readTool.execute({ file_path: '/nonexistent/file.txt' });
    expect(result.isError).toBe(true);
  });

  it('supports offset and limit', async () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'lines.txt'), 'a\nb\nc\nd\ne\n');

    const result = await readTool.execute({
      file_path: join(testDir, 'lines.txt'),
      offset: 2,
      limit: 2,
    });
    expect(result.content).toContain('b');
    expect(result.content).toContain('c');
    expect(result.content).not.toContain('     1');
  });
});

describe('Write tool', () => {
  it('writes a file and creates directories', async () => {
    const filePath = join(testDir, 'sub', 'dir', 'file.txt');
    const result = await writeTool.execute({
      file_path: filePath,
      content: 'hello world',
    });
    expect(result.isError).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe('hello world');
  });
});

describe('Edit tool', () => {
  it('replaces unique string in file', async () => {
    mkdirSync(testDir, { recursive: true });
    const filePath = join(testDir, 'edit.txt');
    writeFileSync(filePath, 'hello world');

    const result = await editTool.execute({
      file_path: filePath,
      old_string: 'world',
      new_string: 'copair',
    });
    expect(result.isError).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe('hello copair');
  });

  it('errors on non-unique match', async () => {
    mkdirSync(testDir, { recursive: true });
    const filePath = join(testDir, 'dup.txt');
    writeFileSync(filePath, 'foo foo foo');

    const result = await editTool.execute({
      file_path: filePath,
      old_string: 'foo',
      new_string: 'bar',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('3 times');
  });
});

describe('Bash tool', () => {
  it('executes a command', async () => {
    const result = await bashTool.execute({ command: 'echo hello' });
    expect(result.content.trim()).toBe('hello');
  });

  it('returns error on failing command', async () => {
    const result = await bashTool.execute({ command: 'false' });
    expect(result.isError).toBe(true);
  });
});

describe('Glob tool', () => {
  it('matches files', async () => {
    mkdirSync(join(testDir, 'src'), { recursive: true });
    writeFileSync(join(testDir, 'src', 'a.ts'), '');
    writeFileSync(join(testDir, 'src', 'b.ts'), '');
    writeFileSync(join(testDir, 'src', 'c.js'), '');

    const result = await globTool.execute({
      pattern: 'src/*.ts',
      path: testDir,
    });
    expect(result.content).toContain('a.ts');
    expect(result.content).toContain('b.ts');
    expect(result.content).not.toContain('c.js');
  });
});
