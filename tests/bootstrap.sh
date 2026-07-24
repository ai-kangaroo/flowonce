#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TEST_HOME=$(mktemp -d "${TMPDIR:-/tmp}/flowonce-bootstrap-test.XXXXXX")
INSTALL_ROOT="$TEST_HOME/Library/Application Support/FlowOnce"
mkdir -p "$INSTALL_ROOT/bin" "$TEST_HOME/Applications/FlowOnce.app/Contents/MacOS"

cat > "$INSTALL_ROOT/bin/flowonce" <<'EOF'
#!/bin/sh
printf '%s\n' '{"ready": true, "status": "ready", "sourceVersion": "0.4.0", "issueCode": null, "nextAction": "开始第一次演示"}'
EOF
chmod 755 "$INSTALL_ROOT/bin/flowonce"
cat > "$TEST_HOME/Applications/FlowOnce.app/Contents/MacOS/RecordAndReplayLocal" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod 755 "$TEST_HOME/Applications/FlowOnce.app/Contents/MacOS/RecordAndReplayLocal"

HOME="$TEST_HOME" "$ROOT/skills/record-and-replay-local/scripts/flowonce-bootstrap.sh" \
  | grep -F '"ready": true' >/dev/null

PREVIEW_HOME=$(mktemp -d "${TMPDIR:-/tmp}/flowonce-bootstrap-preview.XXXXXX")
PREVIEW_RELEASES=$(mktemp -d "${TMPDIR:-/tmp}/flowonce-bootstrap-releases.XXXXXX")
trap 'rm -rf "$TEST_HOME" "$PREVIEW_HOME" "$PREVIEW_RELEASES"' EXIT HUP INT TERM
VERSION=$(sed -n 's/^[[:space:]]*version:[[:space:]]*//p' "$ROOT/skills/record-and-replay-local/SKILL.md" | head -1)
case "$(/usr/bin/uname -m)" in
  arm64) PACKAGE_ARCH="Apple-Silicon" ;;
  x86_64) PACKAGE_ARCH="Intel" ;;
  *) printf '%s\n' "Unsupported test architecture" >&2; exit 1 ;;
esac
RELEASE_NAME="FlowOnce-$VERSION-macOS-$PACKAGE_ARCH"
RELEASE_DIR="$PREVIEW_RELEASES/v$VERSION"
STAGING="$PREVIEW_RELEASES/staging/$RELEASE_NAME"
INSTALLER="$STAGING/Install FlowOnce.app"
mkdir -p "$INSTALLER/Contents/MacOS" "$RELEASE_DIR"
cat > "$INSTALLER/Contents/MacOS/RecordAndReplayInstaller" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod 755 "$INSTALLER/Contents/MacOS/RecordAndReplayInstaller"
cat > "$INSTALLER/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>RecordAndReplayInstaller</string>
<key>CFBundleIdentifier</key><string>local.flowonce.bootstrap-test</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
EOF
/usr/bin/codesign --force --deep --sign - "$INSTALLER" >/dev/null
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$STAGING" "$RELEASE_DIR/$RELEASE_NAME.zip"
(
  cd "$RELEASE_DIR"
  /usr/bin/shasum -a 256 "$RELEASE_NAME.zip" > "$RELEASE_NAME.sha256"
)
OPEN_LOG="$PREVIEW_RELEASES/open.log"
OPEN_STUB="$PREVIEW_RELEASES/open-stub"
cat > "$OPEN_STUB" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$OPEN_LOG"
exit 1
EOF
chmod 755 "$OPEN_STUB"

PREVIEW_RESULT=$(HOME="$PREVIEW_HOME" \
  FLOWONCE_RELEASE_BASE_URL="file://$RELEASE_DIR" \
  FLOWONCE_OPEN_BIN="$OPEN_STUB" \
  "$ROOT/skills/record-and-replay-local/scripts/flowonce-bootstrap.sh")
printf '%s' "$PREVIEW_RESULT" | grep -F '"issueCode":"gatekeeper_approval_required"' >/dev/null
grep -F 'x-apple.systempreferences:com.apple.preference.security?General' "$OPEN_LOG" >/dev/null

printf '%s\n' "Skill-first bootstrap ready and Gatekeeper-guidance paths OK"
