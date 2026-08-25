#!/usr/bin/env bash
# Fetch one camp website into data/crawl/<key>.html.  Arg format: "key|url"
line="$1"; k="${line%%|*}"; u="${line#*|}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$HERE/data/crawl/${k}.html"
[ -s "$out" ] && exit 0
[[ "$u" == http* ]] || u="http://$u"
curl -sSL --max-time 20 --max-filesize 3000000 \
  -A "Mozilla/5.0 (compatible; BurnerEventsBot/1.0)" -o "$out" "$u" 2>/dev/null
[ -s "$out" ] || rm -f "$out"
exit 0
