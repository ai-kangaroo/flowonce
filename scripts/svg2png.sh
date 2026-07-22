#!/bin/bash
# SVG -> PNG (2x) via Chrome headless screenshot. No extra dependencies needed.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/../docs/images" && pwd)"
OUT_DIR="$SRC_DIR/png"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SCALE=2

mkdir -p "$OUT_DIR"
shopt -s nullglob
svgs=("$SRC_DIR"/*.svg)
if [ ${#svgs[@]} -eq 0 ]; then
  echo "No SVG files in $SRC_DIR" >&2
  exit 1
fi

for svg in "${svgs[@]}"; do
  name="$(basename "$svg" .svg)"
  png="$OUT_DIR/$name.png"
  # Read intrinsic size from the svg tag
  read -r W H < <(python3 - "$svg" <<'PY'
import re, sys
src = open(sys.argv[1], encoding="utf-8").read(2000)
w = re.search(r'width="(\d+)"', src)
h = re.search(r'height="(\d+)"', src)
print(int(w.group(1)) if w else 900, int(h.group(1)) if h else 480)
PY
)
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=$SCALE \
    --default-background-color=00000000 \
    --window-size=$((W * SCALE)),$((H * SCALE)) \
    --screenshot="$png" "file://$svg" >/dev/null 2>&1
  echo "OK  $name.svg -> png/$name.png (${W}x${H} @${SCALE}x)"
done
echo "Done. Output: $OUT_DIR"
