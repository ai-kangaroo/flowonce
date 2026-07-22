#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE="$ROOT/bin/FlowOnce.app"
INSTALL_ROOT="${RECORD_REPLAY_APP_DIR:-$HOME/Applications}"
TARGET="$INSTALL_ROOT/FlowOnce.app"
LEGACY_TARGET="$INSTALL_ROOT/Record & Replay Local.app"

if [ ! -x "$SOURCE/Contents/MacOS/RecordAndReplayLocal" ]; then
  "$ROOT/scripts/build.sh"
fi

mkdir -p "$INSTALL_ROOT"
rm -rf "$TARGET"
ditto "$SOURCE" "$TARGET"
codesign --verify --deep --strict "$TARGET"
if [ -d "$LEGACY_TARGET" ] && [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$LEGACY_TARGET/Contents/Info.plist" 2>/dev/null || true)" = "local.record-and-replay" ]; then
  MIGRATION_ROOT="$HOME/Library/Application Support/FlowOnce/migration-backups"
  mkdir -p "$MIGRATION_ROOT"
  mv "$LEGACY_TARGET" "$MIGRATION_ROOT/Record & Replay Local.app"
fi
printf '%s\n' "$TARGET"
