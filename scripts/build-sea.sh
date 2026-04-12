#!/bin/bash
set -euo pipefail

PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
BINARY_NAME="copair"

echo "Building SEA for ${PLATFORM}-${ARCH}..."

# 1. Standard build (CLI + API)
pnpm build

# 2. Strip shebang from CLI bundle before re-bundling for SEA
sed '1s|^#!/usr/bin/env node||' dist/index.js > dist/index-no-shebang.js

# 3. Create self-contained ESM bundle for SEA (all deps inlined)
#    Node 22 SEA runs the main entry as CJS, so we can't use this directly.
#    Instead, sea-wrapper.js (CJS) extracts this from SEA assets and imports it.
# Stub out react-devtools-core (optional dep of ink, only used when DEV=true).
# In SEA there are no node_modules, so external imports fail at parse time.
echo 'export default {}' > dist/react-devtools-stub.mjs

pnpm exec esbuild dist/index-no-shebang.js \
  --bundle \
  --format=esm \
  --platform=node \
  --target=node22 \
  --outfile=dist/sea-entry.mjs \
  --alias:react-devtools-core=./dist/react-devtools-stub.mjs \
  --banner:js="import { createRequire as __seaCreateRequire } from 'module'; const require = __seaCreateRequire(import.meta.url);"

rm dist/index-no-shebang.js

echo "SEA bundle: $(wc -c < dist/sea-entry.mjs | tr -d ' ') bytes"

# 4. Inject package version into the CJS wrapper so the app knows its version at runtime
VERSION=$(node -p "require('./package.json').version")
sed "s/__COPAIR_VERSION__/${VERSION}/g" sea-wrapper.js > dist/sea-wrapper.js
echo "Version: ${VERSION}"

# 5. Generate SEA blob (embeds dist/sea-wrapper.js as main + sea-entry.mjs as asset)
node --experimental-sea-config sea-config.json

# 6. Copy node binary as base
cp "$(command -v node)" "${BINARY_NAME}"

# 7. Remove existing signature (macOS)
if [[ "$PLATFORM" == "darwin" ]]; then
  codesign --remove-signature "${BINARY_NAME}"
fi

# 8. Inject SEA blob
POSTJECT_ARGS=(
  "${BINARY_NAME}" NODE_SEA_BLOB sea-prep.blob
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
)
if [[ "$PLATFORM" == "darwin" ]]; then
  POSTJECT_ARGS+=(--macho-segment-name NODE_SEA)
fi
pnpm exec postject "${POSTJECT_ARGS[@]}"

# 9. Re-sign (macOS)
if [[ "$PLATFORM" == "darwin" ]]; then
  codesign --sign - "${BINARY_NAME}"
fi

# 10. Cleanup
rm -f sea-prep.blob dist/sea-entry.mjs dist/react-devtools-stub.mjs dist/sea-wrapper.js

# 11. Verify
./"${BINARY_NAME}" --version

echo "SEA binary built: ./${BINARY_NAME}"
