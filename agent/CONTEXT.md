# Burning Man Events Agent — Context

Offline recommendation engine and location intelligence agent for Burning Man 2026 ("Axis Mundi"). Zero network calls required at runtime.

## Domain

On-playa event scheduling, polar coordinate geolocation, personalized recommendations, camp navigation, friend location tracking, and message discovery source scanning for Burning Man attendees.

## Data Provided

The agent package ships fully loaded with prebuilt 2026 playa datasets:
- **Events:** 3,413 indexed events yielding 6,566 occurrence slots across all 8 event days (Sunday Aug 30 - Sunday Sep 6, 2026).
- **Camps:** 1,187 registered theme camps with names and locations.
- **Geometry:** BRC 2026 street grid geometry (`data/geo/brc-2026.json`), theme "Axis Mundi", Man coordinates `(40.783247448, -119.207884096)`, radial streets 2:00 through 10:00, and 12 concentric ring avenues (Esplanade through K / Kundalini).
- **Timezone Safety:** All event occurrence timestamps are stored with an explicit `-07:00` playa offset (America/Los_Angeles) making them completely timezone-independent.
- **Coverage:** Street address coverage across all indexed events is 95.4%.

## Module Map

- **`src/brc-geo.js`** — Polar coordinate geometry for Black Rock City. Converts between clock/street addresses (e.g. `7:30 & E`) and latitude/longitude, calculates distance (feet), walking minutes (3.0 ft/sec), and biking minutes (8.0 ft/sec).
- **`src/profile.js`** — Loads personalized user YAML profiles (`me.yaml`, `music.yaml`, `partner.yaml`, `friends.yaml`, `must-do.yaml`, `favorites.yaml`, `sources.yaml`). Resolves relative paths against package root and expands `~`. Contains backward-compatible fallback for legacy profile filenames (`joe.yaml`, `alla.yaml`).
- **`src/recommend.js`** — Recommendation scoring engine based on time window fit, walking distance penalty, tag/genre preference weights, artist/DJ matching, friend camp proximity, and pinned must-do items.
- **`src/sources.js`** — Message scanner that parses SQLite databases (e.g., WhatsApp message DBs) to extract event tips, addresses, and camp mentions.
- **`src/index.js`** — Main CLI entry point. Formats output for mobile screens (≤ 60 columns) with zero ANSI color code dependencies.
- **`src/bot.js`** — Telegram bot gateway mapping `/now`, `/next`, `/where`, `/food`, `/party`, `/workshops`, `/mustdo`, `/help` commands to the recommendation and geo engines.

## CLI Commands

| Command | Usage | Description |
|---|---|---|
| `now` | `node src/index.js now [--from ADDR] [--in 3h] [--tag TAG] [--with-partner]` | Show top recommendations starting or running right now. |
| `next` | `node src/index.js next [hours]` | Recommend events happening in the next N hours (default 3h). |
| `food` | `node src/index.js food` | Filter recommendations for food-related events. |
| `party` | `node src/index.js party` | Filter recommendations for party and music events. |
| `workshops` | `node src/index.js workshops` | Filter recommendations for workshops and talks. |
| `where` | `node src/index.js where <address>` | Resolve address coordinates, normalized format, and distance to Man/Center Camp. |
| `mustdo` | `node src/index.js mustdo` | List pinned must-do schedule items. |
| `fav` | `node src/index.js fav [add <id>]` | List saved favorite events or add a new favorite by ID. |
| `friend` | `node src/index.js friend [add <name> <addr>]` | List friend camp locations or add a new friend. |
| `search` | `node src/index.js search <text>` | Free-text search across titles, descriptions, camps, and tags. |
| `event` | `node src/index.js event <id>` | Inspect full event details and occurrence schedule. |
| `setup` | `node src/index.js setup` | Display current profile directory location and setup instructions. |
| `status` | `node src/index.js status` | Display package index status, profile summary, and loaded counts. |

## External Profile Directory

Personal preferences and schedule state are decoupled from the code package:
- Configured via `"profile_dir"` in `data/config.json` (defaults to `"./profile"`).
- `resolveDir()` expands leading `~` to the home directory and resolves relative paths (like `./profile`) against the package root so the CLI functions consistently regardless of the working directory.
- `me.yaml` holds user home camp, address, tag/genre weights, avoid tags, and walk preferences.
- `partner.yaml` holds optional partner preference weights (enabled via `--with-partner`).
- `friends.yaml` holds friend camp addresses for proximity boosts.
- `must-do.yaml` contains pinned events that bypass standard scoring and appear first.
- `sources.yaml` configures message channels to scan for discovery.

## Discovery Source System

`src/sources.js` scans external SQLite message databases (e.g. WhatsApp export databases) configured in `sources.yaml`. It extracts candidate addresses (`7:30 & E`), camp names, and event titles from recent messages to surface real-time playa tips. Database paths resolve in order:
1. `dbPath` on the individual source entry in `sources.yaml`
2. `process.env.BME_WHATSAPP_DB`
3. `config.whatsapp_db` in `data/config.json`

If no database path is configured or available, source scanning returns `{ ok: false, reason: 'no_whatsapp_db' }` safely without throwing.

## Verification Commands

To verify agent integrity and test suites:
```bash
node agents/burning-man-events/test/geo.test.js
node agents/burning-man-events/test/recommend.test.js
node agents/burning-man-events/test/sources.test.js
node agents/burning-man-events/src/index.js status
node agents/burning-man-events/src/index.js now --from "8:15 & E"
```
