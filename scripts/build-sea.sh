#!/bin/bash
set -euo pipefail

PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
BINARY_NAME="copair"

echo "Building SEA for ${PLATFORM}-${ARCH}..."

# 1. Bundle TypeScript -> single JS
pnpm build

# 2. Generate SEA blob
node --experimental-sea-config sea-config.json

# 3. Copy node binary as base
cp "$(command -v node)" "${BINARY_NAME}"

# 4. Remove existing signature (macOS)
if [[ "$PLATFORM" == "darwin" ]]; then
  codesign --remove-signature "${BINARY_NAME}"
fi

# 5. Inject SEA blob
npx postject "${BINARY_NAME}" NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# 6. Re-sign (macOS)
if [[ "$PLATFORM" == "darwin" ]]; then
  codesign --sign - "${BINARY_NAME}"
fi

# 7. Verify
./"${BINARY_NAME}" --version

echo "SEA binary built: ./${BINARY_NAME}"
