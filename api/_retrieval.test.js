'use strict';
const assert = require('assert');
const G = require('./_guide.js');

const at = (mo, d, hh) => Date.UTC(2026, mo - 1, d, hh, 0) + 7 * 3600e3;
const dayOf = x => x.slot && x.slot[0] ? x.slot[0].slice(0, 5) : null;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('PASS:', name);
    passed++;
  } catch (err) {
    console.error('FAIL:', name);
    console.error(err.stack || err);
    failed++;
    process.exitCode = 1;
  }
}

// 1. Is there pizza served on Wednesday?
test('1. Is there pizza served on Wednesday?', () => {
  const r = G.retrieve('Is there pizza served on Wednesday?', { nowMs: at(8, 31, 12) });
  assert.strictEqual(r.parsed.intent, 'existence');
  assert.deepStrictEqual(r.parsed.matchTerms, ['pizza']);
  assert(r.candidates.length > 0);
  assert(r.candidates.every(x => dayOf(x) === '09-02'));
  const titles = r.candidates.map(x => x.e.t);
  assert(titles.includes('Lobster Pizza'));
  assert(titles.includes('Pizza Party and Elixir Bar'));
  assert(!titles.includes('Midnight Tacos'));
  assert(!titles.includes('The Brothel'));
  assert(!titles.includes('Late-Night DanDan Noodles'));
  assert(!titles.includes('Bottomless Breakfast'));
  assert.strictEqual(r.parsed.relaxed.length, 0);
});

// 2. pizza wednesday
test('2. pizza wednesday', () => {
  const r = G.retrieve('pizza wednesday', { nowMs: at(8, 31, 12) });
  assert(r.candidates.length > 0);
  assert(r.candidates.every(x => dayOf(x) === '09-02'));
  const titles = r.candidates.map(x => x.e.t);
  assert(titles.includes('Lobster Pizza'));
  assert(!titles.includes('Midnight Tacos'));
});

// 3. Is there lobster pizza on Thursday?
test('3. Is there lobster pizza on Thursday?', () => {
  const r = G.retrieve('Is there lobster pizza on Thursday?', { nowMs: at(8, 31, 12) });
  assert.strictEqual(r.parsed.intent, 'existence');
  assert(r.candidates.length > 0);
  const titles = r.candidates.map(x => x.e.t);
  assert(titles.includes('Lobster Pizza'));
  assert(r.parsed.relaxed.includes('day_adjacent') || r.parsed.relaxed.includes('day_any'));
});

// 4. what should I do Wednesday afternoon
test('4. what should I do Wednesday afternoon', () => {
  const r = G.retrieve('what should I do Wednesday afternoon', { nowMs: at(8, 31, 12) });
  assert.strictEqual(r.parsed.intent, 'open_rec');
  assert(r.candidates.length >= 8);
  assert(r.candidates.every(x => dayOf(x) === '09-02'));
  const windowStart = Date.UTC(2026, 8, 2, 12, 0);
  const windowEnd = Date.UTC(2026, 8, 2, 18, 0);
  for (const c of r.candidates) {
    const st = G.slotTimes(c.slot);
    if (st) {
      assert(st.start < windowEnd && st.end > windowStart);
    }
  }
  const camps = {};
  for (const c of r.candidates) {
    const camp = c.e.c || 'unknown';
    camps[camp] = (camps[camp] || 0) + 1;
    assert(camps[camp] <= 2);
  }
});

// 5. what should I do tonight
test('5. what should I do tonight', () => {
  const r = G.retrieve('what should I do tonight', { nowMs: at(9, 2, 20) });
  assert.strictEqual(r.parsed.intent, 'open_rec');
  assert(r.candidates.length > 0);
  assert(r.candidates.every(x => dayOf(x) === '09-02'));
});

// 6. coffee tomorrow morning
test('6. coffee tomorrow morning', () => {
  const r = G.retrieve('coffee tomorrow morning', { nowMs: at(9, 1, 10) });
  assert.strictEqual(r.parsed.targetDay, '09-02');
  assert(r.candidates.length > 0);
  const windowStart = Date.UTC(2026, 8, 2, 6, 0);
  const windowEnd = Date.UTC(2026, 8, 2, 12, 0);
  const fv = G.loadGuide().ev.fv;
  for (const c of r.candidates) {
    assert(dayOf(c) === '09-02');
    const hasCoffeeText = /coffee/i.test(c.e.t + ' ' + c.e.c + ' ' + (c.e.k || '') + ' ' + c.e.d);
    const hasCoffeeTag = c.e.f && c.e.f.some(idx => fv[idx] && fv[idx].includes('coffee'));
    assert(hasCoffeeText || hasCoffeeTag);
    const st = G.slotTimes(c.slot);
    if (st) {
      assert(st.start < windowEnd && st.end > windowStart);
    }
  }
});

