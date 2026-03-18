import chalk from 'chalk';
import pkg from '../../package.json' assert { type: 'json' };

const LOGO = `
 ██████╗ ██████╗ ██████╗  █████╗ ██╗██████╗
██╔════╝██╔═══██╗██╔══██╗██╔══██╗██║██╔══██╗
██║     ██║   ██║██████╔╝███████║██║██████╔╝
██║     ██║   ██║██╔═══╝ ██╔══██║██║██╔══██╗
╚██████╗╚██████╔╝██║     ██║  ██║██║██║  ██║
 ╚═════╝ ╚═════╝ ╚═╝     ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝`.trimStart();

export function printBanner(modelName: string): void {
  process.stdout.write('\n');
  process.stdout.write(chalk.cyan(LOGO) + '\n');
  process.stdout.write(
    chalk.gray(`  ${pkg.description}`) +
      chalk.dim('  ·  ') +
      chalk.gray(`v${pkg.version}`) +
      '\n',
  );
  process.stdout.write(
    chalk.dim('  Model: ') +
      chalk.white(modelName) +
      chalk.dim('  ·  /help for commands  ·  Ctrl+D to exit') +
      '\n\n',
  );
}
