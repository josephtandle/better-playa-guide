# Data sources & annual crawl playbook

Everything here was verified working on 2026-08-25. Re-run this sequence each year, changing
`YEAR`. Timings matter: Burning Man forbids apps from publishing camp locations until **00:01 on
the first Sunday of build week**, so camp addresses do not exist publicly until roughly 7 days
before the event.

## Annual timeline (what is available when)

| When | What appears |
|---|---|
| ~April | Official BRC city plan + Golden Spike coordinates for the year |
| ~July | Official GIS street data (`innovate-GIS-data` repo gains a `YEAR/` folder) |
| Event minus ~7 days (first Sunday of build week) | Camp locations legal to publish -> PlayaMap API goes live for the year |
| ~Aug, rolling | Camp websites publish their own lineups. THIS is where named DJs/speakers come from |
| Gate-open day (±1) | Official `camp_names_YEAR.geojson`, `camp_outlines_YEAR.geojson`, `YEAR BRC Public Map.pdf` |
| Following spring | `archive/YEAR/camps.json` published with url/email/description for every camp |

## 1. Events (the WhatWhereWhen data)

- Day listings: `https://playaevents.burningman.org/YEAR/playa_events/NN/` where NN is `01`..`08`
  (one per event day; `09` returns HTTP 400 — there are only 8).
- Event detail: `https://playaevents.burningman.org/YEAR/playa_event/<id>/`
- Parse notes (these WILL bite again):
  - The end time is split into the NEXT array element by the HTML `<br/>` layout. Join the
    date/time lines with a space before regexing, or every event loses its end time.
  - Events cross midnight ("9 PM – 1 AM"). Roll the end date forward when end <= start.
  - Store times with an explicit **`-07:00`** offset (playa is PDT in Aug/Sep). Naive strings get
    parsed as machine-local time — that produced a 15-hour error when the host ran in Bali.
  - The label is `Dates and Times:` for recurring events but `Date and Time:` for single ones.
    Match both or single-occurrence events silently lose their times.
  - The site soft-404s: unknown paths return HTTP 200 with a landing page. Check for real content
    (`.whitepage`), never trust the status code.

## 2. Camp addresses

- **`https://playamap.org/api/camps/`** — the only 2026-current source before gate-open. JSON dict
  keyed by index -> `{n: name, a: address}`. ~1,187 camps. No auth, no key.
  A few addresses are malformed (`"10:10:00 & 00 B"`, `"CC@ 4:00"`, `"Epicenter"`) — handle or skip.
- Official (published later): `https://bm-innovate.s3.amazonaws.com/YEAR/camp_names_YEAR.geojson`
  and `camp_outlines_YEAR.geojson`. **Warning:** the 2025 versions are CAD text linework whose
  properties are only `{fid, Layer}` — no camp names. Do not plan on them for name lookup.

## 3. Camp contact details / socials  ← the lineup goldmine

- **`https://bm-innovate.s3.amazonaws.com/archive/YEAR/camps.json`** — official, no auth, ~1,385
  records. Fields: `uid,name,year,url,contact_email,hometown,description,landmark,location,
  location_string,images`. Available for 2015-2019, 2022-2025. Published the spring AFTER the event.
  Merge several years newest-first (older years fill gaps) — that took contact coverage from 71% to 82%.
  Note: the non-archive path `bm-innovate.s3.amazonaws.com/YEAR/camps.json` is 403; the `archive/`
  prefix is the working one.
- **`https://burningman.org/black-rock-city/black-rock-city-YEAR/YEAR-camps/`** — the official
  public camp directory page, live DURING the current year (~3.3MB, ~292 outbound camp links:
  websites, mailto:, Facebook). This is the only official CURRENT-year source of camp URLs.
- Then **crawl the camp websites yourself**: fetch each with curl, regex out
  instagram/facebook/soundcloud/youtube/linktree. No model needed. 300/328 sites fetched in a few
  minutes and added +96 Instagram, +120 Facebook handles.

## 4. Lineups (named DJs and speakers)