// 7. coffee near me
test('7. coffee near me', () => {
  const r = G.retrieve('coffee near me', { loc: '7:30 & E', nowMs: at(9, 2, 9) });
  assert(r.candidates.length > 0);
  assert(r.candidates.some(x => x.mins !== null));
  const fv = G.loadGuide().ev.fv;
  for (const c of r.candidates) {
    const hasCoffeeText = /coffee/i.test(c.e.t + ' ' + c.e.c + ' ' + (c.e.k || '') + ' ' + c.e.d);
    const hasCoffeeTag = c.e.f && c.e.f.some(idx => fv[idx] && fv[idx].includes('coffee'));
    assert(hasCoffeeText || hasCoffeeTag);
  }
});

// 8. music tonight
test('8. music tonight', () => {
  const r = G.retrieve('music tonight', { nowMs: at(9, 2, 19) });
  assert(r.candidates.length > 0);
  const windowStart = Date.UTC(2026, 8, 2, 18, 0);
  const windowEnd = Date.UTC(2026, 8, 3, 3, 0);
  for (const c of r.candidates) {
    const st = G.slotTimes(c.slot);
    if (st) {
      assert(st.start < windowEnd && st.end > windowStart);
    }
    const hasMusicG = c.e.g && (c.e.g.includes('music') || c.e.g.includes('party'));
    const hasMusicText = /music|dj/i.test(c.e.t + ' ' + c.e.p);
    assert(hasMusicG || hasMusicText);
  }
});

// 9. Where is Jan Blomqvist playing?
test('9. Where is Jan Blomqvist playing?', () => {
  const r = G.retrieve('Where is Jan Blomqvist playing?');
  assert.strictEqual(r.parsed.intent, 'person');
  assert(r.candidates.length >= 2); /* data grows: at least his known sets */
  for (const c of r.candidates) {
    assert(/jan blomqvist/i.test(c.e.p));
  }
});

// 10. who is playing at Kaif
test('10. who is playing at Kaif', () => {
  const r = G.retrieve('who is playing at Kaif');
  assert(r.candidates.length >= 1);
  for (const c of r.candidates) {
    assert(/kaif/i.test(c.e.c || '') || /kaif/i.test(c.e.k || ''));
  }
});

// 11. who is playing at Robot Heart
test('11. who is playing at Robot Heart', () => {
  const r = G.retrieve('who is playing at Robot Heart');
  assert(r.candidates.length >= 1);
  for (const c of r.candidates) {
    assert(/robot heart/i.test(c.e.c || ''));
  }
});

// 12. sauna
test('12. sauna', () => {
  const r = G.retrieve('sauna');
  assert(r.candidates.length >= 8);
  for (const c of r.candidates) {
    assert(/sauna|banya|steam/i.test(c.e.t + ' ' + c.e.d));
  }
  assert.strictEqual(r.parsed.relaxed.length, 0);
});

// 13. Orgy Dome
test('13. Orgy Dome', () => {
  const r = G.retrieve('Orgy Dome');
  assert(r.candidates.length > 0);
  const top10 = r.candidates.slice(0, 10);
  const matchCount = top10.filter(c => /orgy/i.test(c.e.t + ' ' + c.e.c + ' ' + (c.e.k || '') + ' ' + c.e.d)).length;
  assert(matchCount >= top10.length / 2);
});

// 14. Where is Opulent Temple
test('14. Where is Opulent Temple', () => {
  const r = G.retrieve('Where is Opulent Temple');
  assert(r.candidates.length > 0);
  for (const c of r.candidates) {
    assert(/opulent/i.test(c.e.c || '') || /opulent/i.test(c.e.k || ''));
  }
});

// 15. When is Shalman's set times?
// 2026-08-26 re-harvest: Shalman's own flyer (WhatsApp) added Bisous Wed, Gaian
// Airship Fri night, and Alchemist Bazaar Sun morning to his existing 3 sets.
test("15. When is Shalman's set times?", () => {
  const r = G.retrieve("When is Shalman's set times?");
  assert.strictEqual(r.parsed.intent, 'person');
  assert.strictEqual(r.candidates.length, 6);
  const days = r.candidates.map(dayOf).sort();
  assert.deepStrictEqual(days, ['09-02', '09-04', '09-05', '09-05', '09-06', '09-06']);
});

