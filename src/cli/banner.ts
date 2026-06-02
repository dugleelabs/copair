import chalk from 'chalk';
import pkg from '../../package.json' with { type: 'json' };

const LOGO = `
 ██████╗ ██████╗ ██████╗  █████╗ ██╗██████╗
██╔════╝██╔═══██╗██╔══██╗██╔══██╗██║██╔══██╗
██║     ██║   ██║██████╔╝███████║██║██████╔╝
██║     ██║   ██║██╔═══╝ ██╔══██║██║██╔══██╗
╚██████╗╚██████╔╝██║     ██║  ██║██║██║  ██║
 ╚═════╝ ╚═════╝ ╚═╝     ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝`.trimStart();

export function printBanner(modelName: string, versionString?: string): void {
  // versionString is typically "copair 1.4.5 (community)"; strip the redundant
  // leading "copair " since the LOGO already renders the name.
  const display = (versionString ?? `copair ${pkg.version} (community)`)
    .replace(/^copair\s+/, '');
  process.stdout.write('\n');
  process.stdout.write(chalk.cyan(LOGO) + '\n');
  process.stdout.write(
    chalk.gray(`  ${pkg.description}`) +
      chalk.dim('  ·  ') +
      chalk.gray(`v${display}`) +
      '\n',
  );
  process.stdout.write(
    chalk.dim('  Model: ') +
      chalk.white(modelName) +
      chalk.dim('  ·  /help for commands  ·  Ctrl+D to exit') +
      '\n\n',
  );
}
