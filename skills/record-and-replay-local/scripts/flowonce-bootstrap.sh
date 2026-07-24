#!/bin/sh
set -eu

SKILL_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SKILL_FILE="$SKILL_ROOT/SKILL.md"
VERSION=$(sed -n 's/^[[:space:]]*version:[[:space:]]*//p' "$SKILL_FILE" | head -1)
if ! printf '%s' "$VERSION" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' >/dev/null; then
  printf '%s\n' '{"ready":false,"status":"failed","issueCode":"invalid_skill_version","nextAction":"FlowOnce Skill 版本信息无效，请从 SkillHub 重新安装。"}'
  exit 1
fi
RELEASE_BASE_URL=${FLOWONCE_RELEASE_BASE_URL:-"https://github.com/ai-kangaroo/flowonce/releases/download/v$VERSION"}
OPEN_BIN=${FLOWONCE_OPEN_BIN:-/usr/bin/open}
INSTALL_ROOT="$HOME/Library/Application Support/FlowOnce"
FLOWONCE_CLI="$INSTALL_ROOT/bin/flowonce"
RECORDER_APP="$HOME/Applications/FlowOnce.app"

if [ -x "$FLOWONCE_CLI" ] && [ -x "$RECORDER_APP/Contents/MacOS/RecordAndReplayLocal" ]; then
  REPORT=$("$FLOWONCE_CLI" doctor portable --json || true)
  if printf '%s' "$REPORT" | grep -F '"ready": true' >/dev/null \
    && printf '%s' "$REPORT" | grep -F "\"sourceVersion\": \"$VERSION\"" >/dev/null; then
    printf '%s\n' "$REPORT"
    exit 0
  fi
  if printf '%s' "$REPORT" | grep -F '"issueCode": "accessibility_permission_required"' >/dev/null; then
    RESULT_PATH=$(mktemp "${TMPDIR:-/tmp}/flowonce-accessibility.XXXXXX")
    "$OPEN_BIN" -W -n "$RECORDER_APP" --args --request-accessibility "$RESULT_PATH"
    rm -f "$RESULT_PATH"
    "$FLOWONCE_CLI" doctor portable --json || true
    exit 0
  fi
fi

case "$(/usr/bin/uname -m)" in
  arm64) PACKAGE_ARCH="Apple-Silicon" ;;
  x86_64) PACKAGE_ARCH="Intel" ;;
  *)
    printf '%s\n' '{"ready":false,"status":"unsupported","issueCode":"unsupported_architecture","nextAction":"FlowOnce 暂不支持这台 Mac 的处理器架构。"}'
    exit 1
    ;;
esac

RELEASE_NAME="FlowOnce-$VERSION-macOS-$PACKAGE_ARCH"
ZIP_NAME="$RELEASE_NAME.zip"
CHECKSUM_NAME="$RELEASE_NAME.sha256"
TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/flowonce-bootstrap.XXXXXX")
trap 'rm -rf "$TEMP_ROOT"' EXIT HUP INT TERM

/usr/bin/curl --fail --location --silent --show-error \
  "$RELEASE_BASE_URL/$ZIP_NAME" \
  --output "$TEMP_ROOT/$ZIP_NAME"
/usr/bin/curl --fail --location --silent --show-error \
  "$RELEASE_BASE_URL/$CHECKSUM_NAME" \
  --output "$TEMP_ROOT/$CHECKSUM_NAME"

EXPECTED=$(awk -v name="$ZIP_NAME" '$2 == name { print $1; exit }' "$TEMP_ROOT/$CHECKSUM_NAME")
ACTUAL=$(/usr/bin/shasum -a 256 "$TEMP_ROOT/$ZIP_NAME" | awk '{ print $1 }')
if [ -z "$EXPECTED" ] || [ "$ACTUAL" != "$EXPECTED" ]; then
  printf '%s\n' '{"ready":false,"status":"failed","issueCode":"download_verification_failed","nextAction":"FlowOnce 安装包校验失败，请稍后重试。"}'
  exit 1
fi

