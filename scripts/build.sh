#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NODE_BINARY=${RECORD_REPLAY_NODE:-$(command -v node)}
VERSION=$("$NODE_BINARY" -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version)' "$ROOT/release.json")
NODE_ARCHITECTURE=$("$NODE_BINARY" -p 'process.arch')
case "$NODE_ARCHITECTURE" in
  arm64) NATIVE_ARCHITECTURE=arm64 ;;
  x64) NATIVE_ARCHITECTURE=x86_64 ;;
  *)
    echo "Unsupported Node architecture: $NODE_ARCHITECTURE" >&2
    exit 1
    ;;
esac
mkdir -p "$ROOT/bin"
mkdir -p "$ROOT/.build/module-cache"
APP="$ROOT/bin/FlowOnce.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
rm -rf "$APP" "$ROOT/bin/Record & Replay Local.app"
mkdir -p "$MACOS"
CLANG_MODULE_CACHE_PATH="$ROOT/.build/module-cache" clang \
  -Wall -Wextra -Werror -O2 -fobjc-arc -fblocks \
  -arch "$NATIVE_ARCHITECTURE" \
  -framework AppKit \
  -framework ApplicationServices \
  "$ROOT/scripts/macos-event-capture.m" \
  -o "$MACOS/RecordAndReplayLocal"
sed "s/__FLOWONCE_VERSION__/$VERSION/g" "$ROOT/scripts/Info.plist" > "$CONTENTS/Info.plist"
codesign --force --deep --sign - \
  --requirements '=designated => identifier "local.record-and-replay"' \
  "$APP"
codesign --verify --deep --strict "$APP"
echo "Built $APP"
