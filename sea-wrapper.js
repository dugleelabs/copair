'use strict';

// SEA entry point (runs as CJS). Extracts the ESM bundle from embedded
// assets, writes it to a temp file, and dynamically imports it.
// This is needed because Node 22 SEA always evaluates the main script
// as CJS, but our dependencies (ink, yoga-layout) require ESM
// (top-level await).

const { getAsset } = require('node:sea');
const { writeFileSync, unlinkSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { pathToFileURL } = require('url');

// Bake in package version so the app doesn't need to find package.json at runtime.
// __COPAIR_VERSION__ is replaced by the build script via sed.
process.env.COPAIR_VERSION = '__COPAIR_VERSION__';

const tmp = join(tmpdir(), `copair-sea-${process.pid}.mjs`);
writeFileSync(tmp, getAsset('app.mjs', 'utf8'));

import(pathToFileURL(tmp).href)
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    try { unlinkSync(tmp); } catch {}
  });
