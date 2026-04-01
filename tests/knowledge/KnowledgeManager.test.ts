import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KnowledgeManager, KB_FILENAME } from '../../src/knowledge/KnowledgeManager.js';

describe('KnowledgeManager', () => {
  let tmpDir: string;
  let manager: KnowledgeManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'copair-knowledge-test-'));
    manager = new KnowledgeManager({ warn_size_kb: 8, max_size_kb: 16 });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('load', () => {
    it('returns found: false when file is absent', () => {
      const result = manager.load(tmpDir);
      expect(result.found).toBe(false);
      expect(result.content).toBeNull();
      expect(result.sizeBytes).toBe(0);
    });

    it('returns file content when present', () => {
      const content = '# Copair Knowledge Base\n\n## Directory Map\n- src/\n';
      writeFileSync(join(tmpDir, KB_FILENAME), content);

      const result = manager.load(tmpDir);
      expect(result.found).toBe(true);
      expect(result.content).toBe(content);
      expect(result.sizeBytes).toBeGreaterThan(0);
    });

    it('reports correct byte size', () => {
      const content = 'hello world';
      writeFileSync(join(tmpDir, KB_FILENAME), content);

      const result = manager.load(tmpDir);
      expect(result.sizeBytes).toBe(Buffer.byteLength(content, 'utf8'));
    });
  });

  describe('injectIntoSystemPrompt', () => {
    it('wraps content in <knowledge source="user"> tags', () => {
      const result = manager.injectIntoSystemPrompt('## Directory Map\n- src/');
      expect(result).toContain('<knowledge source="user">');
      expect(result).toContain('</knowledge>');
      expect(result).toContain('## Directory Map');
    });

    it('trims leading/trailing whitespace from content', () => {
      const result = manager.injectIntoSystemPrompt('  content  ');
      expect(result).toContain('<knowledge source="user">\ncontent\n</knowledge>');
    });
  });

  describe('checkSizeBudget', () => {
    it('does not throw or warn when under warn threshold', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      // 1 KB
      manager.checkSizeBudget(1024);
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('warns to stderr when over warn threshold but under max', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      // 9 KB (over warn_size_kb: 8, under max_size_kb: 16)
      manager.checkSizeBudget(9 * 1024);
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('[knowledge] Warning'),
      );
    });

    it('throws when over max threshold', () => {
      // 17 KB (over max_size_kb: 16)
      expect(() => manager.checkSizeBudget(17 * 1024)).toThrow(
        /exceeds the 16 KB hard cap/,
      );
    });

    it('warns but does not throw at exactly warn threshold', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      // exactly 8 KB — should warn but not throw
      manager.checkSizeBudget(8 * 1024 + 1);
      expect(stderrSpy).toHaveBeenCalled();
    });
  });

  describe('evaluateForUpdate', () => {
    it('returns null for empty changes', () => {
      expect(manager.evaluateForUpdate([], '')).toBeNull();
    });

    it('returns null for test-only changes', () => {
      expect(
        manager.evaluateForUpdate(['tests/core/foo.test.ts', 'src/foo.spec.ts'], 'diff'),
      ).toBeNull();
    });

    it('returns null for minor edits to existing non-trigger files', () => {
      expect(
        manager.evaluateForUpdate(['src/core/session.ts'], 'minor fix'),
      ).toBeNull();
    });

    it('returns a description for new entry point', () => {
      const result = manager.evaluateForUpdate(['src/index.ts'], 'added');
      expect(result).not.toBeNull();
      expect(result).toContain('src/index.ts');
    });

    it('returns a description for new config file', () => {
      const result = manager.evaluateForUpdate(['package.json'], 'added');
      expect(result).not.toBeNull();
    });
  });

  describe('applyUpdate', () => {
    it('writes content to COPAIR_KNOWLEDGE.md', () => {
      const content = '# Updated Knowledge\n';
      manager.applyUpdate(tmpDir, content);
      expect(readFileSync(join(tmpDir, KB_FILENAME), 'utf8')).toBe(content);
    });

    it('throws when content exceeds max size', () => {
      const oversized = 'x'.repeat(17 * 1024);
      expect(() => manager.applyUpdate(tmpDir, oversized)).toThrow(
        /16 KB cap/,
      );
    });
  });
});