The official event listings almost NEVER name the performer — across 3,413 events in 2026, only 2
mentioned a recognizable figure. Real lineups live on camp-owned properties:

- **Palenque Norte** (Camp Soft Landing, 6:30 & F) — `https://palenquenorte.vercel.app/data.js`
  is the entire speaker roster + week schedule as a JS file. Pages are `speakers.html` /
  `schedule.html` (the extensionless paths 404) and render client-side, so scrape `data.js`, not
  the HTML. 29 speakers for 2026 incl. Rick Doblin.
- **Camp Mystic** (`campmystic.org`) — runs a formal "Visionary Speaker Series". Past: Rick Doblin,
  Paul Stamets, Dr. David Rock, Noah Feldman, Chris Wink, Robert Edward Grant.
- **PlayAlchemist / Alchemist Bazaar** (`playalchemist.com`, IG `@playalchemist`) — DJ sets are
  archived per-year on `soundcloud.com/playalchemist` with the artist in the track title. That
  SoundCloud archive is a reliable way to recover past lineups.
- Camps whose own sites carry lineup/schedule language are flagged in `data/camp-directory.json`
  under `publishes_lineup_signals` — that is the watchlist to re-crawl close to and during the event.

## 5. City geometry

- `https://github.com/burningmantech/innovate-GIS-data` -> `YEAR/GeoJSON/`:
  `street_lines, street_outlines, plazas, cpns, city_blocks, toilets, trash_fence, dmz, gate_road`.
  `cpns.geojson` holds every landmark (The Man, Temple, Center Camp, plazas, portals, Greeters...).
  `street_lines.geojson` has `{name, kind: annular|avenue|path, width_ft}` — derive ring radii and
  radial bearings from it instead of trusting prose measurements.
- `https://bm-innovate.s3.amazonaws.com/YEAR/YEAR BRC Measurements.pdf` — prose measurements.
  Useful as a CROSS-CHECK only. Deriving from GIS and comparing to the PDF's stated
  "Man to Center Camp = 3,026 ft" caught the geometry within 8 ft.
- Bearing formula (stable year to year): `compass_deg = ((clock_hours - 10.5) * 30) mod 360`,
  i.e. 10:30 is true north, 4:30 true south. Ring radii DO change year to year — always re-derive.

## Dead ends (do not retry)

- `api.burningman.org` — needs an API key; docs URL 404s.
- `playaevents.burningman.org/api/YEAR/camps/` — soft-404.
- S3 bucket listing (`?list-type=2&prefix=YEAR/`) — AccessDenied.
- `bm-innovate.s3.amazonaws.com/archive/<current year>/camps.json` — 403 until the following spring.

## Verified camp-published lineup sources (check these FIRST each year)

These camps publish real named lineups on their own sites. This is the answer to "who is actually
speaking/playing" — the official WhatWhereWhen will not tell you.

| Camp | Lineup URL | What | Notes |
|---|---|---|---|
| **Mystic** (2:00 & F) | `campmystic.org/events` | **Full public speaker grid, every year** | Best speaker source on playa. Archives at `/events-2025`, `/events-2024` … back to 2015. Themed days: psychedelics/neuroscience, love/relationships, future/tech. |
| **Palenque Norte** / Camp Soft Landing (6:30 & F) | `palenquenorte.vercel.app/data.js` | Full speaker roster + schedule | Scrape `data.js`, NOT the HTML (client-rendered). Paths need `.html`. "TED for psychedelics"; MAPS lineage. `palenquenorte.com` is DEAD (parked). |
| **Disorient** (Esplanade & 2:15) | `wiki.disorient.info` → Playa Schedule | Named DJ set-time grids **back to 2006** | Best public DJ lineup archive of any camp. |
| **Camp Contact** (3:45 & C) | `brc.campcontact.org/events` | Live workshop calendar | Best-run public schedule; pod leaders not celebrities. |
| **Camp Question Mark** | `campquestionmark.com` + IG `@campquestionmark` | Bass-music lineup, announced formally | Past: Skrillex+Diplo (Jack Ü), Flume, GRiZ, Glitch Mob. |
| **Opulent Temple** | `opulenttemple.org` + IG `@opulenttemple` | Publishes lineups in advance | Past: Tiësto, Carl Cox, Skrillex, Oakenfold. |
| **PlayAlchemist** / Alchemist Bazaar | IG `@playalchemist`, `soundcloud.com/playalchemist` | Defers lineup to Instagram | SoundCloud archives each year's sets WITH artist in the track title — good for recovering past lineups. |
| **Rock Star Librarian** | `rockstarlibrarian.com` | **Master sound-camp / art-car music guide** | Published the **Tuesday before gate**. Single highest-value DJ monitor target. |