// 16. What are Shalman's set times?
test("16. What are Shalman's set times?", () => {
  const r = G.retrieve("What are Shalman's set times?");
  assert.strictEqual(r.candidates.length, 6);
  const days = r.candidates.map(dayOf).sort();
  assert.deepStrictEqual(days, ['09-02', '09-04', '09-05', '09-05', '09-06', '09-06']);
});

// 17. shalman
test('17. shalman', () => {
  const r = G.retrieve('shalman');
  assert.strictEqual(r.candidates.length, 6);
});

// 18. When is illg?
test('18. When is illg?', () => {
  const r = G.retrieve('When is illg?');
  assert.strictEqual(r.parsed.intent, 'person');
  assert.strictEqual(r.candidates.length, 0);
  assert.strictEqual(r.parsed.personMiss, true);
});

// 19. What are Manucho's set times?
test("19. What are Manucho's set times?", () => {
  const r = G.retrieve("What are Manucho's set times?");
  assert.strictEqual(r.candidates.length, 0);
  assert.strictEqual(r.parsed.personMiss, true);
});

// 20. When is Shalmn playing?
test('20. When is Shalmn playing?', () => {
  const r = G.retrieve('When is Shalmn playing?');
  assert.strictEqual(r.candidates.length, 0);
  assert.strictEqual(r.parsed.personMiss, true);
  assert(r.parsed.didYouMean && /shalman/i.test(r.parsed.didYouMean));
});

// 21. what should I do Wednesday afternoon
test('21. what should I do Wednesday afternoon', () => {
  const r = G.retrieve('what should I do Wednesday afternoon');
  const talkCount = r.candidates.filter(c => c.e.c === 'Maybe You Should Talk To Someone').length;
  assert(talkCount <= 1);
  assert(!r.parsed.matchTerms.includes('should'));
});

// 22. tacos monday
test('22. tacos monday', () => {
  const r = G.retrieve('tacos monday');
  assert(r.candidates.length > 0);
  assert(r.candidates.every(x => dayOf(x) === '08-31'));
  const titles = r.candidates.map(x => x.e.t);
  assert(titles.includes('Midnight Tacos'));
});

// 23. what about tomorrow
test('23. what about tomorrow', () => {
  const r = G.retrieve('what about tomorrow', { nowMs: at(9, 1, 12) });
  assert(r.parsed.isBroad || r.parsed.intent === 'open_rec');
  assert.strictEqual(r.parsed.targetDay, '09-02');
});

// 24. scopeCheck
test('24. scopeCheck tests', () => {
  assert.strictEqual(G.scopeCheck('write me a python script').ok, false);
  assert.strictEqual(G.scopeCheck('Is there pizza served on Wednesday?').ok, true);
  assert.strictEqual(G.scopeCheck('When is illg?').ok, true);
});

// 25. parseQuery('Is there pizza served on Wednesday?')
test("25. parseQuery('Is there pizza served on Wednesday?')", () => {
  const p = G.parseQuery('Is there pizza served on Wednesday?');
  assert(!p.tokens.includes('served'));
  assert(!p.tokens.includes('wednesday'));
  assert(!p.tokens.includes('is'));
  assert(!p.tokens.includes('there'));
  assert.strictEqual(p.targetDay, '09-02');
});

// 26. retrieve('pizza', {limit: 28}).candidates.length <= 28
test('26. retrieve limit test', () => {
  const r = G.retrieve('pizza', { limit: 28 });
  assert(r.candidates.length <= 28);
});

// 27. yoga Thursday
test('27. yoga Thursday', () => {
  const r = G.retrieve('yoga Thursday');
  assert(r.candidates.length > 0);
  const fv = G.loadGuide().ev.fv;
  for (const c of r.candidates) {
    assert(dayOf(c) === '09-03');
    const hasYogaText = /yoga/i.test(c.e.t + ' ' + c.e.d);
    const hasYogaTag = c.e.f && c.e.f.some(idx => fv[idx] && fv[idx].includes('yoga'));
    assert(hasYogaText || hasYogaTag);
  }
});

