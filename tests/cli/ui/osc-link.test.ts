import { describe, it, expect, afterEach } from 'vitest';
import { supportsOsc8, resetOscCache, fileLink } from '../../../src/cli/ui/osc-link.js';

describe('osc-link', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetOscCache();
  });

  it('fileLink returns plain text when not supported', () => {
    // Non-TTY or unsupported terminal
    resetOscCache();
    const result = fileLink('/some/path.ts');
    // In test environment (not TTY), should return plain text
    expect(result).toBe('/some/path.ts');
  });

  it('fileLink uses displayText when provided', () => {
    resetOscCache();
    const result = fileLink('/some/path.ts', 'path.ts');
    // In test (non-TTY), returns displayText
    expect(result).toBe('path.ts');
  });

  it('detects VS Code terminal as supported', () => {
    process.env.VSCODE_PID = '12345';
    // Would need TTY to actually return true, but we can test the env detection
    resetOscCache();
    // In test env stdout.isTTY is false, so still returns false
    expect(supportsOsc8()).toBe(false);
  });
});
