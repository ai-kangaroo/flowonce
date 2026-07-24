#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUTPUT_PARENT=${1:-"$ROOT/dist"}
NODE_BINARY=${RECORD_REPLAY_NODE:-$(command -v node)}
NODE_BINARY=$("$NODE_BINARY" -p 'process.execPath')
NODE_ROOT=$(CDPATH= cd -- "$(dirname -- "$NODE_BINARY")/.." && pwd)
NODE_LICENSE=${RECORD_REPLAY_NODE_LICENSE:-"$NODE_ROOT/LICENSE"}
VERSION=$("$NODE_BINARY" -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version)' "$ROOT/release.json")
ARCHITECTURE=$("$NODE_BINARY" -p 'process.arch')
NODE_VERSION=$("$NODE_BINARY" --version)
case "$ARCHITECTURE" in
  arm64) PACKAGE_ARCHITECTURE="Apple-Silicon" ;;
  x64) PACKAGE_ARCHITECTURE="Intel" ;;
  *) PACKAGE_ARCHITECTURE="$ARCHITECTURE" ;;
esac
RELEASE_BASENAME="FlowOnce-$VERSION-macOS-$PACKAGE_ARCHITECTURE"
RELEASE_DIRECTORY="$OUTPUT_PARENT/$RELEASE_BASENAME"
DMG_PATH="$OUTPUT_PARENT/$RELEASE_BASENAME.dmg"
ZIP_PATH="$OUTPUT_PARENT/$RELEASE_BASENAME.zip"
CHECKSUM_PATH="$OUTPUT_PARENT/$RELEASE_BASENAME.sha256"
SIGN_IDENTITY=${RECORD_REPLAY_SIGN_IDENTITY:--}

if [ ! -x "$NODE_BINARY" ]; then
  echo "Node runtime is not executable: $NODE_BINARY" >&2
  exit 1
fi
if [ ! -f "$NODE_LICENSE" ]; then
  echo "Node LICENSE is required for redistribution: $NODE_LICENSE" >&2
  exit 1
fi
if [ -n "${RECORD_REPLAY_NOTARY_PROFILE:-}" ] && [ "$SIGN_IDENTITY" = "-" ]; then
  echo "RECORD_REPLAY_NOTARY_PROFILE requires RECORD_REPLAY_SIGN_IDENTITY" >&2
  exit 1
fi
LATEST_DMG="$OUTPUT_PARENT/FlowOnce-macOS-$PACKAGE_ARCHITECTURE.dmg"
LATEST_ZIP="$OUTPUT_PARENT/FlowOnce-macOS-$PACKAGE_ARCHITECTURE.zip"

if [ -e "$RELEASE_DIRECTORY" ] || [ -e "$DMG_PATH" ] || [ -e "$ZIP_PATH" ] || [ -e "$CHECKSUM_PATH" ]; then
  echo "Release output already exists for $RELEASE_BASENAME" >&2
  exit 1
fi

mkdir -p "$OUTPUT_PARENT"
STAGING=$(mktemp -d "$OUTPUT_PARENT/.record-replay-release.XXXXXX")
trap 'rm -rf "$STAGING"' EXIT HUP INT TERM
PAYLOAD="$STAGING/payload"
PRODUCT="$PAYLOAD/product"
INSTALLER_APP="$STAGING/Install FlowOnce.app"
STAGED_RELEASE="$STAGING/$RELEASE_BASENAME"
STAGED_DMG="$STAGING/$RELEASE_BASENAME.dmg"
STAGED_ZIP="$STAGING/$RELEASE_BASENAME.zip"

"$ROOT/scripts/build.sh"
NATIVE_ARCHITECTURE=$ARCHITECTURE
if [ "$NATIVE_ARCHITECTURE" = "x64" ]; then NATIVE_ARCHITECTURE=x86_64; fi
if ! file "$ROOT/bin/FlowOnce.app/Contents/MacOS/RecordAndReplayLocal" | grep -F "$NATIVE_ARCHITECTURE" >/dev/null; then
  echo "Native recorder architecture does not match bundled Node architecture: $ARCHITECTURE" >&2
  exit 1
fi
mkdir -p "$PRODUCT/bin" "$PRODUCT/scripts" "$PRODUCT/skills/record-and-replay-local" \
  "$PAYLOAD/runtime/bin" "$PAYLOAD/licenses/node" "$PAYLOAD/skill-packages"
ditto "$ROOT/bin/FlowOnce.app" "$PRODUCT/bin/FlowOnce.app"
cp "$ROOT/release.json" "$PRODUCT/release.json"
for script in \
  compile-workflow.mjs \
  doctor-service.mjs \
  event-stream-mcp.mjs \
  generate-skill.mjs \
  host-config.mjs \
  install-distribution.mjs \
  normalize-recording.mjs \
  record-replay.mjs \
  recorder-service.mjs \
  skill-test-service.mjs \
  validate-workflow.mjs \
  workflow-validation.mjs
do
  cp "$ROOT/scripts/$script" "$PRODUCT/scripts/$script"