Verified Instagram handles (traps noted — a wrong handle is worse than none):
`@pinkmammothsf`, `@bubbles.and.bass`, `@dis.ori.ent` (NOT @disorient — that's their X),
`@campquestionmark`, `@experience_incendia` (underscore; no-underscore is their Facebook),
`@opulenttemple`, `@playalchemist`, `@_mayanwarrior_`, `@robotheartfoundation`, `@DISTRIKT_org`,
`@spacecowboyssf`, `@campcontact`, `@bloom_camp_`, `@bureauoferoticdiscourse`, `@hivetemplecollective`,
`@milkandhoneycamp`, `@entheosrising`, `@abraxasdragon`, `@playajoy`, `@kostumekult`,
`@airpushercollective`, `@dustyrhinoartcar`, `@whiteocean_bm` (NOT @whiteoceancamp — 55-follower decoy).

Dead / defunct as of 2026: White Ocean (DNS dead, absent from directory), Root Society (dead since
~2019), Red Lightning, Anahasana Village (renamed **Naked Heart** 2024), Nectar Village, Tantra Mantra
(absorbed into Naked Heart), Zendo Project (not attending 2026), Fractal Planet (hiatus).
**Mayan Warrior has NO art car in 2026** — pausing; new camp "Discosmos" at 2:00 & J.

## Two more official sources found late

- `https://directory.burningman.org/camps/<id>/` and `/camps/browse/<LETTER>/` — the live Playa Info
  camp directory, per-camp pages. Good for checking whether a camp still exists.
- The official API `api.burningman.org` (key required, form at `/request`, spec at `/openapi.json`,
  auth header `X-API-Key`) exposes `CampModel` with `url`, `contact_email`, `accepting_campers`,
  `location` — richer than the public HTML page, which withholds emails. Worth getting a key before
  next year.

**Embargo dates (2026 actuals — shift by year):** camp location fields released to devs Aug 9 00:00
PDT, public to users **Aug 23 00:00 PDT**; art locations public **Aug 30**. BRC Camp Map PDF drops
Sunday Aug 30 00:00. Source: `innovate.burningman.org/apis-page/`.

## BEST current-year camp source (found last, use it FIRST next year)

**`https://raw.githubusercontent.com/jeremedia/ok-offline/main/public/data/YEAR/camps.json`**
A community mirror of the official `api.burningman.org` pull, so it is the official dataset without
needing a key. For 2026: 1,201 camps, **577 with `url`**, 631 emails, 499 `accepting_campers`, and
crucially a stable **`uid`** so you can join exactly instead of fuzzy-matching names. Siblings in the
same directory: `events.json` (2,205 events, each with `hosted_by_camp` uid), `art.json`,
`metadata.json`, `gis/`. It carries no locations (placement was embargoed at fetch time) — pair it
with PlayaMap for addresses.

Joining events to camps by `uid` beats name matching: it resolved 20 addresses that normalized-name
matching missed, taking event address coverage from 95.4% to **96.0%**.

Also useful: the official "camps seeking campers" sheet
`https://docs.google.com/spreadsheets/d/1pR6kqBTIYLal2GNN6mJ_ueGygaWLo6R2HB5wQhUlBDw/export?format=csv&gid=1307777311`
(header is on ROW 2, not row 1).

**Recommended order next year:** ok-offline mirror (or the real API with a key) → PlayaMap for
addresses → official `YEAR-camps` HTML page → crawl camp websites → prior-year archives to fill gaps.

## One more speaker series worth chasing

**EntheoGeneration Psychedelic Speaker Series** — ran Thu-Sat 6-7pm at 2:30 & Fugue in 2022 with
Rick Doblin, Carl Hart, Natalie Ginsberg, Paul Stamets, David Bronner, Jamie Wheal. It runs under a
host camp's listing rather than its own directory entry, so it does not show up in a camp search.
Source: `https://maps.org/2022/08/17/...`

## ⭐ The speaker-lookup that actually works

`https://playaevents.burningman.org/playa_event/search/all/?q=<Name+Here>`

Searches **every year** of the official event database and returns title, times, and **host camp**
per hit. This is the only public source that ties a named person to a camp, and it works for the
current year. Wrapped as `bin/speaker-search.sh "Rick Doblin" [YEAR]`.

**Trap:** the page footer reads "Printed for … on <today's date>". A naive grep for the current year
matches that footer on EVERY result and reports false positives. The wrapper truncates at
`Printed for` before parsing — keep that.

Use it two ways:
1. *Is X here this year?* — `bin/speaker-search.sh "Name" 2026`
2. *Which camps host X?* — omit the year; the camp column reveals their home. Doblin's 23 date
   blocks trace SHIFT → Entheon Village → Above The Limit → Fractal Nation → Camp Soft Landing →
   Camp Mystic. That history is the best predictor of where a given figure will turn up next year.

## The core lesson, proven

**Burning Man's official listings strip presenter names. The camps' own sites keep them.**
Concrete proof, same event, both sources:

| Source | What it says |
|---|---|
| Official 2026 listing (event 58698) | *"Psychedelic Healing & Transformation"* / desc: *"With MDMA"* — **no name** |
| `campmystic.org/events`, same slot | *"Psychedelic Healing & Transformation with MDMA"* · **Rick Doblin** |

Worse: **an entire speaker series can be invisible.** Palenque Norte's 31 sessions at Camp Soft
Landing appear NOWHERE in the official 2026 event data — 0 hits. Without pulling
`palenquenorte.vercel.app/data.js` the agent would never surface a single one.

So the pipeline must always be: official listings for coverage → **camp sites for names** → merge.
`data/events-index.json` records `presenter` and `presenter_source` for every enriched event, and
injected events carry `source: "camp_site_not_in_official_listings"` so their provenance stays honest.

Result for 2026: 67 events with a named presenter (36 merged onto official Mystic events, 31
injected from Palenque Norte).

## Crawl the SUBPAGES, not the homepage (learned the hard way, 2026-08-25)

Homepage-only crawling of 377 camp sites found **2** parseable schedules. Adding these subpaths
found **11**:

`/events` `/schedule` `/lineup` `/line-up` `/program` `/programme` `/calendar` `/workshops`
`/talks` `/activities` `/burning-man` `/burningman` `/whatwherewhen`

5,369 candidate URLs → 836 live pages → 11 camps with a real schedule (>=8 time strings across
>=3 weekdays). `/events` is by far the most common. Each camp's best hit is recorded in
`data/camp-directory.json` as `schedule_url` + `schedule_signal`.

Camps with a live schedule page in 2026: Mystic, AerialKnotics, Lotus Dome & Café, Fur,
Brain Freeze Camp, Flat Tire Cafe, Karma Love Camp, Atlantis, Shamandome, PLUR Pups,
BRC Municipal Pool. (Palenque Norte is separate — its schedule is a JS file, see above.)

### The Instagram wall — the real remaining gap
Most camps publish their schedule on Instagram, not their website. Two blockers:
1. **Login wall.** instagram.com returns HTTP 200 with empty content to curl/WebFetch for ANY
   handle, including deliberately fake ones — so a 200 proves nothing and handle "verification"
   by fetch is worthless. Needs a logged-in browser session (the `claude-in-chrome` tools drive
   the user's real Chrome).
2. **Schedules are IMAGES.** Even with access, the day grid is usually a graphic, so it needs OCR
   or a vision pass, not HTML parsing.
The directory holds 203 verified Instagram handles ready for whenever that lane opens.

## Instagram: the agent is broken, but vision works

`agents/instagram` (instagrapi, session `joe.che.official`) has read commands — `get-profile`
(bio + recent post captions), `read-comments`, `resolve-user`. **It does not currently work for
third-party profiles.** `get-profile campquestionmark` returns
`400 Bad Request ...$HOME/`, and a batch of four known-good handles
(joe.che.official, opulenttemple, playajoy, bureauoferoticdiscourse) all returned EMPTY — a silent
failure, not an error. Fix the agent before relying on it.

Note the ceiling even when it is fixed: `get-profile` returns **captions**, and camp schedules are
posted as **images**. Captions alone will not give you the grid.

**What actually worked: reading the screenshot.** Joe sent two IG screenshots and both parsed
cleanly by eye into structured events — a full week grid (Elementum, 20 offerings) and a party
flyer with a named lineup (The Gnomies / Mundara Takeover: Cristo, Mendeleyev, Sidestreets).

So the working Instagram pipeline is: **fetch the image → vision-read it → structure it**, not
caption scraping. Events sourced this way carry `source: instagram_screenshot` plus a `source_note`
recording where it came from and that it is absent from the official listings.

Also worth knowing: Elementum's address is written **"9:30 & Bodhi"** — camps use the *named*
street, not the letter. Bodhi = B. Always map theme names to letters (Ararat=A, Bodhi=B, Ceiba=C,
Delphi=D, Eternal=E, Fulcrum=F, Great Oak=G, Heiau=H, Iroko=I, Jiba=J, Kundalini=K).

## Instagram via the agent browser (the working lane)

`bin/ig-session.sh` — open / wait / status / grab, against the **agent lane on port 9223**
(MYOS-DISPATCH: 9223 = agent/Uni; 9224 is Joe's personal browser, never scrape from it).

Joe logs in by hand once. The session cookie then lives in the Chrome profile and survives
restarts — nothing is stored in this repo, and the script never types or reads credentials, it
only polls the tab URL to detect that login finished.

Two separate auth paths, easy to confuse:
- **Browser lane (9223)** — what `ig-session.sh` uses. Fixed by Joe logging in.
- **`agents/instagram`** (instagrapi, session file `data/sessions/joe.che.official.json`) — a
  DIFFERENT door. Currently failing silently (empty results for every handle, including Joe's own).
  Logging into the browser does NOT fix it.

Even with a live session, remember the ceiling: **schedules are posted as images.** Captions carry
"Pick your portal 👀", not the grid. The pipeline is always: fetch image → vision-read → structure.

## The WhatsApp discovery lane (this is where the real intel is)

Scanning Joe's Burning Man WhatsApp groups surfaced **56 unique links across 1,083 messages** —
tools and events that appear in NO official listing. Captured in `data/discovered-links.json`.

Highest value found 2026-08-25:
- **iBurn 2026** (iOS) — the offline BRC map/events app. Works with no signal.
- **Constellation at Axis Mundi** (iOS) — this year's theme app.
- **brcforecast.corbett.vc/outlook** — dust/weather outlook, built by Peter Corbett (PlayAlchemist).
- **WhatsApp weather bot** — text +1 332 320 4545 for dusty updates from the playa.
- **The 2026 Survival Guide PDF** — `survival.burningman.org/wp-content/uploads/2026/06/BMSG-2026-fin.pdf`
  (10.6MB, cached locally). This is the real downloadable guide.
- **burnermap.com** — find friends' camps.

Re-run the extraction with the SELECT-only query in `src/sources.js`; the link regex + curation
pass is the part worth repeating each year.

### Dead ends worth remembering
- **loveandbeats.xyz** (Robot Heart's "Love & Beats") is EMAIL-GATED. The lineup is behind a
  signup; the JS bundle carries no data (it fetches at runtime). Do not burn time on it.
- **CDP websocket to port 9223 rejects handshakes** (403 without a Host header, 500 with one).
  Use the Browser MCP tools for JS-rendered pages instead of hand-rolling CDP.
