import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';

// We need to mock openSync/readSync/closeSync before importing the module.
// vitest hoists vi.mock() calls, so this mock applies to the imported module.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    openSync: vi.fn(actual.openSync),
    readSync: vi.fn(actual.readSync),
    closeSync: vi.fn(actual.closeSync),
  };
});

// Import after mock setup
const { readFromTty, ttyPrompt } = await import('../../src/cli/tty-prompt.js');

describe('tty-prompt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readFromTty', () => {
    it('returns null when openSync throws (TTY unavailable / CI)', () => {
      vi.mocked(fs.openSync).mockImplementationOnce(() => {
        throw new Error('ENOENT: /dev/tty not available');
      });

      const result = readFromTty();
      expect(result).toBeNull();
    });

    it('returns trimmed string without trailing newline on successful read', () => {
      const fd = 999;
      vi.mocked(fs.openSync).mockReturnValueOnce(fd);

      // Simulate reading "hello\n"
      const input = Buffer.from('hello\n');
      vi.mocked(fs.readSync).mockImplementationOnce((_fd, buf, _offset, _length, _pos) => {
        (buf as Buffer).set(input.subarray(0, Math.min(input.length, (buf as Buffer).length)));
        return input.length;
      });
      vi.mocked(fs.closeSync).mockImplementationOnce(() => undefined);

      const result = readFromTty();
      expect(result).toBe('hello');
    });

    it('strips trailing CRLF line ending', () => {
      const fd = 999;
      vi.mocked(fs.openSync).mockReturnValueOnce(fd);

      const input = Buffer.from('answer\r\n');
      vi.mocked(fs.readSync).mockImplementationOnce((_fd, buf, _offset, _length, _pos) => {
        (buf as Buffer).set(input.subarray(0, Math.min(input.length, (buf as Buffer).length)));
        return input.length;
      });
      vi.mocked(fs.closeSync).mockImplementationOnce(() => undefined);

      const result = readFromTty();
      // replace(/\r?\n$/, '') strips the full \r\n sequence
      expect(result).toBe('answer');
    });

    it('returns empty string when user presses Enter only', () => {
      const fd = 999;
      vi.mocked(fs.openSync).mockReturnValueOnce(fd);

      const input = Buffer.from('\n');
      vi.mocked(fs.readSync).mockImplementationOnce((_fd, buf, _offset, _length, _pos) => {
        (buf as Buffer).set(input.subarray(0, Math.min(input.length, (buf as Buffer).length)));
        return input.length;
      });
      vi.mocked(fs.closeSync).mockImplementationOnce(() => undefined);

      const result = readFromTty();
      expect(result).toBe('');
    });

    it('closes fd in finally even when readSync throws', () => {
      const fd = 999;
      vi.mocked(fs.openSync).mockReturnValueOnce(fd);
      vi.mocked(fs.readSync).mockImplementationOnce(() => {
        throw new Error('read failed');
      });
      vi.mocked(fs.closeSync).mockImplementationOnce(() => undefined);

      expect(() => readFromTty()).toThrow('read failed');
      expect(fs.closeSync).toHaveBeenCalledWith(fd);
    });
  });

  describe('ttyPrompt', () => {
    it('writes message to stderr before reading', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.mocked(fs.openSync).mockImplementationOnce(() => {
        throw new Error('no tty');
      });

      ttyPrompt('Allow? (y/N) ');

      expect(stderrSpy).toHaveBeenCalledWith('Allow? (y/N) ');
      stderrSpy.mockRestore();
    });

    it('returns null when TTY is unavailable', () => {
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.mocked(fs.openSync).mockImplementationOnce(() => {
        throw new Error('no tty');
      });

      const result = ttyPrompt('prompt');
      expect(result).toBeNull();
    });
  });
});
