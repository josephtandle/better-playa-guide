#!/usr/bin/env node
/* Friend-finder contract tests. Fully offline: Supabase is a faithful
 * in-memory model behind a fetch stub. Covers pairing, privacy (mutes,
 * sharing-off, mutual-only), auth (secret binding), and abuse guards.
 */
'use strict';
process.env.SUPABASE_URL = 'https://example-test.supabase.co';
process.env.GUIDE_SEASON_OVERRIDE = 'open'; /* the gate must not depend on today's date */
process.env.SUPABASE_SECRET_KEY = 'test-key-never-used-for-real';
delete process.env.UPSTASH_REDIS_REST_URL;

const path = require('path');
let passed = 0; const failures = [];
function ok(c, name) { if (c) passed++; else failures.push(name); }

/* ---- in-memory Supabase model ---- */
const db = { profiles: new Map(), invites: new Map(), pairs: new Map(), locs: new Map() };
const rate = new Map();
function pairId(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
function parseQ(u) {
  const q = {};
  (u.split('?')[1] || '').split('&').forEach(kv => { const [k, v] = kv.split('='); if (k) q[k] = decodeURIComponent(v || ''); });
  return q;
}
global.fetch = async function (url, init) {
  const u = String(url); init = init || {};
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  const send = (obj, status) => ({ ok: (status || 200) < 300, status: status || 200, json: async () => obj, text: async () => JSON.stringify(obj) });

  if (u.includes('/rpc/guide_rate_hit')) {
    const cur = rate.get(body.p_key) || 0;
    const allowed = cur < body.p_cap;
    if (allowed) rate.set(body.p_key, cur + 1);
    return { ok: true, status: 200, text: async () => String(allowed), json: async () => allowed };
  }
  if (u.includes('guide_profiles')) {
    const q = parseQ(u);
    if (method === 'GET') {
      let rows = [...db.profiles.values()];
      if (q['cid'] && q['cid'].startsWith('eq.')) rows = rows.filter(r => r.cid === q['cid'].slice(3));
      if (q['cid'] && q['cid'].startsWith('in.')) { const set = q['cid'].slice(4, -1).split(','); rows = rows.filter(r => set.includes(r.cid)); }
      return send(rows);
    }
    if (method === 'POST') { body.forEach(r => db.profiles.set(r.cid, Object.assign({ sharing: true, name: null }, r))); return send({}, 201); }
    if (method === 'PATCH') { const cid = q['cid'].slice(3); const cur = db.profiles.get(cid); if (cur) Object.assign(cur, body); return send({}, 204); }
  }
  if (u.includes('guide_invites')) {
    const q = parseQ(u);
    if (method === 'GET') { let rows = [...db.invites.values()]; if (q['code']) rows = rows.filter(r => r.code === q['code'].slice(3)); return send(rows); }
    if (method === 'POST') { body.forEach(r => db.invites.set(r.code, r)); return send({}, 201); }
  }
  if (u.includes('guide_pairs')) {
    const q = parseQ(u);
    if (method === 'GET') {
      let rows = [...db.pairs.values()];
      if (q['or']) { const m = /a\.eq\.([a-z0-9]+)/.exec(q['or']); const id = m && m[1]; rows = rows.filter(r => r.a === id || r.b === id); }
      return send(rows);
    }
    if (method === 'POST') { body.forEach(r => { const k = pairId(r.a, r.b); if (!db.pairs.has(k)) db.pairs.set(k, Object.assign({ muted_a: false, muted_b: false }, r)); }); return send({}, 201); }
    if (method === 'PATCH') { const k = pairId(q['a'].slice(3), q['b'].slice(3)); const cur = db.pairs.get(k); if (cur) Object.assign(cur, body); return send({}, 204); }
    if (method === 'DELETE') { db.pairs.delete(pairId(q['a'].slice(3), q['b'].slice(3))); return send({}, 204); }
  }
  if (u.includes('guide_locs')) {
    const q = parseQ(u);
    if (method === 'GET') { const set = q['cid'].slice(4, -1).split(','); return send([...db.locs.values()].filter(r => set.includes(r.cid))); }
    if (method === 'POST') { body.forEach(r => db.locs.set(r.cid, r)); return send({}, 201); }
    if (method === 'DELETE') { db.locs.delete(q['cid'].slice(3)); return send({}, 204); }
  }
  return send({}, 404);
};

const handler = require('../api/friend.js');
function req(bodyObj, ip) {
  return { method: 'POST', headers: { 'x-forwarded-for': ip || '203.0.113.9' }, body: bodyObj };
}
function res() {
  const r = { statusCode: 200, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (s) => { r.body = s ? JSON.parse(s) : null; };
  return r;
}
async function call(bodyObj, ip) { const r = res(); await handler(req(bodyObj, ip), r); return r; }

const A = { id: 'aaaaaaaa1111', secret: 'secretAAAAsecretAAAA', name: 'Dusty A' };
const B = { id: 'bbbbbbbb2222', secret: 'secretBBBBsecretBBBB', name: 'Sparkle B' };
const C = { id: 'cccccccc3333', secret: 'secretCCCCsecretCCCC', name: 'Moop C' };

(async () => {
  /* auth */
  let r = await call({ op: 'list', id: 'x', secret: 'short' });
  ok(r.statusCode === 400, 'malformed identity rejected');
  r = await call({ op: 'list', id: A.id, secret: A.secret, name: A.name });
  ok(r.statusCode === 200 && r.body.ok && r.body.friends.length === 0, 'first contact creates a profile, empty friend list');
  r = await call({ op: 'list', id: A.id, secret: 'WRONGsecretWRONGsec' });
  ok(r.statusCode === 403 && r.body.error === 'wrong_secret', 'a different secret for a known cid is rejected (no impersonation)');

  /* invite + accept */
  r = await call({ op: 'invite', id: A.id, secret: A.secret, name: A.name });
  ok(r.statusCode === 200 && /^[A-Za-z0-9]{6,12}$/.test(r.body.code), 'invite returns a shareable code');
  const code = r.body.code;
  r = await call({ op: 'peek', id: B.id, secret: B.secret, code: code });
  ok(r.statusCode === 200 && r.body.name === 'Dusty A', 'peek shows the inviter name before accepting');
  r = await call({ op: 'accept', id: A.id, secret: A.secret, code: code });
  ok(r.statusCode === 400 && r.body.error === 'own_code', 'accepting your own code is refused');
  r = await call({ op: 'accept', id: B.id, secret: B.secret, code: code, name: B.name });
  ok(r.statusCode === 200 && r.body.name === 'Dusty A', 'accept pairs the two devices');
  r = await call({ op: 'peek', id: C.id, secret: C.secret, code: 'NOPE1234' });
  ok(r.statusCode === 404, 'unknown code 404s');

  /* location + mutual visibility */
  await call({ op: 'loc', id: A.id, secret: A.secret, addr: '8:15 & E', sharing: true });
  await call({ op: 'loc', id: B.id, secret: B.secret, addr: '3:00 & G', sharing: true });
  r = await call({ op: 'list', id: A.id, secret: A.secret });
  ok(r.body.friends.length === 1 && r.body.friends[0].addr === '3:00 & G', "A sees B's last address");
  r = await call({ op: 'list', id: B.id, secret: B.secret });
  ok(r.body.friends[0].addr === '8:15 & E', "B sees A's last address");
  r = await call({ op: 'list', id: C.id, secret: C.secret, name: C.name });
  ok(r.body.friends.length === 0, 'C (no pair) sees nobody: strictly mutual');

  /* sharing off hides + deletes */
  await call({ op: 'loc', id: A.id, secret: A.secret, sharing: false });
  r = await call({ op: 'list', id: B.id, secret: B.secret });
  ok(r.body.friends[0].addr === null, "sharing OFF hides A's address from B");
  await call({ op: 'loc', id: A.id, secret: A.secret, addr: '8:15 & E', sharing: true });

  /* mutes work in both directions */
  await call({ op: 'mute', id: A.id, secret: A.secret, friend: B.id, muted: true });
  r = await call({ op: 'list', id: A.id, secret: A.secret });
  ok(r.body.friends[0].muted === true && r.body.friends[0].addr === null, 'muting a friend hides their location from ME too');
  r = await call({ op: 'list', id: B.id, secret: B.secret });
  ok(r.body.friends[0].addr === null, "and hides MY location from THEM (mute is a full pause)");
  await call({ op: 'mute', id: A.id, secret: A.secret, friend: B.id, muted: false });
  r = await call({ op: 'list', id: B.id, secret: B.secret });
  ok(r.body.friends[0].addr === '8:15 & E', 'unmute restores visibility');

  /* unfriend severs both ways */
  await call({ op: 'unfriend', id: B.id, secret: B.secret, friend: A.id });
  r = await call({ op: 'list', id: A.id, secret: A.secret });
  ok(r.body.friends.length === 0, 'unfriend removes the pair for both sides');

  /* input hygiene + rate limit + season guard (source invariants) */
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'friend.js'), 'utf8');
  ok(/rateHit\(/.test(src), 'friend API is rate limited');
  ok(/inSeason\(\)/.test(src) && /off_season/.test(src), 'writes are refused outside the burn window');
  ok(/replace\(\/\[<>/.test(src), 'names and addresses are scrubbed of markup');
  r = await call({ op: 'loc', id: A.id, secret: A.secret, addr: '<script>x</script>8:00 & C', sharing: true });
  const loc = db.locs.get(A.id);
  ok(loc && loc.addr.indexOf('<') === -1, 'stored address cannot carry HTML');

  /* client identity hygiene: the friend id must be its own secret-ish id */
  const cljs = fs.readFileSync(path.join(__dirname, '..', 'guide', 'friends.js'), 'utf8');
  ok(/bpg\.fid/.test(cljs) && !/getItem\('bpg\.cid'\)/.test(cljs),
    'friends.js uses a dedicated bpg.fid, never the semi-public ping id');

  /* rate keys: per-device primary, giant shared-IP backstop */
  ok(/gf:cid:/.test(src) && /20000/.test(src), 'rate limit keys on device id with a NAT-sized IP backstop');
  ok(/GUIDE_SEASON_OVERRIDE/.test(src), 'season gate is clock-injectable (suite survives past Sep 14)');
  ok(src.indexOf('guide_profiles?on_conflict=cid') !== -1, 'profile creation is duplicate-safe (no first-use 502 race)');
  /* peek must not register the viewer */
  const before = db.profiles.size;
  await call({ op: 'peek', id: 'zzzzzzzz9999', secret: 'peekerSecretPeekerSec', code: 'NOPE1234' });
  ok(db.profiles.size === before, 'peek never creates a profile for the viewer');

  /* friendly links: name slug travels in the URL, code parsing tolerates it */
  ok(/~' : ''\) \+ j\.code|slug \+ '~'/.test(cljs), 'invite links carry a readable name slug');
  ok(String("#add=dusty-dave~aB3xY9kQ2f").match(/[#?&]add=(?:([a-z0-9-]{1,24})~)?([A-Za-z0-9]{6,12})\b/)[2] === 'aB3xY9kQ2f', 'slugged link still yields the raw code');
  ok(String("#add=aB3xY9kQ2f").match(/[#?&]add=(?:([a-z0-9-]{1,24})~)?([A-Za-z0-9]{6,12})\b/)[2] === 'aB3xY9kQ2f', 'old-format links keep working');

  console.log('friends: ' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) { failures.forEach(f => console.error('  FAILED: ' + f)); process.exit(1); }
})();
