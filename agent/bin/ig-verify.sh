#!/usr/bin/env bash
# Verify an Instagram handle WITHOUT logging in.
# Instagram serves a login wall to normal fetches (any handle returns 200 + empty), but it still
# renders og: meta for Googlebot. A real handle returns a display name + follower counts; an
# invented one returns nothing. This is the only reliable no-auth verification we have.
# Usage: bin/ig-verify.sh <handle> [handle...]
UA="Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
for h in "$@"; do
  h="${h#@}"
  printf '%-30s ' "@$h"
  curl -sSL --max-time 15 -A "$UA" "https://www.instagram.com/$h/" 2>/dev/null | python3 -c "
import sys,re,html
s=sys.stdin.read()
t=re.search(r'<meta property=\"og:title\" content=\"([^\"]*)\"',s)
d=re.search(r'<meta property=\"og:description\" content=\"([^\"]*)\"',s)
if not (t or d): print('NOT FOUND — fake, deleted, or blocked'); raise SystemExit
name=html.unescape(t.group(1)).split('(')[0].strip() if t else '?'
desc=html.unescape(d.group(1)) if d else ''
m=re.match(r'([\d.,KM]+) Followers, ([\d.,KM]+) Following, ([\d.,KM]+) Posts', desc)
if m: print(f'{name:34s} {m.group(1):>8s} followers  {m.group(3):>6s} posts')
else: print(f'{name:34s} {desc[:50]}')
"
  sleep 2
done
