import { Command } from 'commander';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve package.json relative to this file at runtime (works for both src/ and dist/)
const _dir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = (() => {
  // Try parent dirs until we find package.json
  for (const rel of ['../package.json', '../../package.json']) {
    try { return require(resolve(_dir, rel)); } catch { /* skip */ }
  }
  return { name: 'copair', version: process.env['COPAIR_VERSION'] ?? '0.0.0-dev' };
})();

export interface CliOptions {
  model?: string;
  config?: string;
  verbose: boolean;
  debug: boolean;
  resume?: string | true;
}

export function parseArgs(argv: string[] = process.argv, versionString?: string): CliOptions {
  const program = new Command();

  program
    .name('copair')
    .description('Model-agnostic AI coding agent for the terminal')
    .version(versionString ?? pkg.version, '-v, --version')
    .option('-m, --model <name>', 'Model to use (overrides config default)')
    .option('-c, --config <path>', 'Path to config file')
    .option('--verbose', 'Enable verbose logging (WARN + INFO)', false)
    .option('--debug', 'Enable debug logging (all levels)', false)
    .option('--resume [identifier]', 'Resume a previous session (use "latest" for most recent)')
    .parse(argv);

  const opts = program.opts();

  return {
    model: opts.model,
    config: opts.config,
    verbose: opts.verbose || opts.debug,
    debug: opts.debug || process.env.DEBUG === 'copair',
    resume: opts.resume,
  };
}
