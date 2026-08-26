#!/usr/bin/env node
/* Export the public portable database (better-playa-guide/database/events.json)
 * from the compact web payload, so the public JSON can never drift from what
 * the app actually ships. Usage:
 *   node bin/export-public-database.js <out-path>
 */
'use strict';
const fs = require('fs');
const path = require('path');

const out = process.argv[2];
if (!out) { console.error('usage: export-public-database.js <out-path>'); process.exit(1); }

const dataPath = path.join(__dirname, '..', '..', '..', 'projects', 'muse-cafe', 'website', 'guide', 'data.js');
const src = fs.readFileSync(dataPath, 'utf8').trim();
const G = JSON.parse(src.slice(src.indexOf('=') + 1).trim().replace(/;+$/, ''));

const SRC_NAME = {
  0: 'official', 1: 'camp-site', 2: 'instagram', 3: 'rock-star-librarian',
  4: 'playa-set-library', 5: 'telegram', 6: 'camp-notice',
  7: 'community-calendar', 8: 'instagram-flyer-ocr'
};
const CONFIRMED = { 0: 1, 1: 1, 3: 1, 6: 1 };

const events = G.ev.e.map(e => ({
  title: e.t,
  camp: e.c,
  address: e.a || null,
  tags: e.g || [],
  fine_tags: e.f || [],
  presenter: e.p || null,
  description: e.d || null,
  schedule: (e.s || []).map(sl => ({ start: sl[0], end: sl[1] })),
  source: SRC_NAME.hasOwnProperty(e.src) ? SRC_NAME[e.src] : 'chat-reported',
  confidence: CONFIRMED[e.src] ? 'confirmed' : 'reported',
  aliases: e.k || null,
  grounded_score: (e.gr === undefined || e.gr === null) ? null : e.gr
}));

const doc = {
  meta: {
    year: 2026,
    event: 'Burning Man',
    theme: 'Axis Mundi',
    count: events.length,
    generated: 'see git history',
    license: 'MIT',
    note: 'Merged from official listings, Rock Star Librarian, Playa Set Library, camp sites and camp Instagram, Telegram and WhatsApp flyer harvests. Every event carries its source and confidence. Times are playa local, UTC-07:00.'
  },
  geometry: {
    man: G.ev.man,
    feet_per_degree_lat: G.ev.flat,
    feet_per_degree_lon: G.ev.flon,
    rings: G.ev.rings,
    streets: G.ev.streets || {}
  },
  events: events
};

fs.writeFileSync(out, JSON.stringify(doc, null, 1));
console.log('wrote', out, events.length, 'events,', fs.statSync(out).size, 'bytes');