/usr/bin/ditto -x -k "$TEMP_ROOT/$ZIP_NAME" "$TEMP_ROOT/unpacked"
DOWNLOADED_INSTALLER="$TEMP_ROOT/unpacked/$RELEASE_NAME/Install FlowOnce.app"
if [ ! -x "$DOWNLOADED_INSTALLER/Contents/MacOS/RecordAndReplayInstaller" ]; then
  printf '%s\n' '{"ready":false,"status":"failed","issueCode":"installer_missing","nextAction":"下载的 FlowOnce 安装包不完整，请稍后重试。"}'
  exit 1
fi

if ! /usr/bin/codesign --verify --deep --strict "$DOWNLOADED_INSTALLER" >/dev/null 2>&1; then
  printf '%s\n' '{"ready":false,"status":"failed","issueCode":"invalid_code_signature","nextAction":"FlowOnce 安装包的完整性检查失败，已停止安装。请从官方 SkillHub 更新 FlowOnce 后重试。"}'
  exit 1
fi

# Keep the exact verified app at a stable path while the user approves it in
# System Settings. The temporary download is removed when this script exits.
BOOTSTRAP_CACHE="$INSTALL_ROOT/bootstrap/$VERSION-$PACKAGE_ARCH"
INSTALLER_APP="$BOOTSTRAP_CACHE/Install FlowOnce.app"
if [ ! -x "$INSTALLER_APP/Contents/MacOS/RecordAndReplayInstaller" ] \
  || ! /usr/bin/codesign --verify --deep --strict "$INSTALLER_APP" >/dev/null 2>&1; then
  mkdir -p "$BOOTSTRAP_CACHE"
  /usr/bin/ditto "$DOWNLOADED_INSTALLER" "$INSTALLER_APP"
fi

GATEKEEPER_APPROVAL_REQUIRED=false
if ! /usr/sbin/spctl --assess --type execute "$INSTALLER_APP" >/dev/null 2>&1; then
  GATEKEEPER_APPROVAL_REQUIRED=true
fi

if [ "$GATEKEEPER_APPROVAL_REQUIRED" = true ]; then
  # Launch once so macOS creates the narrow, app-specific "Open Anyway" choice.
  # Never remove quarantine attributes or weaken Gatekeeper globally.
  "$OPEN_BIN" -W -n "$INSTALLER_APP" --args --bootstrap >/dev/null 2>&1 || true
  if [ ! -x "$FLOWONCE_CLI" ] || [ ! -x "$RECORDER_APP/Contents/MacOS/RecordAndReplayLocal" ]; then
    "$OPEN_BIN" "x-apple.systempreferences:com.apple.preference.security?General" >/dev/null 2>&1 || true
    printf '%s\n' '{"ready":false,"status":"waiting_for_user","issueCode":"gatekeeper_approval_required","canAutoFix":false,"automaticAction":{"type":"approve_gatekeeper","label":"仍要打开 FlowOnce","requiresUserInteraction":true,"settingsURL":"x-apple.systempreferences:com.apple.preference.security?General"},"nextAction":"已验证安装包完整性。请在刚打开的“隐私与安全性”页面向下滚动，点击 FlowOnce 旁的“仍要打开”，然后回来说“继续初始化”。不要关闭 Gatekeeper，也不要运行 xattr 命令。"}'
    exit 0
  fi
else
  "$OPEN_BIN" -W -n "$INSTALLER_APP" --args --bootstrap
fi

if [ ! -x "$FLOWONCE_CLI" ] || [ ! -x "$RECORDER_APP/Contents/MacOS/RecordAndReplayLocal" ]; then
  printf '%s\n' '{"ready":false,"status":"failed","issueCode":"bootstrap_install_failed","nextAction":"FlowOnce 自动准备未完成，请重试。"}'
  exit 1
fi

RESULT_PATH=$(mktemp "${TMPDIR:-/tmp}/flowonce-accessibility.XXXXXX")
"$OPEN_BIN" -W -n "$RECORDER_APP" --args --request-accessibility "$RESULT_PATH"
rm -f "$RESULT_PATH"
"$FLOWONCE_CLI" doctor portable --json || true
