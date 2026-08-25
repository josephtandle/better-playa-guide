#!/usr/bin/env bash
# Instagram via the MyOS AGENT browser lane (port 9223).
#
#   bin/ig-session.sh open        # open the IG login page in the agent lane and front Chrome
#   bin/ig-session.sh wait [min]  # poll until login completes (default 15 min)
#   bin/ig-session.sh status      # is there a live session?
#   bin/ig-session.sh grab <handle> [n]   # pull recent post image URLs + captions for a handle
#
# SECURITY: this only ever polls the tab URL and reads rendered page data. It never types,
# captures keystrokes, or touches credentials. Joe logs in by hand; the session cookie then
# persists in the Chrome profile, so this survives restarts without storing anything here.
#
# Lane rule (MYOS-DISPATCH): 9223 = agent/Uni. Do NOT use 9224 (Joe's personal) for scraping.
set -uo pipefail
PORT=9223
CMD="${1:-status}"

cdp_tabs(){ curl -sS --max-time 5 "http://127.0.0.1:$PORT/json/list" 2>/dev/null; }

case "$CMD" in
  open)
    curl -sS "http://127.0.0.1:$PORT/json/new?https://www.instagram.com/accounts/login/" >/dev/null 2>&1 \
      || curl -sS -X PUT "http://127.0.0.1:$PORT/json/new?https://www.instagram.com/accounts/login/" >/dev/null 2>&1
    osascript -e 'tell application "Google Chrome" to activate' 2>/dev/null
    echo "Instagram login opened in the agent lane ($PORT). Log in by hand — nothing here reads what you type."
    ;;
  wait)
    MINS="${2:-15}"
    echo "waiting up to ${MINS}m for login to complete (polling tab URL only)..."
    for ((i=0;i<MINS*12;i++)); do
      u=$(cdp_tabs | python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: raise SystemExit
for t in d:
    if t.get('type')=='page' and 'instagram.com' in (t.get('url') or ''):
        print(t['url']); break
" 2>/dev/null)
      if [ -n "$u" ] && [[ "$u" != *"/accounts/login"* ]]; then
        echo "login complete -> $u"; exit 0
      fi
      sleep 5
    done
    echo "timed out — still on the login page"; exit 1
    ;;
  status)
    cdp_tabs | python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: print('agent browser (9223) not reachable'); raise SystemExit
ig=[t for t in d if t.get('type')=='page' and 'instagram.com' in (t.get('url') or '')]
if not ig: print('no Instagram tab open. run: bin/ig-session.sh open'); raise SystemExit
for t in ig:
    u=t['url']
    print(('LOGGED OUT — on login page' if '/accounts/login' in u else 'SESSION LIVE'), '|', u[:70])
"
    ;;
  grab)
    H="${2:?usage: ig-session.sh grab <handle> [n]}"; N="${3:-12}"
    TARGET=$(cdp_tabs | python3 -c "
import sys,json
d=json.load(sys.stdin)
for t in d:
    if t.get('type')=='page' and 'instagram.com' in (t.get('url') or ''): print(t['webSocketDebuggerUrl']); break
" 2>/dev/null)
    [ -z "$TARGET" ] && { echo "no Instagram tab — run: bin/ig-session.sh open (then log in)"; exit 1; }
    echo "grab needs a CDP websocket client; use the browser MCP tools against port $PORT, handle=@$H, n=$N"
    echo "Then: save each schedule IMAGE and vision-read it — captions alone never contain the grid."
    ;;
  *) sed -n '2,14p' "$0"; exit 1;;
esac
