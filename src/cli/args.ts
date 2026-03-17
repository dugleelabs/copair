import { Command } from 'commander';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

export interface CliOptions {
  model?: string;
  config?: string;
  verbose: boolean;
  debug: boolean;
}

export function parseArgs(argv: string[] = process.argv): CliOptions {
  const program = new Command();

  program
    .name('copair')
    .description('Model-agnostic AI coding agent for the terminal')
    .version(pkg.version, '-v, --version')
    .option('-m, --model <name>', 'Model to use (overrides config default)')
    .option('-c, --config <path>', 'Path to config file')
    .option('--verbose', 'Enable verbose logging (WARN + INFO)', false)
    .option('--debug', 'Enable debug logging (all levels)', false)
    .parse(argv);

  const opts = program.opts();

  return {
    model: opts.model,
    config: opts.config,
    verbose: opts.verbose || opts.debug,
    debug: opts.debug || process.env.DEBUG === 'copair',
  };
}
