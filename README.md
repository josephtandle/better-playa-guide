# Better Playa Guide

Every Burning Man 2026 event, searchable by where you are standing. Works with no
signal. A playa gift from Joe Che at Muse Cafe.

**Live: https://musecafe.vip/guide/**

Save it to your phone before you leave. There is no signal out there.

## What this is

The official Who What Where is chaos. It is overwhelming, it goes out of date, it does
not know your taste, and it does not keep up with the lineups camps actually publish on
Instagram and their own websites.

This guide carries:

- **3,998 events**, against 3,467 in the official listings
- **1,477 named performers**. The official listings name almost none of them
- **3,714 events** resolved to a real BRC address
- Distances computed from the official 2026 city geometry
- The whole thing in one page, so it works with no signal

One concrete example. The official listing for Camp Mystic's psychedelic session says
only "Psychedelic Healing & Transformation / With MDMA". The camp's own site names the
speaker: Rick Doblin, who founded MAPS. Same slot. One source names him, the other does
not.

This is a quick experimental MVP built in a few days. Times change on playa. Treat the
running orders as running orders, not timetables.

## Two levels of personalisation

**The web page** stores your camp and how you get around (walk, bike, ebike) in your own
browser. Nothing is sent anywhere, there is no account and no server. It reorders
everything by how far away it actually is at your speed.

**Your own AI** is where it gets interesting. Point your assistant or second brain at
`agent/` and it reads the same data with everything it already knows about you: the
artists in your Spotify library, the talks you saved, what you said you are looking for
this year. Then "I am at 7:30 and F, what should I do in the next two hours" is answered
against your actual taste.

```bash
node agent/src/index.js now --from "7:30 & F"
node agent/src/index.js search "Doblin"
node agent/bin/refresh-data.sh 2027
```

Your profile lives OUTSIDE this repo, so the repo stays shareable. See `agent/SPEC.md`.

## Ingested from

This is other people's work, gathered and cross referenced. Credit where it is due:

| Source | What it gave |
|---|---|
| Burning Man official 2026 listings and camp data | the base 3,467 events |
| [Burning Man official GIS](https://github.com/burningmantech/innovate-GIS-data) | the city geometry every distance is computed from |
| [PlayaMap](https://playamap.org) | current 2026 camp addresses |
| [Rock Star Librarian Music Guide 2026](http://rslmusicguide.com/), by Kate Houston | 400 events and 1,604 DJ sets with real set times |
| [Dust](https://dust.events), by Damian Tarnawsky, and Avi Flombaum | the pipeline that makes the RSL data machine readable |
| [Playa Set Library](https://playasetlibrary.com/) | 9 venues and 236 sets, hand transcribed from Instagram flyers |
| Individual camp websites | speaker names, which the official listings strip |
| Camp Instagram accounts | most schedules, posted as images |

Kate Houston asks only that people print copies and gift them on playa, and supports a
GoFundMe for clean water wells in Ghana. Worth a look.

If you maintain one of these and want something changed or removed, open an issue and
it will be done.

## Privacy

The camp data upstream contains personal contact addresses. Every email address in this
repo is redacted to `redacted@example.invalid` by `agent/bin/make-public-release.js`,
which refuses to complete if a single address survives. Do not re-add them.

## Contributing

Open an issue. Most useful: a camp's Instagram handle, a camp's official schedule, a
wrong time or address, or a screenshot of a lineup.

See https://musecafe.vip/guide/contribute

## Licence

MIT. Data belongs to the sources credited above.

Reach Joe at [@joe.che.official](https://instagram.com/joe.che.official).


## The whole database

Every event as clean JSON: [`database/events.json`](database/events.json) (3,998 events, MIT). Schema and how to rebuild it from source: [`database/README.md`](database/README.md).
