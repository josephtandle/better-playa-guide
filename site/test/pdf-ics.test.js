/* PDF + ICS export lanes: builders and endpoint contracts.
 * The PDF streams are uncompressed, so text assertions grep the raw bytes. */
'use strict';
const assert = require('assert');
const { loadGuide } = require('../api/_guide.js');
const { buildListPdf, buildHashIndex, eventsToRows, hashId, wrap, undouble } = require('../api/_pdf.js');
const { buildListIcs } = require('../api/_ics.js');

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('PASS: ' + msg); }
  else { failed++; console.log('FAIL: ' + msg); }
}

const G = loadGuide();
const EV = G.ev.e;

/* ---- hash index: full-id and title|camp alias both resolve ---- */
(function () {
  const idx = buildHashIndex(EV);
  const e = EV.find(ev => ev.s && ev.s[0] && ev.s[0][0]);
  ok(idx[hashId(e.id)] === e, 'full-id hash resolves to the event');
  const tcCounts = {};
  EV.forEach(ev => { const k = ev.t + '|' + ev.c; tcCounts[k] = (tcCounts[k] || 0) + 1; });
  const uniq = EV.find(ev => tcCounts[ev.t + '|' + ev.c] === 1);
  ok(idx[hashId(uniq.t + '|' + uniq.c)] === uniq, 'unique title|camp alias hash resolves');
})();

/* ---- eventsToRows: sorted, day-labelled, same-day sets collapsed ---- */
(function () {
  const sample = EV.filter(e => e.s && e.s[0] && e.s[0][0]).slice(0, 40);
  const rows = eventsToRows(sample);
  ok(rows.length > 0, 'rows come out of eventsToRows');
  ok(rows.every(r => !/^\d{2}-\d{2}/.test(r.day)), 'no raw MM-DD day labels');
  const sortKeys = rows.map(r => r.day);
  ok(rows.some(r => /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/.test(r.day)),
    'day labels carry weekday names');
  /* Sunday special-casing */
  const sun1 = eventsToRows([{ t: 'X', c: 'Y', a: '', s: [['08-30 12:00', null]] }]);
  ok(sun1[0].day.indexOf('Sunday Opening Day') === 0, 'Aug 30 labels as Sunday Opening Day');
  const sun2 = eventsToRows([{ t: 'X', c: 'Y', a: '', s: [['09-06 20:00', null]] }]);
  ok(sun2[0].day.indexOf('Sunday Temple Burn') === 0, 'Sep 6 labels as Sunday Temple Burn');
  /* same-day multi-set collapse */
  const multi = eventsToRows([{ t: 'Sets', c: 'Camp', a: '', s: [['09-02 10:00', null], ['09-02 12:00', null], ['09-02 14:00', null]] }]);
  ok(multi.length === 1 && /3 sets this day/.test(multi[0].time), 'same-day sets collapse to one row with a count');
})();

/* ---- undouble mirrors the client ---- */
(function () {
  ok(undouble('The same words here twice The same words here twice') === 'The same words here twice',
    'doubled description undoubles');
  ok(undouble('short') === 'short', 'short strings untouched');
})();

/* ---- wrap: respects maxLines and truncates the tail ---- */
(function () {
  const lines = wrap('one two three four five six seven eight nine ten eleven twelve', 10, 100, 3);
  ok(lines.length <= 3, 'wrap respects maxLines');
})();

/* ---- PDF builder: valid header/EOF, carries titles, day headers, sign-off ---- */
(function () {
  const sample = EV.filter(e => e.s && e.s[0] && e.s[0][0] && e.d).slice(0, 12);
  const rows = eventsToRows(sample);
  const pdf = buildListPdf(rows, { name: 'Dusty' });
  const raw = pdf.toString('latin1');
  ok(raw.slice(0, 8) === '%PDF-1.4', 'PDF starts with %PDF-1.4 header');
  ok(/%%EOF\s*$/.test(raw), 'PDF ends with %%EOF');
  ok(raw.indexOf('Your Playa Guide') !== -1, 'PDF carries the title');
  ok(raw.indexOf("Dusty's starred events") !== -1, 'PDF carries the personal name');
  const firstTitle = rows[0].title.replace(/[\\()]/g, '').slice(0, 20);
  ok(raw.indexOf(firstTitle.replace(/[^\x20-\x7e]/g, '').slice(0, 12)) !== -1, 'PDF carries an event title');
  ok(raw.indexOf('musecafe.vip/guide') !== -1, 'PDF links back to the live guide');
  ok(raw.indexOf('With love, Joe Che. You are the muse.') !== -1, 'PDF carries the sign-off');
  ok(raw.indexOf('\\u2014') === -1 && raw.indexOf('\xd0') === -1 && pdf.toString('latin1').indexOf('—') === -1, 'no em dash anywhere in the PDF');
  ok(raw.indexOf('window of tolerance') !== -1, 'PDF carries the happy-burn blessing');
  ok(raw.indexOf('on the plane to Burning Man') !== -1, 'PDF carries the made-by story');
  ok(pdf.length < 3.5 * 1024 * 1024, 'PDF stays under the email attachment cap');
  /* escaping: a title with parens must not break the stream */
  const evil = eventsToRows([{ t: 'Party (Secret) 100%', c: 'C(a)mp', a: '8:15 & E', s: [['09-03 22:00', null]], d: 'desc with (parens) and \\ backslash' }]);
  const pdf2 = buildListPdf(evil, {});
  ok(pdf2.toString('latin1').indexOf('Party \\(Secret\\) 100%') !== -1, 'parens escape inside PDF strings');
})();

