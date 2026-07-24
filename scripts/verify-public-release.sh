#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DIST=${1:-"$ROOT/dist"}
VERSION=$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version)' "$ROOT/release.json")

verify_architecture() {
  PACKAGE_ARCH=$1
  PROCESS_ARCH=$2
  ARCH_FLAG=$3
  RELEASE_NAME="FlowOnce-$VERSION-macOS-$PACKAGE_ARCH"
  RELEASE_DIR="$DIST/$RELEASE_NAME"
  INSTALLER="$RELEASE_DIR/Install FlowOnce.app"
  PAYLOAD="$INSTALLER/Contents/Resources/payload"
  DMG="$DIST/$RELEASE_NAME.dmg"
  ZIP="$DIST/$RELEASE_NAME.zip"
  CHECKSUM="$DIST/$RELEASE_NAME.sha256"

  for required in "$INSTALLER" "$PAYLOAD/manifest.json" "$DMG" "$ZIP" "$CHECKSUM"; do
    if [ ! -e "$required" ]; then
      echo "Missing public release artifact: $required" >&2
      exit 1
    fi
  done

  MANIFEST_ARCH=$("$PAYLOAD/runtime/bin/node" -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).architecture)' "$PAYLOAD/manifest.json")
  if [ "$MANIFEST_ARCH" != "$PROCESS_ARCH" ]; then
    echo "$RELEASE_NAME has manifest architecture $MANIFEST_ARCH, expected $PROCESS_ARCH" >&2
    exit 1
  fi

  (CDPATH= cd -- "$DIST" && /usr/bin/shasum -a 256 -c "$RELEASE_NAME.sha256")
  SIGNING_INFO=$(/usr/bin/codesign -d --verbose=4 "$INSTALLER" 2>&1 || true)
  if ! printf '%s\n' "$SIGNING_INFO" | grep -F "Authority=Developer ID Application" >/dev/null; then
    echo "$RELEASE_NAME is not signed with a Developer ID Application certificate" >&2
    exit 1
  fi
  /usr/bin/codesign --verify --deep --strict "$INSTALLER"
  /usr/sbin/spctl --assess --type execute "$INSTALLER"
  /usr/bin/xcrun stapler validate "$INSTALLER"
  /usr/bin/xcrun stapler validate "$DMG"
  /usr/bin/arch "$ARCH_FLAG" "$PAYLOAD/runtime/bin/node" "$ROOT/tests/release-package.mjs" "$PAYLOAD"
}

verify_architecture "Apple-Silicon" "arm64" "-arm64"
verify_architecture "Intel" "x64" "-x86_64"

echo "FlowOnce $VERSION public release is signed, notarized, complete, and self-contained for Apple Silicon and Intel."
