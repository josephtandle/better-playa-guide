#!/usr/bin/env node
/* Contract suite for /api/list-sync. Exercises the real handler with fake
 * req/res and a stubbed global fetch: NO network ever reaches Supabase or
 * Resend. Guards: validation, rate limits, payload caps, and the security
 * model (the response never echoes stored data; email is transport, not a
 * lookup key).
 *
 * Run: node test/list-sync.test.js
 */
'use strict';
const path = require('path');

delete process.env.UPSTASH_REDIS_REST_URL;   /* force the local store: no network */
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.SUPABASE_URL = 'https://example-test.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-key-never-used-for-real';
process.env.RESEND_API_KEY = 'test-key-never-used-for-real';

const repoRoot = path.resolve(__dirname, '..');
const handler = require(path.join(repoRoot, 'api', 'list-sync.js'));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; failures.push(name); console.error('FAIL: ' + name); }
}

/* ---- fetch stub: records every outbound call ---- */
let calls = [];
let failResend = false;
global.fetch = async function (url, init) {
  calls.push({ url: String(url), init: init || {} });
  if (String(url).indexOf('resend.com') !== -1 && failResend) {
    return { ok: false, status: 500, json: async () => ({}) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

function fakeReq(body, ip, method) {
  return {
    method: method || 'POST',
    headers: { 'x-forwarded-for': ip || '203.0.113.7' },
    socket: { remoteAddress: ip || '203.0.113.7' },
    body: body
  };
}
function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.end = (s) => { res.body = String(s || ''); res.done = true; };
  return res;
}
async function run(body, ip, method) {
  const res = fakeRes();
  await handler(fakeReq(body, ip, method), res);
  let json = null;
  try { json = JSON.parse(res.body); } catch (e) {}
  return { res, json };
}

const GOOD = { email: 'redacted@example.invalid', hashes: ['0a1b2c3d', 'deadbeef'], name: 'Dusty', camp: 'Muse Cafe' };

(async function main() {
  /* method + validation */
  let r = await run(GOOD, '203.0.113.1', 'GET');
  ok(r.res.statusCode === 405, 'GET is refused with 405');

  r = await run({ email: 'not-an-email', hashes: GOOD.hashes }, '203.0.113.2');
  ok(r.res.statusCode === 400 && r.json.error === 'bad_email', 'bad email -> 400 bad_email');

  r = await run({ email: GOOD.email, hashes: ['ZZZZZZZZ'] }, '203.0.113.2');
  ok(r.res.statusCode === 400 && r.json.error === 'bad_list', 'non-hex hash -> 400 bad_list');

  r = await run({ email: GOOD.email, hashes: [] }, '203.0.113.2');
  ok(r.res.statusCode === 400 && r.json.error === 'bad_list', 'empty list -> 400 bad_list');

  const huge = [];
  for (let i = 0; i < 120; i++) huge.push('0a1b2c3d');
  r = await run({ email: GOOD.email, hashes: huge.concat(['0a1b2c3d']) }, '203.0.113.2');
  ok(r.res.statusCode === 400, 'oversize list (>120 hashes / >1000 chars) refused');

  r = await run('{not json', '203.0.113.2');
  ok(r.res.statusCode === 400, 'unparseable body -> 400');

  /* happy path: one Supabase write + one Resend send, response is only ok:true */
  calls = [];
  r = await run(GOOD, '203.0.113.3');
  ok(r.res.statusCode === 200 && r.json && r.json.ok === true, 'valid payload -> 200 {ok:true}');
  ok(r.res.body === JSON.stringify({ ok: true }), 'response body carries NOTHING but ok:true (no echo of stored data)');
  const supa = calls.find(c => c.url.indexOf('supabase.co') !== -1);
  const resend = calls.find(c => c.url.indexOf('resend.com') !== -1);
  ok(!!supa && supa.url.indexOf('/rest/v1/guide_list_backups') !== -1 && supa.url.indexOf('on_conflict=email') !== -1,
    'row upserts into guide_list_backups on email');
  const supaBody = supa ? JSON.parse(supa.init.body) : [];
  ok(Array.isArray(supaBody) && supaBody[0].email === GOOD.email &&
    JSON.stringify(supaBody[0].list) === JSON.stringify(GOOD.hashes) &&
    supaBody[0].name === 'Dusty' && supaBody[0].camp === 'Muse Cafe',
    'stored row carries email, list, name, camp');
  ok(!!resend, 'a Resend send goes out');
  const mail = resend ? JSON.parse(resend.init.body) : {};
  ok(mail.subject === 'Your Playa Guide list', 'subject is "Your Playa Guide list"');
  ok(mail.to && mail.to[0] === GOOD.email, 'mail goes to the submitted address');
  ok(mail.text.indexOf('https://musecafe.vip/guide/#l=0a1b2c3d,deadbeef') !== -1,
    'the email carries the #l= share link: the EMAIL IS THE TRANSPORT');
  ok(mail.text.indexOf('tap Merge') !== -1, 'the email tells them to tap Merge');
  ok(mail.text.indexOf('—') === -1, 'email body has no em dash');

  /* the endpoint never returns a stored list for an email (no lookup mode) */
  ok(r.res.body.indexOf('0a1b2c3d') === -1, 'response never echoes the list');

  /* per-email rate limit: 3/day (2 more sends after the one above, 4th refused) */
  await run(GOOD, '203.0.113.4');
  await run(GOOD, '203.0.113.5');
  r = await run(GOOD, '203.0.113.6');
  ok(r.res.statusCode === 429 && r.json.error === 'rate_limited', '4th send for one email in a day -> 429');

  /* per-IP rate limit: 10/day across emails */
  const ip = '198.51.100.9';
  let last = null;
  for (let i = 0; i < 11; i++) {
    last = await run({ email: 'user' + i + '@example.com', hashes: ['0a1b2c3d'] }, ip);
  }
  ok(last.res.statusCode === 429 && last.json.error === 'rate_limited', '11th send from one IP in a day -> 429');

  /* mail failure surfaces as an error, not a fake success */
  failResend = true;
  r = await run({ email: 'redacted@example.invalid', hashes: ['0a1b2c3d'] }, '203.0.113.8');
  ok(r.res.statusCode === 502 && r.json.error === 'send_failed', 'Resend failure -> 502 send_failed, never ok:true');
  failResend = false;

  /* missing config -> 503, so the client can fall back to Share */
  const savedKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  r = await run({ email: 'redacted@example.invalid', hashes: ['0a1b2c3d'] }, '203.0.113.9');
  ok(r.res.statusCode === 503 && r.json.error === 'not_configured', 'missing mail config -> 503 not_configured');
  process.env.RESEND_API_KEY = savedKey;

  console.log('list-sync: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) failures.forEach(f => console.log('  FAILED: ' + f));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
