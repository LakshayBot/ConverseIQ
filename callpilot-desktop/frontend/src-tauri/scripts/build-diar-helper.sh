#!/usr/bin/env bash
# Builds the bundled speaker-diarization sidecar (sherpa-onnx) and stages it
# for Tauri externalBin. Mirrors build-llama-helper.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_TAURI="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"

echo "Building diar-helper for ${TARGET_TRIPLE}..."
(cd "$SRC_TAURI" && cargo build --release -p diar-helper)

BIN_SRC="$SRC_TAURI/target/release/diar-helper"
if [[ "$TARGET_TRIPLE" == *windows* ]]; then
  BIN_SRC="${BIN_SRC}.exe"
fi

mkdir -p "$SRC_TAURI/binaries"
cp "$BIN_SRC" "$SRC_TAURI/binaries/diar-helper-$TARGET_TRIPLE"
chmod +x "$SRC_TAURI/binaries/diar-helper-$TARGET_TRIPLE"
echo "Staged diar-helper -> binaries/diar-helper-$TARGET_TRIPLE"