// 28. kids activities tuesday
test('28. kids activities tuesday', () => {
  const r = G.retrieve('kids activities tuesday');
  assert(r.candidates.length > 0);
  for (const c of r.candidates) {
    assert.strictEqual(dayOf(c), '09-01');
    const hasKidsG = c.e.g && c.e.g.includes('kids');
    const hasKidsText = /kids|family|child/i.test(c.e.t + ' ' + c.e.d);
    assert(hasKidsG || hasKidsText);
  }
  assert(r.parsed.relaxed.includes('partial_match') || r.parsed.relaxed.includes('category_broadened'));
});

// 29. pizza party wednesday
test('29. pizza party wednesday', () => {
  const r = G.retrieve('pizza party wednesday', { nowMs: at(8, 31, 12) });
  assert(r.candidates.length > 0);
  assert(r.candidates.every(x => dayOf(x) === '09-02'));
  const titles = r.candidates.map(x => x.e.t);
  assert(titles.includes('Pizza Party and Elixir Bar'));
  assert(!r.parsed.relaxed.includes('partial_match'));
});

// 30. what is happening at 3:00 and E on day 2 of the burn
test('30. what is happening at 3:00 and E on day 2 of the burn', () => {
  const q = 'what is happening at 3:00 and E on day 2 of the burn';
  assert.strictEqual(G.scopeCheck(q).ok, true);
  const r = G.retrieve(q);
  assert.strictEqual(r.parsed.targetDay, '08-31');
  assert.strictEqual(r.parsed.refAddr, '3:00 & E');
  assert(!r.parsed.matchTerms.includes('day'));
  assert(!r.parsed.matchTerms.includes('burn'));
  assert(r.candidates.length > 0);
  assert(r.candidates.every(x => dayOf(x) === '08-31'));
});

// 31. what should I do on burn night
test('31. what should I do on burn night', () => {
  const r = G.retrieve('what should I do on burn night');
  assert.strictEqual(r.parsed.targetDay, '09-05');
  assert(r.candidates.length > 0);
  assert(r.candidates.every(x => dayOf(x) === '09-05'));
});

// 32. day mapping
test('32. day mapping', () => {
  assert.strictEqual(G.parseQuery('pizza on day 1').targetDay, '08-30');
  assert.strictEqual(G.parseQuery('pizza on day 7').targetDay, '09-05');
  assert.strictEqual(G.parseQuery('pizza first day').targetDay, '08-30');
  assert.strictEqual(G.parseQuery('pizza last day').targetDay, '09-07');
});

// 33. regression: temple burn
test('33. regression: temple burn', () => {
  const r = G.retrieve('temple burn');
  assert(r.candidates.length > 0);
  for (const c of r.candidates) {
    assert(/burn/i.test(c.e.t + ' ' + (c.e.c || '') + ' ' + (c.e.k || '') + ' ' + (c.e.p || '') + ' ' + c.e.d));
  }
});

// 34. sunrise window: "sunrise" means dawn (04:00-10:00), not late night
test('34. sunrise window is dawn, not 23:00', () => {
  const p = G.parseQuery('sunrise set tuesday');
  assert.strictEqual(p.targetDay, '09-01');
  assert.strictEqual(p.wStart, Date.UTC(2026, 8, 1, 4, 0));
  assert.strictEqual(p.wEnd, Date.UTC(2026, 8, 1, 10, 0));
});

// 35. "wednesday night" consumes the word night; it is not a search term
test('35. night is a time word, not a search term', () => {
  const p = G.parseQuery('open bar wednesday night');
  assert(!p.matchTerms.includes('night'));
  assert.strictEqual(p.targetDay, '09-02');
  assert.strictEqual(p.wStart, Date.UTC(2026, 8, 2, 23, 0));
});

// 36. open bar wednesday night finds literal open-bar listings on Wednesday
test('36. open bar wednesday night', () => {
  const r = G.retrieve('open bar wednesday night', { nowMs: at(8, 31, 12) });
  assert(r.candidates.length > 0);
  const titles = r.candidates.map(x => x.e.t);
  assert(titles.some(t => /bar is open/i.test(t)));
  assert(r.candidates.every(x => dayOf(x) === '09-02'));
});

// 37. category word with no other usable words filters by tag ("dj sets tonight")
test('37. dj sets tonight filters to music-tagged events', () => {
  const r = G.retrieve('dj sets tonight', { nowMs: at(8, 30, 19) });
  assert(r.candidates.length > 0);
  for (const c of r.candidates) {
    assert(c.e.g && c.e.g.includes('music'), 'non-music event leaked: ' + c.e.t);
  }
});

