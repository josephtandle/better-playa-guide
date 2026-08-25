#!/usr/bin/env bash
# Re-fetch every public Burning Man data source for a given year.
# Usage:  bin/refresh-data.sh [YEAR]        (default: current year)
# Safe to re-run; skips files already downloaded. Read SOURCES.md for what publishes when.
set -uo pipefail
YEAR="${1:-$(date +%Y)}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW="$HERE/data/raw/$YEAR"
mkdir -p "$RAW" "$HERE/data/crawl"
UA="Mozilla/5.0 (compatible; BurnerEventsBot/1.0)"
get () { # url outfile
  [ -s "$2" ] && { echo "  skip $(basename "$2")"; return 0; }
  code=$(curl -sSL --max-time 60 -A "$UA" -o "$2" -w '%{http_code}' "$1" || echo 000)
  sz=$(wc -c < "$2" 2>/dev/null | tr -d ' ')
  echo "  [$code ${sz}b] $(basename "$2")"
  [ "$code" = 200 ] || rm -f "$2"
}

echo "== $YEAR : official listing pages (camps / art / mutant vehicles) =="
for p in camps art-listings mutant-vehicles; do
  get "https://burningman.org/black-rock-city/black-rock-city-$YEAR/$YEAR-$p/" "$RAW/official-$p.html"
done

echo "== $YEAR : camp addresses (PlayaMap - only source before gate-open) =="
get "https://playamap.org/api/camps/" "$RAW/playamap-camps.json"

echo "== $YEAR : city geometry (official GIS) =="
if [ ! -d "$RAW/gis" ]; then
  git clone --depth 1 -q https://github.com/burningmantech/innovate-GIS-data "$RAW/gis-repo" 2>/dev/null \
    && cp -r "$RAW/gis-repo/$YEAR/GeoJSON" "$RAW/gis" 2>/dev/null \
    && rm -rf "$RAW/gis-repo" && echo "  GIS ok" || echo "  GIS for $YEAR not published yet"
else echo "  skip gis"; fi
get "https://bm-innovate.s3.amazonaws.com/$YEAR/$YEAR%20BRC%20Measurements.pdf" "$RAW/measurements.pdf"

echo "== $YEAR : event listings (8 days) =="
for d in 01 02 03 04 05 06 07 08; do
  get "https://playaevents.burningman.org/$YEAR/playa_events/$d/" "$RAW/day-$d.html"
done

echo "== prior-year archives (url / email / description / past lineups) =="
# The archive is PRIOR-year: YEAR's own camps.json lands ~March of YEAR+1.
for y in $((YEAR-1)) $((YEAR-2)) $((YEAR-3)); do
  for kind in camps events art; do
    get "https://bm-innovate.s3.amazonaws.com/archive/$y/$kind.json" "$RAW/archive-$y-$kind.json"
  done
done

echo "== known camp-owned lineup sources =="
get "https://palenquenorte.vercel.app/data.js" "$RAW/palenque-norte-data.js"
get "https://wiki.disorient.info/index.php?title=Playa_Schedule" "$RAW/disorient-schedule.html"

cat <<EOF

Done. Raw files in: $RAW

Next steps (see SOURCES.md for parser gotchas):
  1. Rebuild the event index + tags from the day pages and detail pages.
  2. Rebuild geometry from data/raw/$YEAR/gis/street_lines.geojson + cpns.geojson.
  3. Rebuild the camp directory: PlayaMap addresses + official listing links + archive merge.
  4. Crawl camp websites:  xargs -P 12 -n1 bin/fetch-site.sh < <(camp url list)
  5. Re-check the lineup watchlist (data/lineup-watchlist.csv) close to and during the event.
EOF
