#!/usr/bin/env node

// Cross-platform SEA (Single Executable Application) build script.
// Replaces build-sea.sh to support macOS, Linux, and Windows.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const platform = process.platform;   // 'darwin', 'linux', 'win32'
const arch = process.arch;           // 'arm64', 'x64'
const binaryName = platform === 'win32' ? 'copair.exe' : 'copair';

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

console.log(`Building SEA for ${platform}-${arch}...`);

// 1. Standard build (CLI + API)
run('pnpm build');

// 2. Strip shebang from CLI bundle before re-bundling for SEA
const indexJs = readFileSync('dist/index.js', 'utf8');
writeFileSync('dist/index-no-shebang.js', indexJs.replace(/^#!.*\n/, ''));

// 3. Stub out react-devtools-core (optional dep of ink, only used when DEV=true).
//    In SEA there are no node_modules, so external imports fail at parse time.
writeFileSync('dist/react-devtools-stub.mjs', 'export default {};\n');

// 4. Create self-contained ESM bundle for SEA (all deps inlined).
//    Node 22 SEA runs the main entry as CJS, so we can't use this directly.
//    Instead, sea-wrapper.js (CJS) extracts this from SEA assets and imports it.
run([
  'pnpm exec esbuild dist/index-no-shebang.js',
  '--bundle',
  '--format=esm',
  '--platform=node',
  '--target=node22',
  '--outfile=dist/sea-entry.mjs',
  '--alias:react-devtools-core=./dist/react-devtools-stub.mjs',
  `--banner:js="import { createRequire as __seaCreateRequire } from 'module'; const require = __seaCreateRequire(import.meta.url);"`,
].join(' '));

unlinkSync('dist/index-no-shebang.js');

// 5. Inject package version into the CJS wrapper
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const wrapper = readFileSync('sea-wrapper.js', 'utf8');
writeFileSync('dist/sea-wrapper.js', wrapper.replace(/__COPAIR_VERSION__/g, version));
console.log(`Version: ${version}`);

// 6. Generate SEA blob (embeds dist/sea-wrapper.js as main + sea-entry.mjs as asset)
run('node --experimental-sea-config sea-config.json');

// 7. Copy node binary as base
const nodeBin = process.execPath;
copyFileSync(nodeBin, binaryName);

// 8. Remove existing signature (macOS)
if (platform === 'darwin') {
  run(`codesign --remove-signature ${binaryName}`);
}

// 9. Inject SEA blob
const postjectArgs = [
  `pnpm exec postject ${binaryName} NODE_SEA_BLOB sea-prep.blob`,
  '--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
];
if (platform === 'darwin') {
  postjectArgs.push('--macho-segment-name NODE_SEA');
}
run(postjectArgs.join(' '));

// 10. Re-sign (macOS) / Remove Zone.Identifier (Windows)
if (platform === 'darwin') {
  run(`codesign --sign - ${binaryName}`);
}

// 11. Cleanup
for (const f of ['sea-prep.blob', 'dist/sea-entry.mjs', 'dist/react-devtools-stub.mjs', 'dist/sea-wrapper.js']) {
  if (existsSync(f)) unlinkSync(f);
}

// 12. Verify
const output = runCapture(platform === 'win32' ? `.\\${binaryName} --version` : `./${binaryName} --version`);
console.log(`Binary output: ${output}`);
if (output !== version) {
  console.error(`Version mismatch! Expected "${version}", got "${output}"`);
  process.exit(1);
}

console.log(`SEA binary built: ./${binaryName}`);
