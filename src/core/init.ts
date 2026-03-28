import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_CONFIG_TEMPLATE = `# Copair project configuration
# Overrides ~/.copair/config.yaml for this project
# This file is gitignored — do not commit

# provider:
#   model: ~                 # override model for this project

# permissions:
#   mode: ask
`;

/**
 * Auto-initialize .copair/ scaffolding on first launch in a directory.
 * Creates:
 *   .copair/            — project-level copair directory
 *   .copair/commands/   — for custom commands
 *   .copair/config.yaml — starter project config
 *
 * Skips any files/dirs that already exist. Silent on errors.
 *
 * Note: .gitignore management is handled by GitignoreManager.
 */
export function ensureProjectInit(cwd: string): boolean {
  const copairDir = join(cwd, '.copair');
  const alreadyInit = existsSync(copairDir);

  try {
    // .copair/ and .copair/commands/
    mkdirSync(join(copairDir, 'commands'), { recursive: true });

    // .copair/config.yaml
    const projectConfig = join(copairDir, 'config.yaml');
    if (!existsSync(projectConfig)) {
      writeFileSync(projectConfig, PROJECT_CONFIG_TEMPLATE, { mode: 0o644 });
    }
  } catch {
    // Non-fatal — init is best-effort
  }

  return !alreadyInit; // true if this was a first-time init
}
