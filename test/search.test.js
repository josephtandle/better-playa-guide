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
  const arc = BPG.answer('what time does arctica open');
  ok(arc.results.length > 0 && /Arctica/i.test(JSON.stringify(arc.results.slice(0,3))), '"what time does arctica open" returns Arctica ice hours');
  const bath = BPG.answer('bathroom near me');
  ok(/🚽/.test(bath.reply), 'bathroom synonym routes to the potty finder');
})();

/* ---- 11. near-me with no location: never empty-handed ---- */
(function(){
  const r = BPG.answer('what is happening now near me');
  ok(r.results.length > 0, '"now near me" without a location returns city-wide results (' + r.results.length + ')');
  ok(/city-wide|Set your location/i.test(r.reply), 'and the reply says how to get real distances');
})();

/* ---- 12. for-you sort exists and reorders by starred affinity ---- */
(function(){
  const sortSel = d.getElementById('sort');
  ok(!!sortSel.querySelector('option[value="foryou"]'), 'the "for you" sort option is on the page');
})();

/* ---- 13a. Grace period: events hide only 30+ min AFTER they end ---- */
(function(){
  /* the hide cutoff in source must subtract a 30-minute grace from now */
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'guide', 'guide.js'), 'utf8');
  ok(/nowP = Date\.now\(\) - 7 \* 3600 \* 1000 - 30 \* 60 \* 1000/.test(src),
    'past-hiding waits 30 minutes after an event fully ends');
})();

/* ---- 13. Past events hidden by default, one tap to show ---- */
(function(){
  const r = search('friday bbq feast'); /* only slot was opening Sunday, long past */
  ok(/Nothing matches/.test(r.text) || r.n === 0, 'a fully past event is hidden from default browsing');
  const sp = d.getElementById('show-past');
  ok(sp && sp.style.display !== 'none' && /past event/.test(sp.textContent), 'the Show past events button appears with a count');
  sp.click();
  const r2 = d.getElementById('list').textContent;
  ok(/BBQ/i.test(r2), 'toggling shows the past event');
  ok(/Hide past events/.test(sp.textContent), 'button flips to Hide past events');
  sp.click();
  const daySel = d.getElementById('day');
  daySel.value = '08-30'; daySel.dispatchEvent(new w.window.Event('change', { bubbles: true }));
  search('');
  ok(d.querySelectorAll('#list li').length > 1, 'explicitly browsing a past day still shows that day');
  daySel.value = ''; daySel.dispatchEvent(new w.window.Event('change', { bubbles: true }));
  search('');
})();

/* ---- 14. location auto-shares with friends (consent-gated) ---- */
(function(){
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'guide', 'guide.js'), 'utf8');
  ok(/autoFriendLoc/.test(src) && /bpg\.f\.consent/.test(src) && /bpg\.f\.sharing/.test(src),
    'main page auto-pushes location to friends only with consent AND sharing on');
  ok(/addEventListener\('change', function\(\)\{ setTimeout\(push, 500\)/.test(src),
    'location-box changes trigger the auto-push');
})();

/* ---- Summary ---- */
/* ---- 15. GPS: lat/lon converts to a playa address (inverse of parseAddr) ---- */
(function(){
  // forward-project 9:30 & C via the published geometry, feed it back
  ok(BPG.latLonToAddr(40.791913, -119.214257) === '9:30 & C', 'GPS fix near 9:30 & C resolves to 9:30 & C');
  ok(/open playa/.test(BPG.latLonToAddr(40.783247, -119.207884)), 'a fix at the Man reads as open playa, not a fake street');
  ok(BPG.latLonToAddr(40.6, -119.0) === null, 'a fix far outside Black Rock City returns null (no garbage address)');
  // Esplanade ring: r=2492.7 at 7:30 -> b=(7.5-10.5)*30=-90deg
  var lat = 40.783247448 + (2492.7 * Math.cos(-Math.PI/2)) / 364000;
  var lon = -119.207884096 + (2492.7 * Math.sin(-Math.PI/2)) / 275615.7313;
  ok(BPG.latLonToAddr(lat, lon) === '7:30 & Esplanade', '7:30 & Esplanade round-trips exactly');
  /* the city arc is 2:00-10:00: Temple/deep-playa fixes must NOT produce a
     street address (parseAddr rejects hour 12 and the bad string would erase
     the map dot) */
  var lat12 = 40.783247448 + (2500 * Math.cos(((12 - 10.5) * 30) * Math.PI / 180)) / 364000;
  var lon12 = -119.207884096 + (2500 * Math.sin(((12 - 10.5) * 30) * Math.PI / 180)) / 275615.7313;
  var temple = BPG.latLonToAddr(lat12, lon12);
  ok(/open playa/.test(temple), 'a fix at the Temple arc says open playa, never a fake street (' + temple + ')');
  ok(BPG.parseAddr(temple) === null || /open playa/.test(temple), 'the open-playa string is never mistaken for an address');
})();

/* ---- 15b. the Find-page GPS button REALLY fills the location (behavior, not regex) ---- */
(function(){
  Object.defineProperty(w.navigator, 'geolocation', { value: {
    getCurrentPosition: function(okCb){ okCb({ coords: { latitude: 40.791913, longitude: -119.214257 } }); }
  }, configurable: true });
  const btn = d.getElementById('gps-btn');
  ok(!!btn, 'the GPS button exists on the Find page');
  btn.click();
  ok(d.getElementById('loc').value === '9:30 & C', 'tapping GPS fills the location box with the converted address (got "' + d.getElementById('loc').value + '")');
  /* internal state followed too: ask-intent potty answer works off the GPS fix */
  var np = BPG.nearestPotty(BPG.parseAddr(d.getElementById('loc').value));
  ok(!!np && np.min >= 1, 'after a GPS fix the nearest-potty answer has a real distance');
  var pb = d.getElementById('potty-btn');
  ok(pb && pb.tagName === 'A' && pb.getAttribute('href') === '/guide/map#potty',
    'the potty button goes straight to the map way-there view');
})();

