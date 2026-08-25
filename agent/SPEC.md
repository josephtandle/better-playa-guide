# Burning Man Events Agent — implementation spec

Node 20+, CommonJS (`require`). No network at query time. Zero personal data in this directory.

## Data already built (DO NOT regenerate, read as-is)

### `data/geo/brc-2026.json`
```
{ year, theme, source,
  man: {lat, lon},                       // 40.783247448, -119.207884096
  ft_per_deg_lat: 364000,
  ft_per_deg_lon: 275865.9…,             // precomputed at BRC latitude
  bearing_formula: "compass_bearing_deg = ((clock_hours - 10.5) * 30) mod 360",
  rings: [ {letter:"ESP", name:"Esplanade", radius_ft:2492.7}, {letter:"A", name:"Ararat", radius_ft:2926.0}, … "K"/"Kundalini" 5738.5 ],
  radial_range: {min_clock:"2:00", max_clock:"10:00", step_minutes:15},
  landmarks: { "The Man": {lat,lon}, "The Temple": {…}, "Center Camp": {…}, … 60 entries },
  plazas: [ {name:"3:00 & G Plaza", lat, lon}, … 12 ]
}
```
Bearing check (must hold): 10:30→0°(N), 12:00→45°(NE), 3:00→135°, 4:30→180°(S), 6:00→225°, 7:30→270°(W), 9:00→315°.

### `data/events-index.json` — array of 3413
```
{ id, title, type, camp, location, address|null, tags[], description,
  occurrences: [ {date:"2026-08-30", start:"2026-08-30T17:00", end:"2026-08-30T19:00", dur_min} ] }
```
Tag vocabulary: food, drink, party, music, adult, workshop, talk, wellness, art, ritual, service, kids, game, parade, other.

## Modules to implement

### `src/brc-geo.js`
- `parseAddress(str)` → `{clock_hours, street}` or null. Accept "7:30 & E", "7:30 and E", "7:30 & Eternal", "7:30&E", "Esplanade & 7:30" (either order), case-insensitive. Street may be letter A-K, ESP/Esplanade, or the 2026 full name (Ararat…Kundalini).
- `addressToLatLon(str)` → `{lat, lon}`. Polar from the Man: bearing from clock, radius from ring table. Convert ft→degrees using the two constants.
- `latLonToAddress(lat, lon)` → `{address, clock, street, radius_ft, confidence}`. Inverse. Snap clock to nearest 15 min, street to nearest ring. If radius < ESP−200ft → "Open Playa"; if > K+300ft → "Outer playa / walk-in".
- `distanceFt(a, b)` — accepts address string OR {lat,lon} for either arg.
- `walkMinutes(a, b)` — 3.0 ft/sec walking. Also export `bikeMinutes` at 8.0 ft/sec.
- `directionFrom(a, b)` → human string like "toward 7:30, 4 blocks out" plus compass ("NW").
- `landmark(name)` → {lat,lon} lookup, case-insensitive, from geo landmarks + plazas.
**Round-trip invariant:** `latLonToAddress(addressToLatLon(x)).address === x` for every valid address on the 15-min × 12-ring grid.

### `src/profile.js`
- `load(dir)` reads YAML files from an EXTERNAL profile dir (path comes from `data/config.json` → `profile_dir`, `~` expanded). Files: `joe.yaml`(generic name: the user profile), `music.yaml`, `alla.yaml`, `friends.yaml`, `must-do.yaml`, `favorites.yaml`, `sources.yaml`.
- Every file optional. Missing dir → safe empty defaults, never throw.
- Returns `{home, tagWeights, artists[], speakers[], partner:{tagWeights,artists}, friends[], mustDo[], favorites[], sources[]}`.
- `addFavorite(dir, eventId, note)` and `addFriend(dir, name, address)` append to the YAML (create file if absent). These WRITE to the profile dir only, never into this package.

### `src/recommend.js`
`recommend({at, from, windowMinutes, tags, limit, profile, events})` →
scored array of `{event, occurrence, score, walkMin, distanceFt, why[]}`.
Scoring (document weights as named constants at top of file):
- time fit: occurrence overlaps [at, at+window]; starting-soon beats already-running; ends-before-you-arrive = excluded.
- distance: from `walkMinutes`; unknown address → neutral penalty, never excluded.
- tag match against `profile.tagWeights` (and partner's, at a lower weight, when `includePartner`).
- artist/DJ name appearing in title/description → strong boost, push the matched name into `why`.
- friend's camp match → boost.
- `must-do` items overlapping the window are ALWAYS returned first with `pinned:true`, regardless of score.
`why[]` is short human strings, e.g. `["workshop (you rate 5)", "Bedouin plays here", "6 min walk"]`.

### `src/index.js` — CLI
`node src/index.js <cmd>`:
`where <address>` (resolve + landmarks near), `now [--from ADDR] [--in 3h] [--tag food]`,
`next <hours>`, `food`, `party`, `workshops`, `mustdo`, `fav add <id>`, `friend add <name> <addr>`,
`search <text>`, `event <id>`, `setup`, `status`.
Human-readable text output, phone-width (≤ 60 cols), no ANSI colour codes.

## Rules
- CommonJS. No TypeScript. No network calls. No new deps beyond package.json.
- Never read/write outside this package except the configured profile dir.
- No hardcoded person, camp, or place from the maintainer's life — this ships to strangers.
