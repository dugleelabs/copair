import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}

console.log(`copair v${pkg.version}`);
