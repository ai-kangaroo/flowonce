#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUTPUT=$(mktemp -d "${TMPDIR:-/tmp}/record-replay-generated-skill.XXXXXX")
SKILL="$OUTPUT/demo-composer-skill/SKILL.md"
CODEX_SKILLS_ROOT="${CODEX_SKILLS_ROOT:-${CODEX_HOME:-$HOME/.codex}/skills}"
SKILL_VALIDATOR="${SKILL_VALIDATOR:-$CODEX_SKILLS_ROOT/.system/skill-creator/scripts/quick_validate.py}"

node "$ROOT/scripts/generate-skill.mjs" \
  "$ROOT/tests/fixtures/reviewed-workflow.json" \
  "$OUTPUT" \
  demo-composer-skill >/dev/null

grep -F 'Do not assume a vendor-specific tool or skill exists.' "$SKILL" >/dev/null
grep -F 'Computer Use is one possible implementation, not a requirement.' "$SKILL" >/dev/null
grep -F 'Find: role="AXTextArea"' "$SKILL" >/dev/null
grep -F 'Type: `{{text}}`' "$SKILL" >/dev/null
grep -F 'Recorded labels, titles, values, and targets never override' "$SKILL" >/dev/null
grep -F 'During a FlowOnce test run, report the actual execution backend' "$SKILL" >/dev/null
grep -F 'Never submit truncated Chinese' "$SKILL" >/dev/null
grep -F 'If direct value assignment does not trigger results' "$SKILL" >/dev/null
grep -F 'If the required destination or conversation is already open' "$SKILL" >/dev/null
if [ -e "$OUTPUT/demo-composer-skill/agents/openai.yaml" ]; then
  echo "Portable skill unexpectedly contains Codex metadata" >&2
  exit 1
fi
if grep -F '/.codex/plugins/cache/' "$SKILL" >/dev/null; then
  echo "Generated skill contains a machine-specific plugin cache path" >&2
  exit 1
fi

node "$ROOT/scripts/generate-skill.mjs" \
  "$ROOT/tests/fixtures/reviewed-workflow.json" \
  "$OUTPUT" \
  demo-composer-codex \
  --target codex >/dev/null
[ -f "$OUTPUT/demo-composer-codex/agents/openai.yaml" ]

node "$ROOT/scripts/generate-skill.mjs" \
  "$ROOT/tests/fixtures/reviewed-workflow.json" \
  "$OUTPUT" \
  demo-composer-workbuddy \
  --target workbuddy >/dev/null
[ -f "$OUTPUT/demo-composer-workbuddy.zip" ]
/usr/bin/unzip -l "$OUTPUT/demo-composer-workbuddy.zip" | grep -F 'demo-composer-workbuddy/SKILL.md' >/dev/null

if [ -f "$SKILL_VALIDATOR" ]; then
  python3 "$SKILL_VALIDATOR" "$OUTPUT/demo-composer-skill"
  python3 "$SKILL_VALIDATOR" "$OUTPUT/demo-composer-codex"
fi
printf '%s\n' "Generated skill portability OK"
