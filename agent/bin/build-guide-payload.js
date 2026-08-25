#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Locate repository root
const repoRoot = path.resolve(__dirname, '..');

// CLI options
let outPath = path.resolve(repoRoot, '../../projects/muse-cafe/website/guide/data.js');
const outArgIdx = process.argv.indexOf('--out');
if (outArgIdx !== -1 && process.argv[outArgIdx + 1]) {
  outPath = path.resolve(process.cwd(), process.argv[outArgIdx + 1]);
}

// Input data paths
const EVENTS_INDEX_PATH = path.join(repoRoot, 'data/events-index.json');
const RSL_PATH = path.join(repoRoot, 'data/rsl-sets-2026.json');
const PSL_PATH = path.join(repoRoot, 'data/psl-sets-2026.json');

// Reference data.js candidate locations
// NEVER include outPath here. Reading our own previous output back in makes the
// reference self-poisoning: one bad run corrupts every run after it.
const refCandidates = [
  path.resolve(repoRoot, '../../projects/muse-cafe/website/guide/data.js'),
  '$HOME/.myos/workspace/projects/muse-cafe/website/guide/data.js'
];

function loadReferenceData() {
  for (const candidate of refCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, 'utf8');
        const jsonStr = raw.replace(/^window\.__GUIDE__=/, '').replace(/;?\s*$/, '');
        const data = JSON.parse(jsonStr);
        if (data && data.map && data.picks && data.pinned && data.ev) {
          return data;
        }
      } catch (err) {
        // continue search
      }
    }
  }
  return null;
}

function normalizeCampName(name) {
  if (!name || typeof name !== 'string') return '';
  let s = name.toLowerCase().trim();
  s = s.replace(/[^\w\s]/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s !== 'center camp' && s.endsWith(' camp')) {
    s = s.slice(0, -5).trim();
  }
  return s;
}

function normalizeTitle(t) {
  if (!t || typeof t !== 'string') return '';
  return t.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeAddress(loc) {
  if (!loc || typeof loc !== 'string') return null;
  let s = loc.trim();
  if (!s) return null;

  s = s.replace(/\bEsplanade\b/gi, 'Esp');
  s = s.replace(/\bESP\b/g, 'Esp');
  s = s.replace(/\bPortal\b/gi, '').replace(/\s+/g, ' ').trim();

  let m = s.match(/^(\d{1,2}(?::\d{2})?)\s*&\s*([A-K]|Esp)\b/i);
  if (m) {
    let clock = m[1];
    if (!clock.includes(':')) clock = clock + ':00';
    let [h, min] = clock.split(':');
    h = parseInt(h, 10);
    let street = m[2].toUpperCase();
    if (street === 'ESP') street = 'Esp';
    if (h >= 1 && h <= 12) return `${h}:${min} & ${street}`;
  }

  m = s.match(/^([A-K]|Esp)\s*&\s*(\d{1,2}(?::\d{2})?)\b/i);
  if (m) {
    let street = m[1].toUpperCase();
    if (street === 'ESP') street = 'Esp';
    let clock = m[2];
    if (!clock.includes(':')) clock = clock + ':00';
    let [h, min] = clock.split(':');
    h = parseInt(h, 10);
    if (h >= 1 && h <= 12) return `${h}:${min} & ${street}`;
  }

  return s;
}

function formatSchedule(occurrences) {
  if (!occurrences || occurrences.length === 0) return [];
  return occurrences.map(occ => {
    let startStr = null;
    let endStr = null;
    if (occ.start) {
      const m = occ.start.match(/\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2})/);
      if (m) startStr = `${m[1]} ${m[2]}`;
    }
    if (occ.end) {
      const m = occ.end.match(/T(\d{2}:\d{2})/);
      if (m) endStr = m[1];
    }
    return [startStr, endStr];
  });
}

function getOfficialSrc(e) {
  if (e.source === 'camp_site_not_in_official_listings') return 1;
  if (e.source === 'instagram_screenshot') return 2;
  return 0;
}

