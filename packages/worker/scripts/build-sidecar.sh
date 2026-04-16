#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:-dist}"
mkdir -p "$OUTPUT_DIR"

for ARCH in arm64 amd64; do
  echo "Building koe-sidecar for darwin/$ARCH..."
  CGO_ENABLED=0 GOOS=darwin GOARCH="$ARCH" \
    go build -ldflags="-s -w" -o "$OUTPUT_DIR/koe-sidecar-darwin-$ARCH" ./cmd/sidecar
done

# Create aliases for electron-builder's ${arch} (arm64/x64)
cp "$OUTPUT_DIR/koe-sidecar-darwin-amd64" "$OUTPUT_DIR/koe-sidecar-darwin-x64"

echo "Done. Binaries in $OUTPUT_DIR/"
ls -lh "$OUTPUT_DIR"/koe-sidecar-*