/* ---- big list still builds and paginates ---- */
(function () {
  const sample = EV.filter(e => e.s && e.s[0] && e.s[0][0]).slice(0, 120);
  const pdf = buildListPdf(eventsToRows(sample), {});
  const raw = pdf.toString('latin1');
  const pageCount = (raw.match(/\/Type \/Page[^s]/g) || []).length;
  ok(pageCount >= 2, '120 events paginate to multiple pages (' + pageCount + ')');
})();

/* ---- ICS builder ---- */
(function () {
  const sample = EV.filter(e => e.s && e.s[0] && e.s[0][0] && / /.test(e.s[0][0])).slice(0, 10);
  const ics = buildListIcs(sample, '2026-08-26T00:00:00.000Z');
  ok(ics.indexOf('BEGIN:VCALENDAR') === 0 && /END:VCALENDAR\r\n$/.test(ics), 'ICS opens and closes the calendar');
  ok(ics.indexOf('\r\n') !== -1 && ics.split('\r\n').every(l => l.indexOf('\n') === -1), 'CRLF line endings throughout');
  ok(ics.indexOf('X-WR-CALNAME:My Playa Guide') !== -1, 'calendar is named My Playa Guide');
  ok(ics.indexOf('BEGIN:VTIMEZONE') !== -1 && ics.indexOf('TZID:America/Los_Angeles') !== -1, 'Pacific VTIMEZONE present');
  ok((ics.match(/BEGIN:VEVENT/g) || []).length > 0, 'events present');
  ok(ics.indexOf('TRIGGER:-PT30M') !== -1, 'timed events carry a 30-minute alarm');
  ok(ics.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 77), 'no line exceeds the RFC fold width');
  /* date-only slot becomes an all-day event with no alarm */
  const dOnly = buildListIcs([{ t: 'Running order', c: 'Camp', a: '8:00 & C', s: [['09-02', null]] }], '2026-08-26T00:00:00.000Z');
  ok(dOnly.indexOf('DTSTART;VALUE=DATE:20260902') !== -1, 'date-only slot becomes an all-day entry');
  ok(dOnly.indexOf('TRIGGER') === -1, 'all-day entries carry no alarm');
  /* past-midnight end wraps to the next day */
  const wrapIcs = buildListIcs([{ t: 'Night set', c: 'Camp', a: '', s: [['09-03 23:00', '02:00']] }], '2026-08-26T00:00:00.000Z');
  ok(wrapIcs.indexOf('DTEND;TZID=America/Los_Angeles:20260904T020000') !== -1, 'past-midnight end lands on the next day');
})();

/* ---- endpoint contracts (list-pdf + list-ics), driven through the handlers ---- */
(async function () {
  process.env.UPSTASH_REDIS_REST_URL = '';
  const makeRes = () => {
    const res = { headers: {}, statusCode: 0, body: null };
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    res.end = (b) => { res.body = b; res.done = true; };
    return res;
  };
  const pdfHandler = require('../api/list-pdf.js');
  const icsHandler = require('../api/list-ics.js');
  const idx = buildHashIndex(EV);
  const e = EV.find(ev => ev.s && ev.s[0] && ev.s[0][0]);
  const h = hashId(e.id);

  let res = makeRes();
  await pdfHandler({ method: 'GET', query: { l: h }, headers: { 'x-real-ip': '203.0.113.77' } }, res);
  ok(res.statusCode === 200 && res.headers['content-type'] === 'application/pdf', 'list-pdf: 200 + application/pdf');
  ok(Buffer.isBuffer(res.body) && res.body.slice(0, 5).toString() === '%PDF-', 'list-pdf: body is a real PDF');

  res = makeRes();
  await pdfHandler({ method: 'GET', query: { l: 'nothex!' }, headers: {} }, res);
  ok(res.statusCode === 400, 'list-pdf: malformed hashes -> 400');

  res = makeRes();
  await pdfHandler({ method: 'GET', query: { l: 'ffffffff' }, headers: {} }, res);
  ok(res.statusCode === 404, 'list-pdf: unresolvable hashes -> 404');

  res = makeRes();
  await pdfHandler({ method: 'POST', query: {}, headers: {} }, res);
  ok(res.statusCode === 405, 'list-pdf: POST -> 405');

  res = makeRes();
  await icsHandler({ method: 'GET', query: { l: h }, headers: { 'x-real-ip': '203.0.113.78' } }, res);
  ok(res.statusCode === 200 && /text\/calendar/.test(res.headers['content-type']), 'list-ics: 200 + text/calendar');
  ok(typeof res.body === 'string' && res.body.indexOf('BEGIN:VCALENDAR') === 0, 'list-ics: body is a calendar');

  res = makeRes();
  await icsHandler({ method: 'GET', query: { l: 'zzzz' }, headers: {} }, res);
  ok(res.statusCode === 400, 'list-ics: malformed hashes -> 400');

  console.log('\n--- PDF/ICS SUMMARY ---');
  console.log('Passed: ' + passed);
  console.log('Failed: ' + failed);
  if (failed > 0) process.exit(1);
})();