// 38. sound camp routes to music camps, not the literal words sound+camp
test('38. sound camp means music', () => {
  const r = G.retrieve('sound camp');
  assert.strictEqual(r.parsed.catWord, 'dj');
  assert(r.hits > 100);
  for (const c of r.candidates.slice(0, 10)) {
    assert(c.e.g && c.e.g.includes('music'));
  }
});

// 39. multi-term: a generic category word must not sink a literal match
test('39. vegan food keeps the literal vegan listing, no relax note', () => {
  const r = G.retrieve('vegan food');
  assert(r.candidates.length > 0);
  assert.strictEqual(r.parsed.relaxed.length, 0);
  const titles = r.candidates.map(x => x.e.t);
  assert(titles.some(t => /vegan/i.test(t)));
});

// 40. title matches outrank an all-day ambient entry that merely mentions the word
test('40. burgers ranks titled burger events above the radio station', () => {
  const r = G.retrieve('burgers');
  assert(r.candidates.length > 0);
  assert(/burgers/i.test(r.candidates[0].e.t), 'top hit was: ' + r.candidates[0].e.t);
  const bmirIdx = r.candidates.findIndex(x => /94\.5 FM/.test(x.e.t));
  const titledIdx = r.candidates.findIndex(x => /burgers/i.test(x.e.t));
  if (bmirIdx !== -1) assert(titledIdx < bmirIdx);
});

// 41. fine-tag synonym routing: gay -> queer/lgbtq tags
test('41. gay party routes through queer fine tags', () => {
  const r = G.retrieve('gay party');
  assert(r.candidates.length >= 3);
  assert.strictEqual(r.parsed.relaxed.length, 0);
  const fv = G.loadGuide().ev.fv;
  const top = r.candidates.slice(0, 5);
  const tagged = top.filter(c =>
    /gay|queer|lgbt/i.test(c.e.t + ' ' + (c.e.c || '') + ' ' + c.e.d) ||
    (c.e.f && c.e.f.some(idx => /queer|lgbtq|sapphic/.test(fv[idx] || ''))));
  assert(tagged.length >= 3);
});

// 42. plural stemming: parties -> party
test('42. parties tonight matches party events', () => {
  const r = G.retrieve('parties tonight', { nowMs: at(8, 30, 19) });
  assert.strictEqual(r.parsed.catWord, 'party');
  assert(r.candidates.length > 0);
  for (const c of r.candidates.slice(0, 10)) {
    assert(/part(y|ies)/i.test(c.e.t + ' ' + c.e.d) || (c.e.g && c.e.g.includes('party')));
  }
});

// 43. live music means live music, not every DJ set
test('43. live music finds literal live music', () => {
  const r = G.retrieve('live music');
  assert(r.candidates.length >= 5);
  for (const c of r.candidates.slice(0, 5)) {
    assert(/live/i.test(c.e.t + ' ' + c.e.d), 'not live: ' + c.e.t);
  }
});

// 44. techno routes through the fine tag when the word is not in the text
test('44. techno tonight uses the fine tag layer', () => {
  const r = G.retrieve('techno tonight', { nowMs: at(8, 30, 19) });
  assert(r.candidates.length >= 5);
  const fv = G.loadGuide().ev.fv;
  const viaTag = r.candidates.filter(c =>
    !(/techno/i.test(c.e.t + ' ' + (c.e.p || '') + ' ' + c.e.d)) &&
    c.e.f && c.e.f.some(idx => (fv[idx] || '') === 'techno'));
  assert(viaTag.length > 0, 'no candidate arrived purely via the techno fine tag');
});

// 45. ies plural stemming in the matcher itself
test('45. makeStemRe style plurals: query "cocktail parties"', () => {
  const r = G.retrieve('cocktail parties');
  assert(r.candidates.length > 0);
  for (const c of r.candidates.slice(0, 5)) {
    assert(/cocktail/i.test(c.e.t + ' ' + (c.e.c || '') + ' ' + c.e.d + ' ' + (c.e.k || '')));
  }
});

const TOTAL = 45;
console.log('\n--- TEST SUMMARY ---');
console.log(`Passed: ${passed} / ${TOTAL}`);
console.log(`Failed: ${failed} / ${TOTAL}`);

if (failed > 0) {
  process.exit(1);
}
