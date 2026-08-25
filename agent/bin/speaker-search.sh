#!/usr/bin/env bash
# Search Burning Man's OFFICIAL all-years event database for a person's name.
# The only public source naming presenters AND host camps across every year.
# Usage: bin/speaker-search.sh "Rick Doblin" [YEAR]
q=$(printf '%s' "$1" | sed 's/ /+/g'); YEAR="${2:-}"
curl -sSL --max-time 30 "https://playaevents.burningman.org/playa_event/search/all/?q=$q" \
| YEAR="$YEAR" NAME="$1" python3 -c "
import sys,os,re
from bs4 import BeautifulSoup
s=BeautifulSoup(sys.stdin.read(),'html.parser')
w=s.select_one('.whitepage') or s.body
rows=[r.strip() for r in w.get_text('\n',strip=True).split('\n') if r.strip()]
# drop headers and the 'Printed for ... on <today>' footer (it contains the current year!)
cut=len(rows)
for i,r in enumerate(rows):
    if r.startswith('Printed for') or 'playaevents.burningman.org' in r: cut=min(cut,i)
rows=[r for r in rows[:cut] if r not in ('Title','Start','End','Location')]
DAY=re.compile(r'^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day')
blocks=[]; cur=None
for r in rows:
    if DAY.match(r):
        if cur: blocks.append(cur)
        cur={'date':r,'rows':[]}
    elif cur: cur['rows'].append(r)
if cur: blocks.append(cur)
yr=os.environ.get('YEAR')
if yr: blocks=[b for b in blocks if yr in b['date']]
name=os.environ.get('NAME')
if not blocks: print(f'{name}: no events found' + (f' in {yr}' if yr else ' in any year')); sys.exit(0)
print(f'{name}: {len(blocks)} date block(s)' + (f' in {yr}' if yr else ''))
for b in blocks:
    print('  '+b['date'])
    r=b['rows']
    for i in range(0,len(r),4):
        chunk=r[i:i+4]
        title=chunk[0] if chunk else ''
        times=' '.join(chunk[1:3]) if len(chunk)>2 else ''
        camp=chunk[3] if len(chunk)>3 else ''
        print(f'    {title[:52]:54s} {times:16s} {camp}')
"
