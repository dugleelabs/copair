import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_CONFIG_TEMPLATE = `version: 1
# Project-level overrides (merged with ~/.copair/config.yaml)
# Uncomment and customize as needed:
#
# default_model: claude-sonnet
#
# context:
#   summarization_model: qwen-7b
#   max_sessions: 20
#   knowledge_max_size: 8192
#
# permissions:
#   mode: ask
#   allow_commands:
#     - git status
#     - git diff
`;

/**
 * Auto-initialize .copair/ scaffolding on first launch in a directory.
 * Creates:
 *   .copair/            — project-level copair directory
 *   .copair/commands/   — for custom commands
 *   .copair/.gitignore  — ignores sessions/
 *   .copair.yaml        — starter project config
 *
 * Also adds .copair/sessions/ to the project's root .gitignore.
 *
 * Skips any files/dirs that already exist. Silent on errors.
 */
export function ensureProjectInit(cwd: string): boolean {
  const copairDir = join(cwd, '.copair');
  const alreadyInit = existsSync(copairDir);

  try {
    // .copair/ and .copair/commands/
    mkdirSync(join(copairDir, 'commands'), { recursive: true });

    // .copair/.gitignore
    const innerGitignore = join(copairDir, '.gitignore');
    if (!existsSync(innerGitignore)) {
      writeFileSync(innerGitignore, 'sessions/\n', { mode: 0o644 });
    }

    // .copair.yaml at project root
    const projectConfig = join(cwd, '.copair.yaml');
    if (!existsSync(projectConfig)) {
      writeFileSync(projectConfig, PROJECT_CONFIG_TEMPLATE, { mode: 0o644 });
    }

    // Add .copair/sessions/ to root .gitignore
    const rootGitignore = join(cwd, '.gitignore');
    if (existsSync(rootGitignore)) {
      const content = readFileSync(rootGitignore, 'utf8');
      if (!content.includes('.copair/sessions')) {
        writeFileSync(rootGitignore, content.trimEnd() + '\n.copair/sessions/\n');
      }
    }
  } catch {
    // Non-fatal — init is best-effort
  }

  return !alreadyInit; // true if this was a first-time init
}