function build() {
  if (!fs.existsSync(EVENTS_INDEX_PATH)) {
    console.error(`Error: Events index file missing at ${EVENTS_INDEX_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(RSL_PATH)) {
    console.error(`Error: RSL sets file missing at ${RSL_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(PSL_PATH)) {
    console.error(`Error: PSL sets file missing at ${PSL_PATH}`);
    process.exit(1);
  }

  const refData = loadReferenceData();
  if (!refData) {
    console.error('Error: Reference data.js file could not be loaded.');
    process.exit(1);
  }

  const eventsIdx = JSON.parse(fs.readFileSync(EVENTS_INDEX_PATH, 'utf8'));
  const rsl = JSON.parse(fs.readFileSync(RSL_PATH, 'utf8'));
  const psl = JSON.parse(fs.readFileSync(PSL_PATH, 'utf8'));

  const officialIn = eventsIdx.length;
  const rslIn = rsl.length;
  const pslIn = psl.length;

  const officialEvents = eventsIdx.map(e => ({
    t: e.title || '',
    c: e.camp || '',
    a: normalizeAddress(e.address),
    g: e.tags || [],
    p: e.presenter || '',
    d: e.description || '',
    s: formatSchedule(e.occurrences),
    src: getOfficialSrc(e),
    raw: e
  }));

  const rslEvents = rsl.map(e => ({
    t: e.title || '',
    c: e.camp || '',
    a: normalizeAddress(e.address),
    g: e.tags || [],
    p: e.presenter || '',
    d: e.description || '',
    s: formatSchedule(e.occurrences),
    src: 3,
    raw: e
  }));

  const pslEvents = psl.map(e => ({
    t: e.title || '',
    c: e.camp || '',
    a: normalizeAddress(e.address),
    g: e.tags || [],
    p: e.presenter || '',
    d: e.description || '',
    s: formatSchedule(e.occurrences),
    src: 4,
    raw: e
  }));

  // Index official events by normalized camp
  const officialByCamp = new Map();
  eventsIdx.forEach(e => {
    const norm = normalizeCampName(e.camp);
    if (norm) {
      if (!officialByCamp.has(norm)) officialByCamp.set(norm, []);
      officialByCamp.get(norm).push(e);
    }
  });

  // A music record that lines up with an official listing is an ENRICHMENT, not a
  // duplicate. The official listings carry no performer names, which is the whole
  // reason these sources exist, so we move the names onto the official record rather
  // than discarding the only copy of them.
  function findOfficialMatch(musicRec) {
    const normCamp = normalizeCampName(musicRec.c);
    if (!normCamp || !officialByCamp.has(normCamp)) return null;
    const offList = officialByCamp.get(normCamp);
    const mTitle = normalizeTitle(musicRec.t);

    for (const off of offList) {
      const oTitle = normalizeTitle(off.title);
      if (mTitle && oTitle && mTitle === oTitle) {
        for (const oo of (off.occurrences || [])) {
          if (!oo.start) continue;
          const oStart = new Date(oo.start).getTime();
          const oEnd = oo.end ? new Date(oo.end).getTime() : oStart + 3600000;
          const oDate = oo.date || oo.start.slice(0, 10);

          for (const ro of (musicRec.raw.occurrences || [])) {
            if (!ro.start) continue;
            const rStart = new Date(ro.start).getTime();
            const rEnd = ro.end ? new Date(ro.end).getTime() : rStart + 3600000;
            const rDate = ro.date || ro.start.slice(0, 10);

            if (oDate === rDate && oStart < rEnd && rStart < oEnd) return off;
          }
        }
      }
    }
    return null;
  }

  function splitNames(str) {
    if (!str) return [];
    return String(str).split(/,| b2b | \/\/ /).map(x => x.trim()).filter(Boolean);
  }

  const keptMusic = [];
  const mergedIntoOfficial = [];
  const droppedRecords = [];

  // officialEvents is the short-key list; index it by the raw record so a match on the
  // raw index can be written back to the record that actually ships.
  const officialByRaw = new Map();
  officialEvents.forEach(o => officialByRaw.set(o.raw, o));

  [...rslEvents, ...pslEvents].forEach(m => {
    const offRaw = findOfficialMatch(m);
    if (!offRaw) { keptMusic.push(m); return; }
    const target = officialByRaw.get(offRaw);
    if (!target) { keptMusic.push(m); return; }

    const names = [];
    splitNames(target.p).forEach(n => { if (names.indexOf(n) === -1) names.push(n); });
    splitNames(m.p).forEach(n => { if (names.indexOf(n) === -1) names.push(n); });
    target.p = names.join(', ');

    const tags = target.g.slice();
    (m.g || []).forEach(t => { if (tags.indexOf(t) === -1) tags.push(t); });
    if (tags.indexOf('lineup') === -1) tags.push('lineup');
    target.g = tags;

    mergedIntoOfficial.push(m);
  });

  // Nothing may leave without its performers landing somewhere.
  mergedIntoOfficial.forEach(m => {
    const offRaw = findOfficialMatch(m);
    const target = offRaw ? officialByRaw.get(offRaw) : null;
    const landed = target ? target.p : '';
    splitNames(m.p).forEach(n => { if (landed.indexOf(n) === -1) droppedRecords.push(m.c + ' | ' + m.t + ' | ' + n); });
  });
  if (droppedRecords.length) {
    console.error('Refusal: ' + droppedRecords.length + ' performer names would be lost:');
    droppedRecords.slice(0, 20).forEach(r => console.error('  ' + r));
    process.exit(1);
  }

  const mergedEvents = [...officialEvents, ...keptMusic].map(({ raw, ...clean }) => clean);

  const distinctPerformers = new Set();
  function addPerformers(str) {
    if (!str) return;
    str.split(',').map(s => s.trim()).filter(Boolean).forEach(p => distinctPerformers.add(p));
  }

  mergedEvents.forEach(e => {
    addPerformers(e.p);
  });

  const recordsWithPresenter = mergedEvents.filter(e => e.p && e.p.trim() !== '').length;
  const recordsWithAddress = mergedEvents.filter(e => e.a && e.a.trim() !== '').length;

  // Verification checks
  if (mergedEvents.length < 3465) {
    console.error(`Error: Merged event count ${mergedEvents.length} is below required minimum of 3465.`);
    process.exit(1);
  }

  if (distinctPerformers.size < 1000) {
    console.error(`Error: Distinct performer count ${distinctPerformers.size} is below required minimum of 1000.`);
    process.exit(1);
  }

  if (!mergedEvents.length || !refData.map || !refData.picks || !refData.pinned) {
    console.error('Error: Required top-level payload objects (ev.e, map, picks, pinned) must not be missing or empty.');
    process.exit(1);
  }

  // Joe's own curation copy must follow the no em dash rule. Event descriptions are
  // the camps' own words and are left exactly as written.
  function deDash(v) {
    if (typeof v === 'string') return v.replace(/\s*\u2014\s*/g, ': ');
    if (Array.isArray(v)) return v.map(deDash);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) o[k] = deDash(v[k]);
      return o;
    }
    return v;
  }

  const payload = {
    ev: {
      y: (refData.ev && refData.ev.y) || 2026,
      rings: (refData.ev && refData.ev.rings) || [],
      man: (refData.ev && refData.ev.man) || [],
      flat: (refData.ev && refData.ev.flat) || 364000.0,
      flon: (refData.ev && refData.ev.flon) || 275615.7313,
      e: mergedEvents
    },
    map: refData.map,
    picks: deDash(refData.picks),
    pinned: deDash(refData.pinned)
  };

  const outputString = `window.__GUIDE__=${JSON.stringify(payload)};\n`;

  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outPath, outputString, 'utf8');

  const outputBytes = Buffer.byteLength(outputString, 'utf8');

  console.log('Build Guide Payload Summary');
  console.log(`official in: ${officialIn}`);
  console.log(`rsl in: ${rslIn}`);
  console.log(`psl in: ${pslIn}`);
  console.log(`merged into official: ${mergedIntoOfficial.length}`);
  console.log(`dropped: ${droppedRecords.length}`);
  console.log(`total out: ${mergedEvents.length}`);
  console.log(`records with a presenter: ${recordsWithPresenter}`);
  console.log(`records with an address: ${recordsWithAddress}`);
  console.log(`distinct performers: ${distinctPerformers.size}`);
  console.log(`output bytes: ${outputBytes}`);
}

build();