done
cp "$ROOT/skills/record-and-replay-local/SKILL.md" "$PRODUCT/skills/record-and-replay-local/SKILL.md"
cp -R "$ROOT/skills/record-and-replay-local/references" "$PRODUCT/skills/record-and-replay-local/references"
cp "$NODE_BINARY" "$PAYLOAD/runtime/bin/node"
chmod 755 "$PAYLOAD/runtime/bin/node"
cp "$NODE_LICENSE" "$PAYLOAD/licenses/node/LICENSE"
"$NODE_BINARY" "$ROOT/scripts/create-release-manifest.mjs" \
  "$ROOT/release.json" "$PAYLOAD/manifest.json" "$ARCHITECTURE" "$NODE_VERSION"
ditto -c -k --sequesterRsrc --keepParent \
  "$PRODUCT/skills/record-and-replay-local" \
  "$PAYLOAD/skill-packages/FlowOnce-Controller.zip"

mkdir -p "$INSTALLER_APP/Contents/MacOS" "$INSTALLER_APP/Contents/Resources"
CLANG_MODULE_CACHE_PATH="$ROOT/.build/module-cache" clang \
  -Wall -Wextra -Werror -O2 -fobjc-arc \
  -framework AppKit \
  "$ROOT/scripts/macos-installer.m" \
  -o "$INSTALLER_APP/Contents/MacOS/RecordAndReplayInstaller"
sed "s/__FLOWONCE_VERSION__/$VERSION/g" "$ROOT/scripts/Installer-Info.plist" > "$INSTALLER_APP/Contents/Info.plist"
mkdir -p "$INSTALLER_APP/Contents/Resources/payload"
ditto "$PAYLOAD" "$INSTALLER_APP/Contents/Resources/payload"

if [ "$SIGN_IDENTITY" = "-" ]; then
  codesign --force --sign - "$INSTALLER_APP/Contents/Resources/payload/runtime/bin/node"
  codesign --force --deep --sign - \
    --requirements '=designated => identifier "local.record-and-replay"' \
    "$INSTALLER_APP/Contents/Resources/payload/product/bin/FlowOnce.app"
  codesign --force --deep --sign - "$INSTALLER_APP"
else
  codesign --force --sign "$SIGN_IDENTITY" --options runtime --timestamp \
    "$INSTALLER_APP/Contents/Resources/payload/runtime/bin/node"
  codesign --force --deep --sign "$SIGN_IDENTITY" --options runtime --timestamp \
    "$INSTALLER_APP/Contents/Resources/payload/product/bin/FlowOnce.app"
  codesign --force --deep --sign "$SIGN_IDENTITY" --options runtime --timestamp "$INSTALLER_APP"
fi
codesign --verify --deep --strict "$INSTALLER_APP"

if [ -n "${RECORD_REPLAY_NOTARY_PROFILE:-}" ]; then
  PRENOTARY_ZIP="$STAGING/installer-for-notary.zip"
  ditto -c -k --sequesterRsrc --keepParent "$INSTALLER_APP" "$PRENOTARY_ZIP"
  xcrun notarytool submit "$PRENOTARY_ZIP" --keychain-profile "$RECORD_REPLAY_NOTARY_PROFILE" --wait
  xcrun stapler staple "$INSTALLER_APP"
  xcrun stapler validate "$INSTALLER_APP"
fi

mkdir -p "$STAGED_RELEASE"
ditto "$INSTALLER_APP" "$STAGED_RELEASE/Install FlowOnce.app"
cp "$ROOT/README.md" "$STAGED_RELEASE/README.md"
cp "$ROOT/docs/guides/user-guide.md" "$STAGED_RELEASE/FlowOnce 使用手册.txt"
hdiutil create -volname "FlowOnce" -srcfolder "$STAGED_RELEASE" -format UDZO "$STAGED_DMG" >/dev/null
ditto -c -k --sequesterRsrc --keepParent "$STAGED_RELEASE" "$STAGED_ZIP"

if [ "$SIGN_IDENTITY" != "-" ]; then
  codesign --force --sign "$SIGN_IDENTITY" --timestamp "$STAGED_DMG"
fi
if [ -n "${RECORD_REPLAY_NOTARY_PROFILE:-}" ]; then
  xcrun notarytool submit "$STAGED_DMG" --keychain-profile "$RECORD_REPLAY_NOTARY_PROFILE" --wait
  xcrun stapler staple "$STAGED_DMG"
  xcrun stapler validate "$STAGED_DMG"
fi

mv "$STAGED_RELEASE" "$RELEASE_DIRECTORY"
mv "$STAGED_DMG" "$DMG_PATH"
mv "$STAGED_ZIP" "$ZIP_PATH"

# Create unversioned copies for GitHub latest/download/ links
cp "$DMG_PATH" "$LATEST_DMG"
cp "$ZIP_PATH" "$LATEST_ZIP"

(CDPATH= cd -- "$OUTPUT_PARENT" && shasum -a 256 "$RELEASE_BASENAME.dmg" "$RELEASE_BASENAME.zip" "FlowOnce-macOS-$PACKAGE_ARCHITECTURE.dmg" "FlowOnce-macOS-$PACKAGE_ARCHITECTURE.zip") > "$CHECKSUM_PATH"

echo "$DMG_PATH"
echo "$ZIP_PATH"
echo "$LATEST_DMG"
echo "$LATEST_ZIP"
echo "$CHECKSUM_PATH"