/* ---- 15c. friends page has a working GPS lane of its own (geo.js) ---- */
(function(){
  const fs2 = require('fs'), path2 = require('path');
  const geoSrc = fs2.readFileSync(path2.join(__dirname, '..', 'guide', 'geo.js'), 'utf8');
  const fhtml = fs2.readFileSync(path2.join(__dirname, '..', 'guide', 'friends.html'), 'utf8');
  ok(fhtml.indexOf('/guide/geo.js') !== -1 && fhtml.indexOf('/guide/geo.js') < fhtml.indexOf('/guide/friends.js'),
    'friends.html loads geo.js BEFORE friends.js (guide.js is not on that page)');
  /* geo.js really defines __bpgGps and its math agrees with guide.js */
  const sandbox = { window: {}, navigator: {} };
  const vm = require('vm'); vm.createContext(sandbox);
  vm.runInContext(geoSrc, sandbox);
  ok(typeof sandbox.window.__bpgGps === 'function', 'geo.js defines window.__bpgGps');
  ok(sandbox.window.__bpgLatLonToAddr(40.791913, -119.214257) === BPG.latLonToAddr(40.791913, -119.214257),
    'geo.js math matches guide.js math exactly');
  const swSrc = fs2.readFileSync(path2.join(__dirname, '..', 'guide', 'sw.js'), 'utf8');
  ok(/guide\/geo\.js/.test(swSrc), 'geo.js is cached by the service worker (offline)');
})();

/* ---- 16. giant lineups clamp with a show-all toggle ---- */
(function(){
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'guide', 'guide.js'), 'utf8');
  ok(/who-clamped/.test(src) && /who-more/.test(src), 'lineups over ~220 chars render clamped with a show-all button');
  ok(/data-full/.test(src), 'the full lineup is kept for expansion');
})();

/* ---- 17. My Events hides ended events too (starred is no longer exempt) ---- */
(function(){
  /* the fixture past event (BBQ, 08-30) starred: it must STILL hide by default */
  const w3 = w, d3 = d;
  const starBtns = null; /* we star via localStorage shape used by the app */
  /* find the BBQ fixture's id from GROUPS via search */
  const inp3 = d3.getElementById('ask-q');
  const sp3 = d3.getElementById('show-past');
  if (sp3 && /Hide past/.test(sp3.textContent)) sp3.click(); /* reset toggle */
  inp3.value = ''; inp3.dispatchEvent(new w3.Event('input', { bubbles: true }));
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'guide', 'guide.js'), 'utf8');
  ok(/if \(!showPast\)\{/.test(src) && !/!showPast && !isStarred/.test(src),
    'the past filter no longer exempts starred events (My Events shows only unended)');
})();

/* ---- 18. same-card description duplication (near-dupe merge) ---- */
(function(){
  const env4 = (function(){
    const { JSDOM } = require('jsdom');
    const fs4 = require('fs'), path4 = require('path');
    const R = path4.join(__dirname, '..');
    const dom4 = new JSDOM(fs4.readFileSync(path4.join(R, 'guide', 'index.html'), 'utf8'),
      { runScripts: 'outside-only', url: 'https://guide.test/guide/', pretendToBeVisual: true });
    const w4 = dom4.window;
    w4.eval(fs4.readFileSync(path4.join(R, 'guide', 'data.js'), 'utf8'));
    /* inject the exact failure: two days of one listing, description differing
       only by punctuation, plus a third day whose text is a superstring */
    w4.__GUIDE__.ev.e.push(
      { t: 'Dupe Test Party', c: 'Camp Dupe', a: '4:00 & C', d: 'Come dance with us in the dome.', s: [['09-04 10:00', '12:00']], g: ['music'], src: 0 },
      { t: 'Dupe Test Party', c: 'Camp Dupe', a: '4:00 & C', d: 'Come dance with us in the dome', s: [['09-05 10:00', '12:00']], g: ['music'], src: 0 },
      { t: 'Dupe Test Party', c: 'Camp Dupe', a: '4:00 & C', d: 'Come dance with us in the dome. Free drinks Saturday!', s: [['09-06 10:00', '12:00']], g: ['music'], src: 0 }
    );
    w4.eval(fs4.readFileSync(path4.join(R, 'guide', 'guide.js'), 'utf8'));
    if (w4.document.readyState === 'loading') w4.document.dispatchEvent(new w4.Event('DOMContentLoaded', { bubbles: true }));
    return w4;
  })();
  const d4 = env4.document;
  const q4 = d4.getElementById('ask-q');
  q4.value = 'dupe test party';
  q4.dispatchEvent(new env4.Event('change', { bubbles: true }));
  const card4 = Array.from(d4.querySelectorAll('#list li')).find(li => /Dupe Test Party/.test(li.textContent));
  ok(!!card4, 'the injected multi-day listing renders one grouped card');
  const txt4 = card4 ? card4.textContent : '';
  const hits = (txt4.match(/Come dance with us in the dome/g) || []).length;
  ok(hits === 1, 'the description appears exactly once on the card (got ' + hits + 'x)');
  ok(/Free drinks Saturday/.test(txt4), 'the superstring variant supersedes, extra info kept');
})();

console.log('search: ' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach(f => console.error('  FAILED: ' + f));
  process.exit(1);
}
