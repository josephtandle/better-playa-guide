#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const RSL_PATH = path.join(__dirname, '../data/raw/2026/rsl/rsl-dev-2026.json');
const REVISION_PATH = path.join(__dirname, '../data/raw/2026/rsl/revision.json');
const DUST_CAMPS_PATH = path.join(__dirname, '../data/raw/2026/rsl/dust-camps-2026.json');
const CAMP_DIR_PATH = path.join(__dirname, '../data/camp-directory.json');
const OUTPUT_PATH = path.join(__dirname, '../data/rsl-sets-2026.json');

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

  // Pattern 1: Clock & Street (e.g. 4:00 & F, 2 & C, 3:00 & A)
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

  // Pattern 2: Street & Clock (e.g. Esp & 4:15, B & 8:45, E & 7:15)
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

function ingest() {
  if (!fs.existsSync(RSL_PATH)) {
    console.error(`Error: Source file missing at ${RSL_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(REVISION_PATH)) {
    console.error(`Error: Revision file missing at ${REVISION_PATH}`);
    process.exit(1);
  }

  const rsl = JSON.parse(fs.readFileSync(RSL_PATH, 'utf8'));
  const revisionData = JSON.parse(fs.readFileSync(REVISION_PATH, 'utf8'));
  const dustCampsData = fs.existsSync(DUST_CAMPS_PATH)
    ? JSON.parse(fs.readFileSync(DUST_CAMPS_PATH, 'utf8'))
    : [];
  const campDirData = fs.existsSync(CAMP_DIR_PATH)
    ? JSON.parse(fs.readFileSync(CAMP_DIR_PATH, 'utf8'))
    : { camps: {} };

  const totalEvents = Array.isArray(rsl) ? rsl.length : 0;
  let totalSets = 0;
  if (Array.isArray(rsl)) {
    rsl.forEach(e => {
      totalSets += (e.occurrences ? e.occurrences.length : 0);
    });
  }

  // Requirement 7: Fail loudly if thresholds are not met
  if (totalEvents < 300 || totalSets < 1200) {
    console.error(`Error: Ingest failed. Thresholds not met. Source has ${totalEvents} events and ${totalSets} sets (minimum required: 300 events, 1200 sets). Output file not written.`);
    process.exit(1);
  }

  // Index Dust camps by uid/id
  const dustMap = new Map();
  const dcList = Array.isArray(dustCampsData) ? dustCampsData : Object.values(dustCampsData);
  dcList.forEach(c => {
    if (c.uid) dustMap.set(c.uid, c);
    if (c.id) dustMap.set(c.id, c);
  });

  // Index camp-directory.json
  const campDirCamps = campDirData.camps || {};
  const uidToCampDir = new Map();
  const exactNameToCampDir = new Map();
  const normNameToCampDir = new Map();

  Object.values(campDirCamps).forEach(c => {
    if (c.uid) uidToCampDir.set(c.uid, c);
    if (c.name) {
      exactNameToCampDir.set(c.name.toLowerCase().trim(), c);
      const n = normalizeCampName(c.name);
      if (n && !normNameToCampDir.has(n)) {
        normNameToCampDir.set(n, c);
      }
    }
  });

  let addressedCount = 0;
  let unlocatedCount = 0;
  let campMatchedCount = 0;
  const allPerformers = new Set();
  let minDate = '9999-99-99';
  let maxDate = '0000-00-00';

  const outputRecords = rsl.map(e => {
    // 1. Camp join
    let matchedCamp = null;
    if (e.campId && uidToCampDir.has(e.campId)) {
      matchedCamp = uidToCampDir.get(e.campId);
    }
    if (!matchedCamp && e.camp) {
      const cName = e.camp.trim().toLowerCase();
      if (exactNameToCampDir.has(cName)) {
        matchedCamp = exactNameToCampDir.get(cName);
      } else {
        const n = normalizeCampName(e.camp);
        if (n && normNameToCampDir.has(n)) {
          matchedCamp = normNameToCampDir.get(n);
        }
      }
    }
    if (!matchedCamp && e.campId && dustMap.has(e.campId)) {
      const dc = dustMap.get(e.campId);
      if (dc.uid && uidToCampDir.has(dc.uid)) {
        matchedCamp = uidToCampDir.get(dc.uid);
      } else if (dc.name) {
        const dcName = dc.name.trim().toLowerCase();
        if (exactNameToCampDir.has(dcName)) {
          matchedCamp = exactNameToCampDir.get(dcName);
        } else {
          const n = normalizeCampName(dc.name);
          if (n && normNameToCampDir.has(n)) {
            matchedCamp = normNameToCampDir.get(n);
          }
        }
      }
    }

    if (matchedCamp) campMatchedCount++;

    // 2. Address normalisation
    const normAddr = normalizeAddress(e.location);
    if (normAddr) addressedCount++;
    else unlocatedCount++;

    // 3. Occurrences & Presenter
    const performerSet = new Set();
    const performerList = [];
    const occurrences = (e.occurrences || []).map(occ => {
      if (occ.who !== undefined && occ.who !== null) {
        const list = Array.isArray(occ.who) ? occ.who : [occ.who];
        list.forEach(w => {
          if (w !== undefined && w !== null) {
            const name = String(w).trim();
            if (name) {
              allPerformers.add(name);
              if (!performerSet.has(name)) {
                performerSet.add(name);
                performerList.push(name);
              }
            }
          }
        });
      }

      const start = occ.startTime || null;
      const end = occ.endTime || null;
      const date = start ? start.slice(0, 10) : (e.day || null);

      if (date) {
        if (date < minDate) minDate = date;
        if (date > maxDate) maxDate = date;
      }

      let dur_min = null;
      if (start && end) {
        const sDate = new Date(start);
        const eDate = new Date(end);
        dur_min = Math.round((eDate - sDate) / 60000);
      }

      return {
        date,
        start,
        end,
        dur_min,
        who: occ.who
      };
    });

    const presenter = performerList.length > 0 ? performerList.join(', ') : null;

    // 4. Tags
    const tags = ['music'];
    if (e.rr) tags.push('rsl-recommended');
    if (e.lm) tags.push('live-music');
    if (e.wa) tags.push('accessible');

    return {
      id: e.id,
      title: (e.title && e.title.trim()) || presenter || e.camp || '',
      type: 'Music/Party',
      camp: e.camp || '',
      location: e.location || '',
      address: normAddr,
      address_source: normAddr ? 'rsl' : 'rsl-unlocated',
      tags,
      description: e.description ? e.description.trim() : '',
      occurrences,
      camp_matched: matchedCamp ? matchedCamp.name : null,
      camp_uid: (matchedCamp && matchedCamp.uid) ? matchedCamp.uid : null,
      presenter,
      source: 'rock-star-librarian',
      source_url: 'https://api.dust.events/static/ttitd-2026/rsl-dev.json',
      source_revision: revisionData.revision,
      source_credit: 'Rock Star Librarian Music Guide by Kate Houston, data via Dust by Damian Tarnawsky'
    };
  });

  // Write output JSON
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(outputRecords, null, 2), 'utf8');

  // Requirement 8: Print summary to stdout
  const matchPercentage = ((campMatchedCount / totalEvents) * 100).toFixed(2);
  console.log('RSL 2026 Ingest Summary');
  console.log(`Events in: ${totalEvents}`);
  console.log(`Sets out: ${totalSets}`);
  console.log(`Addressed: ${addressedCount}`);
  console.log(`Unlocated: ${unlocatedCount}`);
  console.log(`Camp match rate: ${campMatchedCount}/${totalEvents} (${matchPercentage}%)`);
  console.log(`Distinct performers: ${allPerformers.size}`);
  console.log(`Date range: ${minDate} to ${maxDate}`);
}

ingest();
