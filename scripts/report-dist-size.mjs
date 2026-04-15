#!/usr/bin/env node
import { statSync } from 'node:fs';

const files = ['dist/index.js', 'dist/api.js'];
for (const f of files) {
  const { size } = statSync(f);
  console.log(`${f}: ${(size / 1024).toFixed(1)}KB`);
}
