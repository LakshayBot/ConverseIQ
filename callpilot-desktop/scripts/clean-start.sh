#!/usr/bin/env bash
# Clean-start script for CallPilot Desktop.
# Wipes ALL local app data, rebuilds, and relaunches.
#
# Usage:
#   ./scripts/clean-start.sh              # wipe + rebuild + launch
#   ./scripts/clean-start.sh --no-build   # wipe + launch existing build
#   ./scripts/clean-start.sh --no-launch  # wipe + rebuild only
#
# What gets wiped:
#   - ~/Library/Application Support/ai.callpilot.desktop/   (models, DB, settings, recordings)
#   - ~/Library/WebKit/ai.callpilot.desktop/                (webview IndexedDB / localStorage)
#   - ~/Library/Caches/ai.callpilot.desktop/                (webview caches)

set -euo pipefail

BUNDLE_ID="ai.callpilot.desktop"
APP_SUPPORT="$HOME/Library/Application Support/$BUNDLE_ID"
WEBKIT_DIR="$HOME/Library/WebKit/$BUNDLE_ID"
CACHE_DIR="$HOME/Library/Caches/$BUNDLE_ID"

DO_BUILD=1
DO_LAUNCH=1

for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --no-launch) DO_LAUNCH=0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "============================================"
echo "  CallPilot Desktop - clean start"
echo "============================================"
echo "Data dirs to wipe:"
echo "  - $APP_SUPPORT"
echo "  - $WEBKIT_DIR"
echo "  - $CACHE_DIR"
echo ""

# Stop the app if running
if pgrep -f "CallPilot.app/Contents/MacOS/callpilot-audio" > /dev/null 2>&1; then
  echo "[1/4] Stopping running CallPilot process…"
  pkill -f "CallPilot.app/Contents/MacOS/callpilot-audio" || true
  sleep 1
else
  echo "[1/4] No running CallPilot process found."
fi

# Wipe data dirs
echo "[2/4] Wiping app data…"
rm -rf "$APP_SUPPORT"
rm -rf "$WEBKIT_DIR"
rm -rf "$CACHE_DIR"
echo "      ✓ done."

if [ "$DO_BUILD" -eq 1 ]; then
  echo "[3/4] Rebuilding CallPilot.app…"
  cd "$PROJECT_ROOT/frontend"
  pnpm tauri:build:cpu
else
  echo "[3/4] Skipping build (--no-build)."
fi

if [ "$DO_LAUNCH" -eq 1 ]; then
  echo "[4/4] Launching CallPilot.app…"
  APP_PATH="$PROJECT_ROOT/target/release/bundle/macos/CallPilot.app"
  if [ ! -d "$APP_PATH" ]; then
    echo "      ! Build not found at $APP_PATH. Run with --no-build=false (default) first." >&2
    exit 1
  fi
  open "$APP_PATH"
else
  echo "[4/4] Skipping launch (--no-launch)."
fi

echo ""
echo "Done. The app should now launch with a fresh onboarding:"
echo "  1. Welcome"
echo "  2. Permissions (Mic + System Audio)"
echo "  3. Model download - Parakeet TDT 0.6B v3 int8 (~670 MB from HuggingFace)"
echo "  4. Live recording view"
