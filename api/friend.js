/* POST /api/friend - the playa friend finder backend. One endpoint, op-based.
 *
 * Privacy model:
 * - Identity is a DEDICATED anonymous friend id (bpg.fid, never reused by
 *   pings or submissions) plus a device-held secret. First write stores sha256(secret); every later
 *   write must present the same secret. No accounts, no email, no phone.
 * - Friendships are MUTUAL and explicit: an invite code only creates a pair
 *   when the recipient taps "Add friend".
 * - Locations are the coarse playa address people typed (or derived), shared
 *   ONLY with mutual friends, only while sharing is on, only during the burn
 *   window. Locations auto-expire from responses outside the window.
 * - Friendships persist year to year; the season guard refuses location
 *   reads/writes outside the burn window, so stale addresses go dark.
 */
'use strict';
const crypto = require('crypto');
const store = require('./_store.js');

const DAY = 86400;
function sha(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function clientIp(req) {
  const real = (req.headers && req.headers['x-real-ip']) || '';
  if (String(real).trim()) return String(real).trim();
  const xf = (req.headers && (req.headers['x-forwarded-for'] || '')) || '';
  const parts = String(xf).split(',');
  return parts[parts.length - 1].trim() || 'unknown';
}
function validId(s) { return typeof s === 'string' && /^[a-z0-9]{8,32}$/.test(s); }
function validSecret(s) { return typeof s === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(s); }
function cleanName(s) { return (typeof s === 'string' ? s.replace(/[<>\r\n\t]/g, '').trim().slice(0, 40) : '') || null; }
function cleanAddr(s) { return (typeof s === 'string' ? s.replace(/[<>\r\n\t]/g, '').trim().slice(0, 60) : '') || null; }
function inSeason() {
  if (process.env.GUIDE_SEASON_OVERRIDE === 'open') return true;   /* tests + future seasons */
  if (process.env.GUIDE_SEASON_OVERRIDE === 'closed') return false;
  const now = Date.now();
  /* burn window + grace, any year: Aug 15 - Sep 20 */
  const d = new Date(now);
  const m = d.getUTCMonth(), day = d.getUTCDate();
  return (m === 7 && day >= 15) || (m === 8 && day <= 20);
}
function pairKey(x, y) { return x < y ? [x, y] : [y, x]; }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); return res.end(JSON.stringify({ error: 'method_not_allowed' })); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') { res.statusCode = 400; return res.end(JSON.stringify({ error: 'bad_request' })); }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'not_configured' })); }
  const base = url.replace(/\/$/, '') + '/rest/v1/';
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  async function sGet(pathQ) {
    const r = await fetch(base + pathQ, { headers: H });
    return r.ok ? r.json() : null;
  }
  async function sWrite(path, method, bodyObj, prefer) {
    const r = await fetch(base + path, { method: method, headers: Object.assign({ Prefer: prefer || 'return=minimal' }, H), body: JSON.stringify(bodyObj) });
    return r.ok;
  }

  const op = String(body.op || '');
  const id = body.id, secret = body.secret;
  if (!validId(id) || !validSecret(secret)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'bad_identity' })); }
  if (!inSeason() && op !== 'list') { res.statusCode = 403; return res.end(JSON.stringify({ error: 'off_season' })); }
  /* IP backstop first (NAT-sized for Center Camp wifi); the per-device cap is
     applied AFTER the secret verifies, so knowing someone's public-ish id is
     not enough to drain their bucket and lock them out of privacy controls */
  if (!(await store.rateHit('gf:ip:' + sha(clientIp(req)).slice(0, 24), 20000, DAY))) {
    res.statusCode = 429; return res.end(JSON.stringify({ error: 'rate_limited' }));
  }

  /* --- identity: create-or-verify. The first secret seen for a cid wins.
     Race-safe: the insert ignores duplicates (PK cid), then we re-read and
     verify, so two first-visit calls cannot 502 and cannot rebind. peek is
     read-only and never registers the viewer. --- */
  const hash = sha(secret);
  let prof = await sGet('guide_profiles?cid=eq.' + id + '&select=cid,secret_hash,name,sharing');
  if ((!prof || !prof.length) && op !== 'peek') {
    await sWrite('guide_profiles?on_conflict=cid', 'POST', [{ cid: id, secret_hash: hash, name: cleanName(body.name), sharing: false }], 'resolution=ignore-duplicates,return=minimal');
    prof = await sGet('guide_profiles?cid=eq.' + id + '&select=cid,secret_hash,name,sharing');
    if (!prof || !prof.length) { res.statusCode = 502; return res.end(JSON.stringify({ error: 'store_failed' })); }
  }
  if (prof && prof.length && prof[0].secret_hash !== hash) {
    res.statusCode = 403; return res.end(JSON.stringify({ error: 'wrong_secret' }));
  }
  if (!(await store.rateHit('gf:cid:' + id, 600, DAY))) {
    res.statusCode = 429; return res.end(JSON.stringify({ error: 'rate_limited' }));
  }
  const myName = cleanName(body.name) || (prof && prof[0] && prof[0].name) || 'A burner';
  if (cleanName(body.name) && prof && prof.length && prof[0].name !== cleanName(body.name)) {
    await sWrite('guide_profiles?cid=eq.' + id, 'PATCH', { name: cleanName(body.name), updated: new Date().toISOString() });
  }

  if (op === 'invite') {
    const code = crypto.randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) + crypto.randomBytes(2).toString('hex').slice(0, 2);
    const ok = await sWrite('guide_invites', 'POST', [{ code: code, cid: id }]);
    if (!ok) { res.statusCode = 502; return res.end(JSON.stringify({ error: 'store_failed' })); }
    res.statusCode = 200; return res.end(JSON.stringify({ ok: true, code: code, name: myName }));
  }

  if (op === 'peek') {
    /* who does this invite belong to? (shown before the recipient accepts) */
    const code = String(body.code || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
    const inv = await sGet('guide_invites?code=eq.' + code + '&select=code,cid');
    if (!inv || !inv.length) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'no_such_code' })); }
    const owner = await sGet('guide_profiles?cid=eq.' + inv[0].cid + '&select=name');
    res.statusCode = 200; return res.end(JSON.stringify({ ok: true, name: (owner && owner[0] && owner[0].name) || 'A burner' }));
  }

  if (op === 'accept') {
    const code = String(body.code || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
    const inv = await sGet('guide_invites?code=eq.' + code + '&select=code,cid,created');
    if (!inv || !inv.length) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'no_such_code' })); }
    /* codes are multi-use BY DESIGN (postable publicly), but they die with the
       season and cap out so a viral code cannot pair the whole city */
    /* a code only lives within the season it was minted in */
    const cy = new Date().getUTCFullYear();
    if (new Date(inv[0].created).getTime() < Date.UTC(cy, 7, 1)) { res.statusCode = 410; return res.end(JSON.stringify({ error: 'expired_code' })); }
    if (!(await store.rateHit('gfa:code:' + cy + ':' + code, 75, 60 * DAY))) { res.statusCode = 429; return res.end(JSON.stringify({ error: 'code_maxed' })); }
    const other = inv[0].cid;
    if (other === id) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'own_code' })); }
    const pk = pairKey(id, other);
    const okPair = await sWrite('guide_pairs?on_conflict=a,b', 'POST', [{ a: pk[0], b: pk[1] }], 'resolution=ignore-duplicates,return=minimal');
    if (!okPair) { res.statusCode = 502; return res.end(JSON.stringify({ error: 'store_failed' })); }
    const owner = await sGet('guide_profiles?cid=eq.' + other + '&select=name');
    res.statusCode = 200; return res.end(JSON.stringify({ ok: true, name: (owner && owner[0] && owner[0].name) || 'A burner' }));
  }

  if (op === 'loc') {
    const sharingOn = body.sharing !== false;
    const okShare = await sWrite('guide_profiles?cid=eq.' + id, 'PATCH', { sharing: sharingOn, updated: new Date().toISOString() });
    if (!okShare) { res.statusCode = 502; return res.end(JSON.stringify({ error: 'store_failed' })); }
    if (sharingOn && cleanAddr(body.addr)) {
      const ok = await sWrite('guide_locs?on_conflict=cid', 'POST', [{ cid: id, addr: cleanAddr(body.addr), at: new Date().toISOString() }], 'resolution=merge-duplicates,return=minimal');
      if (!ok) { res.statusCode = 502; return res.end(JSON.stringify({ error: 'store_failed' })); }
    }
    if (!sharingOn) {
      const rDel2 = await fetch(base + 'guide_locs?cid=eq.' + id, { method: 'DELETE', headers: H });
      if (!rDel2.ok) { res.statusCode = 502; return res.end(JSON.stringify({ error: 'store_failed' })); }
    }
    res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
  }

  if (op === 'mute') {
    const other = body.friend;
    if (!validId(other)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'bad_friend' })); }
    const pk = pairKey(id, other);
    const field = id === pk[0] ? 'muted_a' : 'muted_b';
    const patch = {}; patch[field] = body.muted === true;
    const okMute = await sWrite('guide_pairs?a=eq.' + pk[0] + '&b=eq.' + pk[1], 'PATCH', patch);
    if (!okMute) { res.statusCode = 502; return res.end(JSON.stringify({ error: 'store_failed' })); }
    res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
  }

  if (op === 'unfriend') {
    const other = body.friend;
    if (!validId(other)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'bad_friend' })); }
    const pk = pairKey(id, other);
    const rDel = await fetch(base + 'guide_pairs?a=eq.' + pk[0] + '&b=eq.' + pk[1], { method: 'DELETE', headers: H });
    if (!rDel.ok) { res.statusCode = 502; return res.end(JSON.stringify({ error: 'store_failed' })); }
    res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
  }

  if (op === 'list') {
    const pairs = await sGet('guide_pairs?or=(a.eq.' + id + ',b.eq.' + id + ')&select=a,b,muted_a,muted_b');
    if (!pairs) { res.statusCode = 502; return res.end(JSON.stringify({ error: 'store_failed' })); }
    const friends = [];
    for (const p of pairs) {
      const meIsA = p.a === id;
      const other = meIsA ? p.b : p.a;
      const iMuted = meIsA ? p.muted_a : p.muted_b;        /* I muted them */
      const theyMuted = meIsA ? p.muted_b : p.muted_a;     /* they muted me */
      friends.push({ cid: other, iMuted: !!iMuted, theyMuted: !!theyMuted });
    }
    if (!friends.length) { res.statusCode = 200; return res.end(JSON.stringify({ ok: true, friends: [] })); }
    const cids = friends.map(f => f.cid).join(',');
    const profs = await sGet('guide_profiles?cid=in.(' + cids + ')&select=cid,name,sharing') || [];
    const locs = inSeason() ? (await sGet('guide_locs?cid=in.(' + cids + ')&select=cid,addr,at') || []) : [];
    const pMap = {}, lMap = {};
    profs.forEach(p => { pMap[p.cid] = p; });
    locs.forEach(l => { lMap[l.cid] = l; });
    /* double-check: a mute/unfriend/sharing-off that landed while we were
       reading must win. Re-read the pair+profile state and intersect. */
    const pairs2 = await sGet('guide_pairs?or=(a.eq.' + id + ',b.eq.' + id + ')&select=a,b,muted_a,muted_b') || [];
    const still = {};
    pairs2.forEach(p3 => {
      const other2 = p3.a === id ? p3.b : p3.a;
      const iM = p3.a === id ? p3.muted_a : p3.muted_b;
      const tM = p3.a === id ? p3.muted_b : p3.muted_a;
      still[other2] = { iMuted: !!iM, theyMuted: !!tM };
    });
    const profs2 = await sGet('guide_profiles?cid=in.(' + cids + ')&select=cid,sharing') || [];
    const share2 = {};
    profs2.forEach(p4 => { share2[p4.cid] = p4.sharing !== false; });
    const out = friends.filter(f => still[f.cid]).map(f => {
      f.iMuted = still[f.cid].iMuted; f.theyMuted = still[f.cid].theyMuted;
      const p2 = pMap[f.cid] || {};
      /* their location is visible only if: they share, they haven't muted me, I haven't muted them */
      const showLoc = p2.sharing !== false && share2[f.cid] !== false && !f.theyMuted && !f.iMuted && lMap[f.cid];
      return {
        cid: f.cid,
        name: p2.name || 'A burner',
        muted: f.iMuted,
        addr: showLoc ? lMap[f.cid].addr : null,
        at: showLoc ? lMap[f.cid].at : null
      };
    });
    res.statusCode = 200; return res.end(JSON.stringify({ ok: true, friends: out }));
  }

  res.statusCode = 400; return res.end(JSON.stringify({ error: 'bad_op' }));
};
