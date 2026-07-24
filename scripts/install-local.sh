#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
HOSTS=${1:-auto}
INSTALL_HOME=${FLOWONCE_INSTALL_HOME:-"$HOME"}
NODE_BINARY=${RECORD_REPLAY_NODE:-$(command -v node)}
NODE_BINARY=$("$NODE_BINARY" -p 'process.execPath')
ARCHITECTURE=$("$NODE_BINARY" -p 'process.arch')
NODE_VERSION=$("$NODE_BINARY" --version)
STAGING=$(mktemp -d "${TMPDIR:-/tmp}/flowonce-local-install.XXXXXX")
trap 'rm -rf "$STAGING"' EXIT HUP INT TERM

PAYLOAD="$STAGING/payload"
PRODUCT="$PAYLOAD/product"
SKILL="$PRODUCT/skills/record-and-replay-local"

"$ROOT/scripts/build.sh"
mkdir -p "$PRODUCT/bin" "$PRODUCT/scripts" "$SKILL" \
  "$PAYLOAD/runtime/bin" "$PAYLOAD/skill-packages"
ditto "$ROOT/bin/FlowOnce.app" "$PRODUCT/bin/FlowOnce.app"
cp "$ROOT/release.json" "$PRODUCT/release.json"
for script in \
  compile-workflow.mjs \
  doctor-service.mjs \
  event-stream-mcp.mjs \
  generate-skill.mjs \
  host-config.mjs \
  install-distribution.mjs \
  journey-service.mjs \
  normalize-recording.mjs \
  replay-preflight.mjs \
  record-replay.mjs \
  recorder-service.mjs \
  skill-install-service.mjs \
  skill-test-service.mjs \
  validate-workflow.mjs \
  workflow-validation.mjs \
  workflow-summary.mjs
do
  cp "$ROOT/scripts/$script" "$PRODUCT/scripts/$script"
done
cp "$ROOT/skills/record-and-replay-local/SKILL.md" "$SKILL/SKILL.md"
cp -R "$ROOT/skills/record-and-replay-local/references" "$SKILL/references"
cp -R "$ROOT/skills/record-and-replay-local/scripts" "$SKILL/scripts"
chmod 755 "$SKILL/scripts/flowonce-bootstrap.sh"
cp "$NODE_BINARY" "$PAYLOAD/runtime/bin/node"
chmod 755 "$PAYLOAD/runtime/bin/node"
ditto -c -k --sequesterRsrc --keepParent "$SKILL" "$PAYLOAD/skill-packages/FlowOnce-Controller.zip"
"$NODE_BINARY" "$ROOT/scripts/create-release-manifest.mjs" \
  "$ROOT/release.json" "$PAYLOAD/manifest.json" "$ARCHITECTURE" "$NODE_VERSION"

DETECT_FLAG=
if [ "${FLOWONCE_INSTALL_NO_SYSTEM_DETECT:-0}" = "1" ]; then
  DETECT_FLAG=--no-system-detect
fi
"$NODE_BINARY" "$ROOT/scripts/install-distribution.mjs" \
  --payload "$PAYLOAD" \
  --home "$INSTALL_HOME" \
  --hosts "$HOSTS" \
  $DETECT_FLAG
