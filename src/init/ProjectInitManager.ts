import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ttyPrompt } from '../cli/tty-prompt.js';
import { logger } from '../core/logger.js';

export interface ProjectInitResult {
  alreadyInitialised: boolean;
  declined: boolean;
  created: boolean;
}

const PROJECT_CONFIG_TEMPLATE = `# Copair project configuration
# Overrides ~/.copair/config.yaml for this project
# This file is gitignored — do not commit

# provider:
#   model: ~                 # override model for this project

# permissions:
#   mode: ask
`;

export class ProjectInitManager {
  async check(cwd: string, options: { ci: boolean }): Promise<ProjectInitResult> {
    const copairDir = join(cwd, '.copair');

    if (existsSync(copairDir)) {
      return { alreadyInitialised: true, declined: false, created: false };
    }

    if (options.ci) {
      process.stderr.write(
        'Copair: .copair/ not found. In CI mode, automatic init is skipped.\n' +
          'Run copair interactively once to initialise this project.\n',
      );
      return { alreadyInitialised: false, declined: true, created: false };
    }

    const answer = ttyPrompt('Trust this folder and allow Copair to run here? (y/N) ');
    if (answer === null) {
      logger.info('init', 'TTY unavailable — treating as CI mode (deny)');
      return { alreadyInitialised: false, declined: true, created: false };
    }
    const accepted = answer === 'y' || answer === 'yes';

    if (!accepted) {
      return { alreadyInitialised: false, declined: true, created: false };
    }

    await this.scaffold(cwd);
    return { alreadyInitialised: false, declined: false, created: true };
  }

  private async scaffold(cwd: string): Promise<void> {
    const copairDir = join(cwd, '.copair');
    mkdirSync(copairDir, { recursive: true, mode: 0o700 });
    mkdirSync(join(copairDir, 'commands'), { recursive: true, mode: 0o700 });

    const configPath = join(copairDir, 'config.yaml');
    if (!existsSync(configPath)) {
      writeFileSync(configPath, PROJECT_CONFIG_TEMPLATE, { mode: 0o600 });
    }
  }
}

export const DECLINED_MESSAGE =
  'Copair not initialised. Run copair again in a trusted folder.';
