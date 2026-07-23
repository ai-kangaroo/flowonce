#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SKILL_VALIDATOR="${SKILL_VALIDATOR:-}"
PLUGIN_VALIDATOR="${PLUGIN_VALIDATOR:-}"
"$ROOT/scripts/build.sh"
CLANG_MODULE_CACHE_PATH="$ROOT/.build/module-cache" clang \
  -Wall -Wextra -Werror -fobjc-arc -fsyntax-only \
  "$ROOT/scripts/macos-installer.m"
node "$ROOT/tests/mcp-contract.mjs"
node "$ROOT/tests/mcp-elicitation.mjs"
node --check "$ROOT/scripts/normalize-recording.mjs"
node --check "$ROOT/scripts/compile-workflow.mjs"
node --check "$ROOT/scripts/generate-skill.mjs"
node --check "$ROOT/scripts/host-config.mjs"
node --check "$ROOT/scripts/install-distribution.mjs"
node --check "$ROOT/scripts/create-release-manifest.mjs"
node --check "$ROOT/tests/release-package.mjs"
node --check "$ROOT/scripts/recorder-service.mjs"
node --check "$ROOT/scripts/record-replay.mjs"
node --check "$ROOT/scripts/workflow-validation.mjs"
node --check "$ROOT/scripts/validate-workflow.mjs"
node "$ROOT/tests/version-consistency.mjs"
node "$ROOT/tests/recorder-service.mjs"
node "$ROOT/tests/semantic-pipeline.mjs"
node "$ROOT/tests/installer.mjs"
"$ROOT/tests/generated-skill.sh"
"$ROOT/tests/standalone-cli.sh"
"$ROOT/tests/lifecycle.sh"
if [ -n "${RECORD_REPLAY_RELEASE_PAYLOAD:-}" ]; then
  node "$ROOT/tests/release-package.mjs" "$RECORD_REPLAY_RELEASE_PAYLOAD"
fi
if [ -n "$SKILL_VALIDATOR" ] && [ -f "$SKILL_VALIDATOR" ]; then
  python3 "$SKILL_VALIDATOR" "$ROOT/skills/record-and-replay-local"
else
  printf '%s\n' "Codex skill validation not requested; set SKILL_VALIDATOR to enable it"
fi
if [ -n "$PLUGIN_VALIDATOR" ] && [ -f "$PLUGIN_VALIDATOR" ]; then
  python3 "$PLUGIN_VALIDATOR" "$ROOT"
else
  printf '%s\n' "Codex plugin validation not requested; set PLUGIN_VALIDATOR to enable it"
fi
codesign -d -r- "$ROOT/bin/FlowOnce.app" 2>&1 | grep -F 'designated => identifier "local.record-and-replay"'
