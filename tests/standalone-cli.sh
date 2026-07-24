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
printf '%s\n' '{"text":"different CLI test value"}' > "$OUTPUT/test-inputs.json"
TEST_STARTED=$(FLOWONCE_EVALUATION_ROOT="$OUTPUT/evaluations" node "$ROOT/scripts/record-replay.mjs" \
  test-start "$OUTPUT/standalone-demo" "$OUTPUT/test-inputs.json" \
  --backend semantic-test-backend --context fresh)
RUN_ID=$(printf '%s' "$TEST_STARTED" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).runID))')
printf '%s\n' '{"outcome":"passed","backend":"semantic-test-backend","successObserved":true,"finalObservation":"Expected document state observed.","stepResults":[{"stepID":"focus_composer","status":"passed","observation":"Editor focused."},{"stepID":"enter_text","status":"passed","observation":"Text present."}]}' > "$OUTPUT/test-result.json"
FLOWONCE_EVALUATION_ROOT="$OUTPUT/evaluations" node "$ROOT/scripts/record-replay.mjs" \
  test-finish "$RUN_ID" "$OUTPUT/test-result.json" \
  | grep -F '"verdict": "passed"' >/dev/null
FLOWONCE_EVALUATION_ROOT="$OUTPUT/evaluations" node "$ROOT/scripts/record-replay.mjs" \
  test-status "$RUN_ID" \
  | grep -F '"found": true' >/dev/null
node "$ROOT/scripts/record-replay.mjs" validate \
  "$ROOT/tests/fixtures/reviewed-workflow.json" --reviewed \
  | grep -F 'Workflow is valid' >/dev/null
node "$ROOT/scripts/record-replay.mjs" host-config codebuddy \
  | grep -F '"mcpConfigPath":' >/dev/null
node "$ROOT/scripts/record-replay.mjs" host-config workbuddy \
  | grep -F '.workbuddy/mcp.json' >/dev/null
node "$ROOT/scripts/record-replay.mjs" host-config qoder \
  | grep -F '.qoder/settings.json' >/dev/null
node "$ROOT/scripts/record-replay.mjs" doctor codex --json \
  | grep -F '"status":' >/dev/null
node "$ROOT/scripts/record-replay.mjs" --help 2>&1 | grep -F 'test-start <skill-directory>' >/dev/null
printf '%s\n' "Standalone CLI OK"
