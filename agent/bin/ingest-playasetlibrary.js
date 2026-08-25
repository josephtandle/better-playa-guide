#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const RAW_PATH = path.join(__dirname, '../data/raw/2026/playasetlibrary/index.html');
const FALLBACK_RAW_PATH = '$HOME/.myos/workspace/agents/burning-man-events/data/raw/2026/playasetlibrary/index.html';
const CAMP_DIR_PATH = path.join(__dirname, '../data/camp-directory.json');
const MUSIC_CAMPS_PATH = path.join(__dirname, '../data/music-camps.json');
const OUTPUT_PATH = path.join(__dirname, '../data/psl-sets-2026.json');

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

function normalizeAddress(loc) {
  if (!loc || typeof loc !== 'string') return null;
  let s = loc.trim();
  if (!s) return null;

  s = s.replace(/\bEsplanade\b/gi, 'Esp');
  s = s.replace(/\bPortal\b/gi, '').replace(/\s+/g, ' ').trim();

  // Pattern 1: Clock & Street (e.g. 4:00 & F, 2 & C, 10 & Esp)
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

  // Pattern 2: Street & Clock (e.g. Esp & 4:15, B & 8:45)
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

  return null;
}

function parseTimeString(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const s = timeStr.trim().toLowerCase();
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = m[3];
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return { h, min: parseInt(min, 10), hStr: String(h).padStart(2, '0'), minStr: min };
}

function parseDateStr(dateStr) {
  if (!dateStr || dateStr === 'no session published yet') return null;
  const m = dateStr.match(/^(Aug|Sep)\s+(\d{1,2})$/i);
  if (!m) return null;
  const month = m[1].toLowerCase() === 'aug' ? '08' : '09';
  const day = m[2].padStart(2, '0');
  return `2026-${month}-${day}`;
}

function buildIsoTimestamp(baseDateStr, timeStr) {
  if (!baseDateStr) return null;
  const parsedTime = parseTimeString(timeStr);
  if (!parsedTime) return null;

  let [year, month, day] = baseDateStr.split('-').map(x => parseInt(x, 10));
  if (parsedTime.h < 12) {
    const d = new Date(Date.UTC(year, month - 1, day));
    d.setUTCDate(d.getUTCDate() + 1);
    year = d.getUTCFullYear();
    month = d.getUTCMonth() + 1;
    day = d.getUTCDate();
  }

  const yStr = String(year);
  const mStr = String(month).padStart(2, '0');
  const dStr = String(day).padStart(2, '0');
  return `${yStr}-${mStr}-${dStr}T${parsedTime.hStr}:${parsedTime.minStr}:00-07:00`;
}

function extractConst(str, varName) {
  const token = `const ${varName} = `;
  const idx = str.indexOf(token);
  if (idx === -1) return null;
  const start = idx + token.length;
  let end = str.indexOf(';\n', start);
  if (end === -1) end = str.indexOf(';\r\n', start);
  if (end === -1) end = str.indexOf(';', start);
  if (end === -1) return null;
  try {
    return JSON.parse(str.substring(start, end).trim());
  } catch (err) {
    return null;
  }
}

