import { defineConfig } from 'tsup';

export default defineConfig([
  // CLI entry — includes shebang for direct execution
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node22',
    outDir: 'dist',
    clean: true,
    sourcemap: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  // Library API entry — no shebang, with .d.ts types
  {
    entry: { api: 'src/api.ts' },
    format: ['esm'],
    target: 'node22',
    outDir: 'dist',
    clean: false, // don't wipe CLI output
    sourcemap: true,
    dts: true,
  },
]);
