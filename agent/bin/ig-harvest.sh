#!/usr/bin/env bash
# Pull recent posts (captions + IMAGE URLs) for every verified camp handle, and download any
# image whose caption looks schedule/lineup-shaped so it can be vision-read.
# Usage: bin/ig-harvest.sh [targets_file] [posts_per_handle]
# Rate-limited on purpose: instagrapi has human_pause built in, and the account matters.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IG="$HOME/.myos/workspace/agents/instagram"
TARGETS="${1:-/tmp/ig-targets.txt}"
N="${2:-8}"
OUT="$HERE/data/ig"; mkdir -p "$OUT/profiles" "$OUT/images"
while IFS='|' read -r name handle; do
  [ -z "${handle:-}" ] && continue
  f="$OUT/profiles/$handle.json"
  if [ -s "$f" ]; then echo "  skip @$handle (cached)"; continue; fi
  timeout 240 "$IG/.venv/bin/python" "$IG/src/main.py" get-profile "$handle" --posts "$N" > "$f" 2>/dev/null
  if [ -s "$f" ] && ! grep -q '"error"' "$f"; then
    echo "  ok   @$handle"
  else
    echo "  FAIL @$handle"; rm -f "$f"
  fi
  sleep 4
done < "$TARGETS"
echo "profiles: $(ls "$OUT/profiles" 2>/dev/null | wc -l | tr -d ' ')"
