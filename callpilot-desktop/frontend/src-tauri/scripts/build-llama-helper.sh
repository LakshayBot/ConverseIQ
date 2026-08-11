#!/usr/bin/env bash
# Builds the bundled llama-helper sidecar and stages it for Tauri's
# externalBin mechanism as `binaries/llama-helper-<target-triple>`.
#
# The Cargo workspace is rooted at frontend/src-tauri; llama-helper is a
# workspace member so it shares the target/ directory with the app crate.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_TAURI="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"

if [[ -z "$TARGET_TRIPLE" ]]; then
  echo "error: could not determine rustc host triple" >&2
  exit 1
fi

FEATURES=""
case "$TARGET_TRIPLE" in
  *apple*) FEATURES="--features metal" ;;
esac

echo "llama-helper: building for $TARGET_TRIPLE (features: ${FEATURES:-none})"

(cd "$SRC_TAURI" && cargo build --release -p llama-helper $FEATURES)

BIN_SRC="$SRC_TAURI/target/release/llama-helper"
if [[ "$TARGET_TRIPLE" == *windows* ]]; then
  BIN_SRC="$BIN_SRC.exe"
fi

mkdir -p "$SRC_TAURI/binaries"
cp "$BIN_SRC" "$SRC_TAURI/binaries/llama-helper-$TARGET_TRIPLE"
chmod +x "$SRC_TAURI/binaries/llama-helper-$TARGET_TRIPLE"

echo "llama-helper: staged to binaries/llama-helper-$TARGET_TRIPLE"
