#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
STATE=$(mktemp -d "${TMPDIR:-/tmp}/record-replay-cli-state.XXXXXX")
OUTPUT=$(mktemp -d "${TMPDIR:-/tmp}/record-replay-cli-output.XXXXXX")

RECORD_REPLAY_STATE_ROOT="$STATE" node "$ROOT/scripts/record-replay.mjs" status \
  | grep -F '"isRecording": false' >/dev/null

node "$ROOT/scripts/record-replay.mjs" generate \
  "$ROOT/tests/fixtures/reviewed-workflow.json" \
  "$OUTPUT" \
  standalone-demo >/dev/null

[ -f "$OUTPUT/standalone-demo/SKILL.md" ]
node "$ROOT/scripts/record-replay.mjs" validate \
  "$ROOT/tests/fixtures/reviewed-workflow.json" --reviewed \
  | grep -F 'Workflow is valid' >/dev/null
node "$ROOT/scripts/record-replay.mjs" host-config codebuddy \
  | grep -F '"mcpConfigPath":' >/dev/null
node "$ROOT/scripts/record-replay.mjs" host-config workbuddy \
  | grep -F '.workbuddy/mcp.json' >/dev/null
node "$ROOT/scripts/record-replay.mjs" host-config qoder \
  | grep -F '.qoder/settings.json' >/dev/null
node "$ROOT/scripts/record-replay.mjs" --help 2>&1 | grep -F 'normalize <events.jsonl>' >/dev/null
printf '%s\n' "Standalone CLI OK"
