# Better Playa Guide - Handoff

A single-page Burning Man 2026 event finder. Works offline (no signal on playa), talks
to an LLM when online, given away as a playa gift. Live: https://playaguide.musecafe.vip
(also guide.musecafe.vip and musecafe.vip/guide/). Open source:
https://github.com/josephtandle/better-playa-guide

## Where things are
- This repo (`projects/muse-cafe/website/`): the shipped site.
  - `guide/` - the app: index.html, guide.js (all client logic), guide.css, map.html,
    map.js, how-it-was-made.html (the About page), sw.js (service worker), data.js
    (the generated payload, 3943 events, ~1.6MB), manifest.webmanifest, icons.
  - `api/` - Vercel serverless: ask.js (the chat endpoint), _guide.js (retrieval
    pipeline), _prompt.js (LLM prompt), _store.js (rate limit + cache), list-sync.js
    (email device-migration).
  - `test/` - run-all.js runs client.test.js (290 assertions, jsdom), api-contract.test.js
    (52), _retrieval.test.js (33). `npm test` runs all.
  - `scripts/deploy.sh` - THE ONLY WAY TO SHIP. Runs the test gate, refuses to deploy
    on red, auto-bumps the sw cache version, then `vercel --prod`.
- `agents/burning-man-events/` (a SEPARATE repo): the data pipeline.
  - `bin/build-guide-payload.js` - builds `guide/data.js` by merging official listings +
    Rock Star Librarian + Playa Set Library + Instagram OCR + enrichment. This is how you
    regenerate the data. Run it, copy its output to `guide/data.js`, deploy.
  - `data/` - source layers, ingest scripts, `SOURCES.md` (the annual crawl playbook).

## How it works (the one rule that shapes everything)
There is NO server holding user data and NO account. On playa there is no signal, so:
- All 3943 events are embedded in data.js. Search/filter/nav/stars all run client-side.
- Stars, profile, location live in localStorage (keys: bpg.stars, bpg.profile,
  bpg.location, bpg.seen.intro). Persist per-device. Share-link (#l=hashes) and email
  (api/list-sync) move them between devices. Calendar .ics export is the permanent copy.
- The ask box: online it POSTs to /api/ask (retrieval in _guide.js picks candidates,
  then an LLM writes prose); offline or on failure it falls back to the local answer()
  in guide.js. Same input, degrades gracefully, tells the user which answered.

## LLM + cost
Provider fallback chain in api/ask.js: Groq gpt-oss-120b -> Gemini 2.5 Flash Lite ->
DeepSeek -> offline. Keys in Vercel env (GROQ_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY).
Guards: zero-token scope-lock refuses off-topic questions BEFORE any model call; 24h
cache; per-IP + per-email rate limits; hard $25/day spend cap then falls back to offline.
~$0.61 per 1000 questions measured. Groq paid tier upgrade is currently unavailable, so
free tier caps site-wide throughput; the fallback chain covers overflow.

## Data provenance and the trust model
Every event has a `src` int mapped to a tier (confirmed/reported/unverified) shown as a
badge. src table lives in BOTH guide/guide.js and api/_guide.js AND
bin/build-guide-payload.js - keep all three in sync, and NEVER let an unknown src default
to confirmed (that shipped hearsay as official once). About-page claims must match the
badges users can see.

## Hard rules learned the hard way (do not relearn these)
- NO EM DASHES anywhere in generated or UI text. House rule.
- Vercel cleanUrls is ON: pages serve at /guide with NO trailing slash, so RELATIVE asset
  paths 404. Use root-absolute paths (/guide/guide.css). The service worker is scoped
  /guide/ - the bare /guide is outside scope, so /guide/ is canonical (a redirect sends
  /guide there).
- Service worker is offline-first: a returning visitor sees the OLD build first, then the
  new sw installs in the background. There is an "Updated, tap to refresh" toast for this.
  Always bump the cache name on any change (deploy.sh does it).
- BRC addresses display as the LETTER, never the street name: "8:15 & E" not
  "8:15 & Eternal". Accept the long names as input, echo the letter. Joe's camp: Muse
  Cafe, 8:15 & E.
- Recurring events: one payload record with many slots. Render ONCE per day, never one
  card per slot (that once produced 113 rows). Same for My Events, .ics, email payload.
- Retrieval: strip question words before matching (stopwords), or "should" matches the
  camp "Maybe You Should Talk To Someone". Day + time-of-day are HARD filters. See the
  design comment atop retrieve() in api/_guide.js.

## Deploy discipline (the mistake that cost time)
- ONLY deploy via ./scripts/deploy.sh. It gates on the test suite.
- Vercel ships the WORKING TREE, not just committed files. Never deploy with an
  unfinished feature dirty in the tree.
- VERIFY AGAINST PRODUCTION, not against a green apply. A patch that reports "applied"
  can silently fail (atomic reject on one bad hunk). curl the live files / drive a real
  browser after every deploy. A commit message must describe what actually landed - do
  not assume a patch applied.

## What is NOT done / known nits
- Groq paid tier upgrade pending (Groq-side, not code).
- The Helix & Casey wedding in Joe's private must-do list has an unconfirmed day.
- Map: minor landmark labels appear at >=2x zoom; the MAJOR regex substring-matches
  "Artica Center Camp".
- Instagram harvest: ~164 camps not yet scraped (rate-limited across runs); resume with
  `bin/harvest-camp-ig.py --limit 40` in the burning-man-events repo, spaced out.
- One pre-existing pending client test (a fuzzy-match lane).

## First moves for a new owner
1. `cd projects/muse-cafe/website && npm test` - see it green (290 + 52 + 33).
2. Read the design comment at the top of `retrieve()` in api/_guide.js.
3. Make a change, `./scripts/deploy.sh`, then curl production to confirm.
4. To change DATA not code: edit the ingest in agents/burning-man-events, rerun
   bin/build-guide-payload.js, copy to guide/data.js, deploy.
