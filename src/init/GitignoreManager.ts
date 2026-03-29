import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as readline from 'node:readline';

export type GitignoreCoverage = 'full' | 'partial' | 'none';

const FULL_PATTERNS = ['.copair/', '.copair'];

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

export class GitignoreManager {
  /**
   * Owns the full classify → prompt → consolidate flow.
   * Runs on every startup. Skips silently if already fully covered.
   * In CI mode applies consolidation silently without prompting.
   */
  async ensureCovered(cwd: string, options: { ci: boolean }): Promise<void> {
    const coverage = await this.classify(cwd);

    if (coverage === 'full') return;

    if (options.ci) {
      await this.consolidate(cwd);
      return;
    }

    const answer = await prompt('Add .copair/ to .gitignore? (Y/n) ');
    const declined = answer === 'n' || answer === 'no';

    if (!declined) {
      await this.consolidate(cwd);
    }
  }

  private async classify(cwd: string): Promise<GitignoreCoverage> {
    const gitignorePath = join(cwd, '.gitignore');
    if (!existsSync(gitignorePath)) return 'none';

    const lines = readFileSync(gitignorePath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim());

    for (const line of lines) {
      if (FULL_PATTERNS.includes(line)) return 'full';
    }

    // Check for partial entries like .copair/sessions, .copair/history, etc.
    const hasPartial = lines.some(
      (l) => l.startsWith('.copair/') && !FULL_PATTERNS.includes(l),
    );

    return hasPartial ? 'partial' : 'none';
  }

  private async consolidate(cwd: string): Promise<void> {
    const gitignorePath = join(cwd, '.gitignore');

    let lines: string[] = [];
    if (existsSync(gitignorePath)) {
      lines = readFileSync(gitignorePath, 'utf8').split(/\r?\n/);
    }

    // Remove partial .copair/* entries
    const filtered = lines.filter((l) => {
      const trimmed = l.trim();
      return !trimmed.startsWith('.copair/') || FULL_PATTERNS.includes(trimmed);
    });

    // Remove any trailing empty lines before we append
    while (filtered.length > 0 && filtered[filtered.length - 1].trim() === '') {
      filtered.pop();
    }

    filtered.push('', '# Copair runtime state', '.copair/', '');

    writeFileSync(gitignorePath, filtered.join('\n'), { encoding: 'utf8' });
  }
}
