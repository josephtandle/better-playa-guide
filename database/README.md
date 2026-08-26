# The Database

`events.json` is the whole thing: every Burning Man 2026 event we compiled, as plain
JSON any language can read. MIT licensed. Take it, build on it, improve it.

## What is in it
3,943 events. It starts from the official Who What Where listings and merges in what
camps actually published: DJ and speaker lineups from the Rock Star Librarian guide,
the Playa Set Library, camp websites, and camp Instagram (some read by OCR from
schedule images). The official listings strip performer names; this puts them back.

## Shape
```json
{
  "meta":     { "year": 2026, "theme": "Axis Mundi", "count": 3943, "license": "MIT" },
  "geometry": { "man": [lat,lon], "rings": [["ESP",2492.7],["A",2926.0], ...],
                "streets": {"E":"Eternal", ...}, "feet_per_degree_lat": ... },
  "events":   [ Event, ... ]
}
```

### Event
| field           | meaning |
|-----------------|---------|
| `title`         | event name |
| `camp`          | hosting camp |
| `address`       | BRC clock-and-street, e.g. "8:15 & E", or null if unplaced |
| `tags`          | coarse categories (music, food, workshop, ...) |
| `fine_tags`     | specific topics (psychedelic, breathwork, techno, kink, grief, ...) |
| `presenter`     | performers / speakers, comma-joined, or null |
| `description`   | blurb |
| `schedule`      | array of {start, end}; start is "MM-DD HH:MM" or "MM-DD" (day only, no set time) or null |
| `source`        | where it came from: official, camp-site, instagram, rock-star-librarian, playa-set-library, telegram, camp-notice, community-calendar, instagram-flyer-ocr |
| `confidence`    | confirmed (the source that runs the event published it) or reported (someone saw it and passed it on) |
| `aliases`       | other names the camp is known by, space-joined |
| `grounded_score`| 0 to 5, how evidence-based a talk is (5 = rigorous, 0 = unfalsifiable). null for non-talks |

### Geometry
BRC is a polar grid. `man` is the centre. `rings` give each street's radius in feet.
Address bearing: `compass_degrees = ((clock_hours - 10.5) * 30) mod 360` (10:30 is true
north). With the ring radius and this bearing you can place any address and compute
distances. That is exactly how the guide sorts events by how far away they are.

## Provenance is the point
Every event says where it came from and how sure we are. An official listing and a
photo of a flyer are both here, labelled differently. Trust accordingly.

## Rebuild it yourself
The source layers and the merge script are in `../agent/`. See `../agent/SOURCES.md`
for the annual crawl playbook. `bin/build-guide-payload.js` merges the layers into the
payload the web app ships.
