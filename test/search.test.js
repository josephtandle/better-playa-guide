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

/* ---- 10. Ask intents that are logistics, not text search ---- */
const BPG = w.__BPG;
(function(){
  const burn = BPG.answer('When is the Man burn?');
  ok(/Saturday 5 September/.test(burn.reply), 'ask "When is the Man burn?" answers the date, not a DJ lookup');
  const tb = BPG.answer('temple burn');
  ok(/Sunday 6 September/.test(tb.reply), 'ask "temple burn" answers the Temple date');
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
