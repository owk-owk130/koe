#!/usr/bin/env bash
set -euo pipefail

# Download ffmpeg and ffprobe static binaries for macOS.
# Uses evermeet.cx builds (widely used for macOS static ffmpeg).

OUTPUT_DIR="${1:-build/ffmpeg}"
mkdir -p "$OUTPUT_DIR"

if [ -f "$OUTPUT_DIR/ffmpeg" ] && [ -f "$OUTPUT_DIR/ffprobe" ]; then
  echo "ffmpeg binaries already exist in $OUTPUT_DIR/, skipping download."
  exit 0
fi

FFMPEG_URL="https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip"
FFPROBE_URL="https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip"
TMP_DIR=$(mktemp -d)

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "Downloading ffmpeg..."
curl -L "$FFMPEG_URL" -o "$TMP_DIR/ffmpeg.zip"
unzip -o "$TMP_DIR/ffmpeg.zip" -d "$OUTPUT_DIR"

echo "Downloading ffprobe..."
curl -L "$FFPROBE_URL" -o "$TMP_DIR/ffprobe.zip"
unzip -o "$TMP_DIR/ffprobe.zip" -d "$OUTPUT_DIR"

chmod +x "$OUTPUT_DIR/ffmpeg" "$OUTPUT_DIR/ffprobe"

echo "Done."
ls -lh "$OUTPUT_DIR"/ff*
