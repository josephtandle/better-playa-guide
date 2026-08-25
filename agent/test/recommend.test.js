const path = require('path');
const fs = require('fs');
const os = require('os');
const profile = require('../src/profile');
const recommend = require('../src/recommend');
const eventsIndex = require('../data/events-index.json');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

// 1. profile.load on a NON-EXISTENT dir returns defaults and does not throw.
const nonExistentDir = path.join(os.tmpdir(), 'bme-test-non-existent-' + Date.now());
let defaultProf;
try {
  defaultProf = profile.load(nonExistentDir);
} catch (err) {
  assert(false, `profile.load on non-existent dir threw error: ${err.message}`);
}
assert(defaultProf !== null && typeof defaultProf === 'object', 'profile.load returns an object');
assert(defaultProf.home && typeof defaultProf.home === 'object', 'profile.load returns default home object');
assert(Array.isArray(defaultProf.artists), 'profile.load returns default artists array');
assert(Array.isArray(defaultProf.mustDo), 'profile.load returns default mustDo array');
console.log('PASS 1: profile.load on NON-EXISTENT dir returns defaults and does not throw');

// 2. profile.load on the real configured dir loads: home.address is truthy, tag_weights non-empty.
const realProf = profile.load();
assert(realProf !== null, 'real profile loaded');
assert(Boolean(realProf.home && realProf.home.address), `real profile home.address is truthy (got ${realProf.home ? realProf.home.address : 'null'})`);
const tagW = realProf.tagWeights || realProf.tag_weights;
assert(tagW && Object.keys(tagW).length > 0, 'real profile tag_weights is non-empty');
console.log(`PASS 2: profile.load on real dir loaded (home.address="${realProf.home.address}", ${Object.keys(tagW).length} tag_weights)`);

// 3. recommend from "8:15 & E" at 2026-09-02T18:00 with a 180-min window returns >0 results,
//    every result's occurrence overlaps the window, and results are sorted by score descending.
const testAt = new Date('2026-09-02T18:00:00-07:00');
const testWindow = 180;
const testEnd = testAt.getTime() + testWindow * 60 * 1000;

const recs = recommend.recommend({
  at: testAt,
  from: '8:15 & E',
  windowMinutes: testWindow,
  limit: 20,
  profile: realProf,
  events: eventsIndex
});

assert(recs.length > 0, `recommend returned >0 results (got ${recs.length})`);

for (let i = 0; i < recs.length; i++) {
  const r = recs[i];
  const oStart = new Date(r.occurrence.start).getTime();
  const oEnd = new Date(r.occurrence.end).getTime();
  const overlaps = (oStart < testEnd && oEnd > testAt.getTime());
  assert(overlaps, `Result ${i} (${r.event.title}) occurrence does not overlap window`);

  if (i > 0 && !recs[i - 1].pinned && !r.pinned) {
    assert(recs[i - 1].score >= r.score, `Results not sorted by score descending: index ${i - 1} score ${recs[i - 1].score} < index ${i} score ${r.score}`);
  }
}
console.log(`PASS 3: recommend from "8:15 & E" returned ${recs.length} valid, sorted, overlapping recommendations`);

// 4. Every returned walkMin is either a finite number or null (never NaN).
for (let i = 0; i < recs.length; i++) {
  const wm = recs[i].walkMin;
  const isOk = wm === null || (typeof wm === 'number' && Number.isFinite(wm) && !Number.isNaN(wm));
  assert(isOk, `Result ${i} walkMin is invalid: ${wm}`);
}
console.log('PASS 4: Every returned walkMin is either a finite number or null (never NaN)');

// 5. A must-do item injected into the profile for that exact window comes back FIRST with pinned:true.
const customProf = Object.assign({}, realProf, {
  mustDo: [
    {
      what: 'Injected Must-Do Ritual',
      date: '2026-09-02',
      start: '2026-09-02T18:30:00-07:00',
      end: '2026-09-02T19:30:00-07:00',
      address: '8:15 & E',
      note: 'Critical test item'
    }
  ]
});

const pinnedRecs = recommend.recommend({
  at: testAt,
  from: '8:15 & E',
  windowMinutes: testWindow,
  limit: 10,
  profile: customProf,
  events: eventsIndex
});

assert(pinnedRecs.length > 0, 'pinnedRecs returned >0 results');
assert(pinnedRecs[0].pinned === true, `First result expected pinned:true, got ${pinnedRecs[0].pinned}`);
assert(pinnedRecs[0].event.title === 'Injected Must-Do Ritual', `First result expected title "Injected Must-Do Ritual", got "${pinnedRecs[0].event.title}"`);
console.log('PASS 5: Injected must-do item comes back FIRST with pinned:true');

// 6. avoid_tags containing a tag excludes every event carrying it.
const avoidTagProf = Object.assign({}, realProf, {
  avoidTags: ['music', 'party']
});

const avoidRecs = recommend.recommend({
  at: testAt,
  from: '8:15 & E',
  windowMinutes: testWindow,
  limit: 50,
  profile: avoidTagProf,
  events: eventsIndex
});

for (const r of avoidRecs) {
  if (r.pinned) continue;
  const tags = (r.event.tags || []).map(t => t.toLowerCase());
  assert(!tags.includes('music'), `Event ${r.event.title} contains avoided tag 'music'`);
  assert(!tags.includes('party'), `Event ${r.event.title} contains avoided tag 'party'`);
}
console.log(`PASS 6: avoid_tags ['music', 'party'] excluded all matching events across ${avoidRecs.length} results`);

// 7. Filtering --tag food returns only events whose tags include food.
const foodRecs = recommend.recommend({
  at: testAt,
  from: '8:15 & E',
  windowMinutes: testWindow,
  tags: 'food',
  limit: 20,
  profile: realProf,
  events: eventsIndex
});

assert(foodRecs.length > 0, 'foodRecs returned >0 results');
for (const r of foodRecs) {
  if (r.pinned) continue;
  const tags = (r.event.tags || []).map(t => t.toLowerCase());
  assert(tags.includes('food'), `Event ${r.event.title} does not contain tag 'food' (tags: ${tags.join(', ')})`);
}
console.log(`PASS 7: Filtering --tag food returned ${foodRecs.length} events, all carrying 'food' tag`);
