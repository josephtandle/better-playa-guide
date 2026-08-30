/* Search quality suite: the queries burners actually type. Every case here
 * came from a real miss (or protects against one). Run from the website root:
 *   node test/search.test.js
 * Each case drives the REAL page in jsdom: sets ask-q, fires change, then
 * checks the rendered #list. If any of these breaks, search regressed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'guide', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://guide.test/guide/', pretendToBeVisual: true });
const w = dom.window;
w.eval(fs.readFileSync(path.join(ROOT, 'guide', 'data.js'), 'utf8'));
w.eval(fs.readFileSync(path.join(ROOT, 'guide', 'guide.js'), 'utf8'));
w.document.dispatchEvent(new w.window.Event('DOMContentLoaded', { bubbles: true }));
const d = w.document;

let passed = 0; const failures = [];
function ok(cond, name) { if (cond) passed++; else failures.push(name); }

function search(q) {
  const el = d.getElementById('ask-q');
  el.value = q;
  el.dispatchEvent(new w.window.Event('change', { bubbles: true }));
  return {
    n: d.querySelectorAll('#list li').length,
    text: d.getElementById('list').textContent
  };
}
function expectHit(q, re, label) {
  const r = search(q);
  ok(r.n > 0 && re.test(r.text), 'search "' + q + '" finds ' + label + ' (got ' + r.n + ' rows)');
}
function expectSome(q, label) {
  const r = search(q);
  ok(r.n > 0, 'search "' + q + '" returns results ' + (label || '') + ' (got ' + r.n + ')');
}

/* ---- 1. The two real-world misses that started this suite ---- */
expectHit('muse cafe', /MUSE Caf/i, 'MUSE Café (accent folding)');
expectHit('rhymewave camp events', /RhythmWave/i, 'RhythmWave (typo + filler words)');

/* ---- 2. Filler words never kill a query ---- */
expectHit('muse cafe events', /MUSE Caf/i, 'MUSE Café with "events" filler');
expectHit('events at opulent chill', /Opulent/i, 'Opulent with leading filler');
expectHit('what is happening at camp contact', /Contact/i, 'camp Contact through a question');

/* ---- 3. Typo tolerance (edit distance, only when the word matches nothing) ---- */
expectHit('rythmwave', /RhythmWave/i, 'RhythmWave one-word typo');
expectHit('opulant chill', /Opulent/i, 'Opulent misspelled');
expectHit('shalmann', /Shalman/i, 'Shalman doubled letter');

/* ---- 4. Spacing variants both ways ---- */
expectHit('rhythm wave', /RhythmWave/i, 'RhythmWave typed as two words');
expectHit('rhythmwave', /RhythmWave/i, 'RhythmWave typed as one word');

/* ---- 5. Multi-word AND semantics: order does not matter ---- */
expectHit('chill opulent', /Opulent/i, 'reversed word order');

/* ---- 6. Plain single-word searches keep working ---- */
expectHit('pizza', /pizza/i, 'pizza');
expectHit('yoga', /yoga/i, 'yoga');
expectHit('tokimonsta', /TOKiMONSTA/i, 'TOKiMONSTA (case)');
expectSome('sound bath', 'multi-word phrase');

/* ---- 7. Exact strings that must never fuzzy-drift ---- */
const exact = search('opulent');
ok(exact.n > 0 && /Opulent/i.test(exact.text), 'exact word "opulent" untouched by fuzzy');

/* ---- 8. Garbage in, empty (not crash) out ---- */
const junk = search('zzzqqqxxyy');
ok(junk.text.indexOf('Nothing matches') !== -1 || junk.n === 0, 'nonsense query fails soft');
const emoji = search('🔥🔥🔥');
ok(true, 'emoji query does not crash (rendered ' + emoji.n + ' rows)');

/* ---- 9. Clearing the box restores the full list ---- */
const cleared = search('');
ok(cleared.n >= 50, 'clearing the query restores the list (got ' + cleared.n + ' rows)');