function ingest() {
  let sourcePath = RAW_PATH;
  if (!fs.existsSync(sourcePath)) {
    if (fs.existsSync(FALLBACK_RAW_PATH)) {
      sourcePath = FALLBACK_RAW_PATH;
    } else {
      console.error(`Error: Source file missing at ${RAW_PATH}`);
      process.exit(1);
    }
  }

  const html = fs.readFileSync(sourcePath, 'utf8');

  const schedule = extractConst(html, 'SCHEDULE');
  const setsData = extractConst(html, 'SETS');

  if (!schedule || !setsData) {
    console.error('Error: Could not extract SCHEDULE or SETS from HTML.');
    process.exit(1);
  }

  const campDirData = fs.existsSync(CAMP_DIR_PATH)
    ? JSON.parse(fs.readFileSync(CAMP_DIR_PATH, 'utf8'))
    : { camps: {} };

  const musicCampsData = fs.existsSync(MUSIC_CAMPS_PATH)
    ? JSON.parse(fs.readFileSync(MUSIC_CAMPS_PATH, 'utf8'))
    : [];

  const campsDir = campDirData.camps || {};
  const exactMap = new Map();
  const normMap = new Map();

  Object.values(campsDir).forEach(c => {
    if (c.name) {
      exactMap.set(c.name.toLowerCase().trim(), c);
      const n = normalizeCampName(c.name);
      if (n && !normMap.has(n)) normMap.set(n, c);
    }
  });

  const musicMap = new Map();
  const mcList = Array.isArray(musicCampsData) ? musicCampsData : Object.values(musicCampsData);
  mcList.forEach(c => {
    if (c.name) {
      musicMap.set(c.name.toLowerCase().trim(), c);
      const n = normalizeCampName(c.name);
      if (n && !musicMap.has(n)) musicMap.set(n, c);
    }
  });

  let totalSetsExtracted = 0;
  let setsWithTimesCount = 0;
  let setsRunningOrderOnlyCount = 0;
  let campMatchedCount = 0;
  let minDate = '9999-99-99';
  let maxDate = '0000-00-00';
  let recordIdSeq = 1;

  const outputRecords = [];

  schedule.camps.forEach(c => {
    let matchedCamp = null;
    let matchConfidence = 'high';

    if (c.name.toLowerCase() === 'hotd' || c.name.toLowerCase().includes('hair of the dog')) {
      for (const cd of Object.values(campsDir)) {
        if (cd.name && cd.name.toLowerCase().includes('hair of the dog')) {
          matchedCamp = cd;
          break;
        }
      }
    } else if (c.name.toLowerCase() === 'favela') {
      for (const cd of Object.values(campsDir)) {
        if (cd.name && cd.name.toLowerCase().includes('favela culture')) {
          matchedCamp = cd;
          matchConfidence = 'medium';
          break;
        }
      }
    }

    if (!matchedCamp) {
      const cName = c.name.trim().toLowerCase();
      if (exactMap.has(cName)) {
        matchedCamp = exactMap.get(cName);
      } else {
        const n = normalizeCampName(c.name);
        if (n && normMap.has(n)) matchedCamp = normMap.get(n);
      }
    }

    if (!matchedCamp) {
      const cName = c.name.trim().toLowerCase();
      if (musicMap.has(cName)) {
        matchedCamp = musicMap.get(cName);
      } else {
        const n = normalizeCampName(c.name);
        if (n && musicMap.has(n)) matchedCamp = musicMap.get(n);
      }
    }

    if (matchedCamp && matchedCamp.uid) campMatchedCount++;

    let normAddr = normalizeAddress(c.loc);
    let addrSource = 'psl';
    if (!normAddr && matchedCamp && matchedCamp.address_2026) {
      normAddr = normalizeAddress(matchedCamp.address_2026);
      if (normAddr) addrSource = 'camp-directory';
    }
    if (!normAddr) {
      addrSource = 'psl-unlocated';
    }

    let venueHasClockTimes = false;
    (c.nights || []).forEach(n => {
      (n.sets || []).forEach(s => {
        if (s.t) venueHasClockTimes = true;
      });
    });

    (c.nights || []).forEach(n => {
      const isSentinelNight = n.date === 'no session published yet';
      const baseDate = parseDateStr(n.date);
      if (baseDate) {
        if (baseDate < minDate) minDate = baseDate;
        if (baseDate > maxDate) maxDate = baseDate;
      }

      const performerList = [];
      const occurrences = [];

      (n.sets || []).forEach(s => {
        totalSetsExtracted++;
        const isSentinelSet = isSentinelNight || !baseDate;

        const setPerformers = [];
        if (s.a) {
          const rawList = Array.isArray(s.a) ? s.a : [s.a];
          rawList.forEach(w => {
            if (w) {
              const name = String(w).trim();
              if (name) {
                setPerformers.push(name);
                if (!performerList.includes(name)) performerList.push(name);
              }
            }
          });
        }

        let startIso = buildIsoTimestamp(baseDate, s.t);
        let endIso = buildIsoTimestamp(baseDate, s.end);

        let durMin = null;
        if (startIso && endIso) {
          durMin = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
        }

        const occDate = startIso ? startIso.slice(0, 10) : baseDate;

        const occ = {
          date: occDate,
          start: startIso,
          end: endIso,
          dur_min: durMin,
          who: setPerformers.length === 1 ? setPerformers[0] : setPerformers
        };

        if (isSentinelSet) {
          setsRunningOrderOnlyCount++;
          occ.tags = ['running-order-only'];
        } else if (startIso) {
          setsWithTimesCount++;
        } else {
          setsRunningOrderOnlyCount++;
        }

        occurrences.push(occ);
      });

      const presenter = performerList.length > 0 ? performerList.join(', ') : null;
      const title = (n.theme && n.theme.trim()) || presenter || c.name;

      const tags = ['music'];
      if (isSentinelNight) {
        tags.push('running-order-only');
      }

      const rec = {
        id: `psl-${recordIdSeq++}`,
        title,
        type: 'Music/Party',
        camp: c.name,
        location: c.loc,
        address: normAddr,
        address_source: addrSource,
        tags,
        description: (n.theme && n.theme.trim()) || '',
        occurrences,
        camp_matched: matchedCamp ? matchedCamp.name : null,
        camp_uid: (matchedCamp && matchedCamp.uid) ? matchedCamp.uid : null,
        presenter,
        source: 'playa-set-library',
        source_url: 'https://playasetlibrary.com/',
        source_credit: 'Playa Set Library, hand-maintained by its author from Instagram flyers'
      };

      if (c.id === 'favela') {
        rec.camp_match_confidence = 'medium';
      }

      if (c.orderOnly || !venueHasClockTimes) {
        rec.presentation = 'running-order';
      }

      outputRecords.push(rec);
    });
  });

  if (totalSetsExtracted < 150) {
    console.error(`Error: Ingest failed. Extracted only ${totalSetsExtracted} sets (minimum required: 150). Output file not written.`);
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(outputRecords, null, 2), 'utf8');

  const matchPercentage = ((campMatchedCount / schedule.camps.length) * 100).toFixed(2);
  console.log('Playa Set Library 2026 Ingest Summary');
  console.log(`Venues: ${schedule.camps.length}`);
  console.log(`Sets extracted: ${totalSetsExtracted}`);
  console.log(`Sets with times: ${setsWithTimesCount}`);
  console.log(`Sets running-order-only: ${setsRunningOrderOnlyCount}`);
  console.log(`Camp match rate: ${campMatchedCount}/${schedule.camps.length} (${matchPercentage}%)`);
  console.log(`Date range: ${minDate} to ${maxDate}`);
}

ingest();
