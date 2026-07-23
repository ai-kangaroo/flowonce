#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
APP="$ROOT/bin/FlowOnce.app/Contents/MacOS/RecordAndReplayLocal"
SESSION=$(mktemp -d "${TMPDIR:-/tmp}/record-replay-lifecycle.XXXXXX")

RECORD_REPLAY_HEADLESS=1 "$APP" "$SESSION" 30 &
PID=$!
for _ in 1 2 3 4 5; do
  [ -f "$SESSION/heartbeat" ] && break
  sleep 1
done
[ -f "$SESSION/heartbeat" ]
touch "$SESSION/cancel"
wait "$PID"
[ -f "$SESSION/session.json" ]
[ ! -f "$SESSION/events.jsonl" ]
grep -F 'recording_controls_cancelled' "$SESSION/session.json" >/dev/null
printf '%s\n' "Cancel lifecycle OK"

STOP_SESSION=$(mktemp -d "${TMPDIR:-/tmp}/record-replay-stop.XXXXXX")
RECORD_REPLAY_HEADLESS=1 "$APP" "$STOP_SESSION" 30 &
STOP_PID=$!
for _ in 1 2 3 4 5; do
  [ -f "$STOP_SESSION/heartbeat" ] && break
  sleep 1
done
touch "$STOP_SESSION/stop"
wait "$STOP_PID"
[ -f "$STOP_SESSION/events.jsonl" ]
grep -F 'recording_controls_stopped' "$STOP_SESSION/session.json" >/dev/null
printf '%s\n' "Stop lifecycle OK"

TIMEOUT_SESSION=$(mktemp -d "${TMPDIR:-/tmp}/record-replay-timeout.XXXXXX")
RECORD_REPLAY_HEADLESS=1 "$APP" "$TIMEOUT_SESSION" 1
[ -f "$TIMEOUT_SESSION/events.jsonl" ]
grep -F 'max_duration_reached' "$TIMEOUT_SESSION/session.json" >/dev/null
printf '%s\n' "Timeout lifecycle OK"

PERMISSION_SESSION=$(mktemp -d "${TMPDIR:-/tmp}/record-replay-permission.XXXXXX")
RECORD_REPLAY_HEADLESS=1 RECORD_REPLAY_FORCE_ACCESSIBILITY_UNTRUSTED=1 "$APP" "$PERMISSION_SESSION" 30
[ -f "$PERMISSION_SESSION/session.json" ]
[ ! -f "$PERMISSION_SESSION/events.jsonl" ]
[ ! -f "$PERMISSION_SESSION/heartbeat" ]
grep -F 'accessibility_permission_required' "$PERMISSION_SESSION/session.json" >/dev/null
printf '%s\n' "Accessibility permission lifecycle OK"