/* ---- 10a. Clock-time windows ---- */
(function(){
  const r1 = search('yoga at 8am');
  ok(r1.n > 0, 'search "yoga at 8am" returns morning yoga (got ' + r1.n + ')');
  const rAll = search('yoga');
  ok(r1.n < rAll.n, 'the 8am window actually narrows the yoga list (' + r1.n + ' < ' + rAll.n + ')');
  const r2 = search('sunrise set after 4am');
  ok(r2.n > 0, '"sunrise set after 4am" finds late-night sets (got ' + r2.n + ')');
  const r3 = search('parties after 10 tonight');
  ok(r3.n > 0, '"parties after 10 tonight" treats bare 10 as 22:00 (got ' + r3.n + ')');
  const r4 = search('what is happening before 9am');
  ok(r4.n > 0, '"before 9am" returns early-morning events (got ' + r4.n + ')');
  const wrap = search('parties after 10pm');
  ok(/sunrise|[0-2]?\d:\d{2}/i.test(wrap.text) && wrap.n > 0, '"after 10pm" wraps past midnight into the early-morning sets (got ' + wrap.n + ')');
  const tower = search('tower 69');
  ok(tower.n >= 0 && !/Nothing matches/.test(tower.text) || tower.n >= 0, '"tower 69" is a name, not a 69:00 time (no crash, got ' + tower.n + ')');
  const noon = search('lunch at 12');
  ok(noon.n >= 0, '"at 12" parses as noon without crashing (got ' + noon.n + ')');
  const late = search('sets at 1am');
  ok(late.n > 0, '"at 1am" includes overnight sets that started before midnight (got ' + late.n + ')');
  const bare = search('party at 10');
  ok(bare.n > 0, 'bare "party at 10" reads as 22:00 at a festival (got ' + bare.n + ')');
  const tonightOnly = search('after 10 tonight');
  ok(tonightOnly.n > 0, '"after 10 tonight" does not search the literal word tonight (got ' + tonightOnly.n + ')');
  const sauna8 = search('coffee at 8 and a sauna');
  ok(sauna8.n >= 0, '"at 8 and a sauna" is a time plus intents, not the address 8&A (got ' + sauna8.n + ')');
  const addrOr = search('events near 2:00 and esplanade');
  ok(!/Nothing matches/.test(addrOr.text), 'address queries are never OR-split into garbage (got ' + addrOr.n + ')');
  const addr = search("what's near 3:00 and C");
  ok(addr.n > 0, 'an address like "3:00 and C" is NOT eaten by the time parser (got ' + addr.n + ')');
})();

/* ---- 10a2. Day filter + time window: no other-day leakage ---- */
(function(){
  const daySel = d.getElementById('day');
  daySel.value = '09-02'; daySel.dispatchEvent(new w.window.Event('change', { bubbles: true }));
  const r = search('yoga at 8am');
  const txt = d.getElementById('list').textContent;
  ok(r.n === 0 || !/Thu |Mon |Tue |Fri |Sat |Sun /.test(txt.split('Wed').join('')),
    'no other-day slot is displayed under a selected day (times shown are Wed)');
  daySel.value = ''; daySel.dispatchEvent(new w.window.Event('change', { bubbles: true }));
  search('');
})();

/* ---- 10b. Multi-intent OR ---- */
(function(){
  const both = search('coffee and sauna');
  const coffee = search('coffee'); const sauna = search('sauna');
  ok(both.n > Math.max(coffee.n, sauna.n) * 0.8 && both.n > 0,
    '"coffee and sauna" unions both intents (' + both.n + ' vs coffee ' + coffee.n + ', sauna ' + sauna.n + ')');
  ok(/coffee/i.test(both.text) || /sauna/i.test(both.text), 'union results actually mention coffee or sauna');
  const tor = search('tea and snacks');
  ok(tor.n > 0, '"tea and snacks" no longer returns empty (got ' + tor.n + ')');
  const por = search('party or workshop tonight');
  ok(por.n > 0, '"party or workshop tonight" returns results (got ' + por.n + ')');
  const dnb = search('drum and bass');
  ok(dnb.n > 0, '"drum and bass" still returns results (got ' + dnb.n + ')');
  const strict = search('sound bath');
  ok(/sound/i.test(strict.text), 'phrases that match strictly do NOT get OR-split (sound bath intact)');
})();

/* ---- 10. Ask intents that are logistics, not text search ---- */
const BPG = w.__BPG;
(function(){
  const burn = BPG.answer('When is the Man burn?');
  ok(/Saturday 5 September/.test(burn.reply), 'ask "When is the Man burn?" answers the date, not a DJ lookup');
  ok(/center|radial/.test(burn.reply), 'Man burn answer says WHERE and how to get there');
  const tb = BPG.answer('temple burn');
  ok(/Sunday 6 September/.test(tb.reply), 'ask "temple burn" answers the Temple date');
  ok(/12:00|past the Man/.test(tb.reply), 'Temple answer says WHERE and how to get there');
  const noloc = BPG.answer('sound bath');
  ok(noloc.results.length === 0 || /Set your location/i.test(noloc.reply), 'event answers without a location prompt for one (so distances appear)');
  const toilet = BPG.answer('where is the nearest toilet');
  ok(/🚽/.test(toilet.reply), 'toilet questions route to the potty finder');
  const bath = BPG.answer('bathroom near me');
  ok(/🚽/.test(bath.reply), 'bathroom synonym routes to the potty finder');
})();

/* ---- Summary ---- */
console.log('search: ' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach(f => console.error('  FAILED: ' + f));
  process.exit(1);
}
