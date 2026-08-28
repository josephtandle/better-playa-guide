/* Tiny async KV for the spend counter, the per-IP rate limiter and the answer cache.
 *
 * Without Upstash configured the counters live inside one lambda instance, so under
 * concurrency the effective daily cap is roughly (cap x number of warm instances).
 * Setting UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in the Vercel env vars
 * makes it globally exact with no code change.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const UP_URL = process.env.UPSTASH_REDIS_REST_URL;
const UP_TOK = process.env.UPSTASH_REDIS_REST_TOKEN;
const FILE = path.join(os.tmpdir(), 'bpg-ask-store.json');

let mem = new Map();
let fileOk = false;
try {
  if (fs.existsSync(FILE)) {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    Object.keys(raw).forEach(k => mem.set(k, raw[k]));
  }
  fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(mem)));
  fileOk = true;
} catch (e) { fileOk = false; }

const backendName = (UP_URL && UP_TOK) ? 'upstash' : (fileOk ? 'tmpfile' : 'memory');

function flush() {
  if (!fileOk) return;
  try {
    const obj = {};
    const now = Date.now();
    mem.forEach((v, k) => { if (!v || v.exp > now) obj[k] = v; });
    /* write-then-rename: a crash mid-write must not truncate the live file */
    const tmp = FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(obj), err => {
      if (err) return;
      fs.rename(tmp, FILE, () => {});
    });
  } catch (e) {}
}

function localGet(key) {
  const v = mem.get(key);
  if (!v) return null;
  if (v.exp && v.exp <= Date.now()) { mem.delete(key); return null; }
  return v.val;
}
function localSet(key, val, ttl) {
  mem.set(key, { val: String(val), exp: Date.now() + (ttl || 3600) * 1000 });
  if (mem.size > 5000) {
    const now = Date.now();
    mem.forEach((v, k) => { if (v.exp <= now) mem.delete(k); });
  }
  flush();
}

let upFailLogged = false;
function logUpFail(e) {
  if (upFailLogged) return;
  upFailLogged = true;
  console.error('[store] upstash unreachable, falling back to per-instance memory: ' + String(e && e.message).slice(0, 120));
}

async function up(pathPart, init) {
  const r = await fetch(UP_URL.replace(/\/$/, '') + pathPart, Object.assign({
    headers: { Authorization: 'Bearer ' + UP_TOK }
  }, init || {}));
  if (!r.ok) throw new Error('upstash ' + r.status);
  const j = await r.json();
  return j.result;
}

async function get(key) {
  if (backendName === 'upstash') {
    try { const v = await up('/get/' + encodeURIComponent(key)); return v === null || v === undefined ? null : String(v); }
    catch (e) { logUpFail(e); }
  }
  return localGet(key);
}

async function set(key, value, ttlSec) {
  if (backendName === 'upstash') {
    try {
      await up('/set/' + encodeURIComponent(key) + '?EX=' + (ttlSec || 3600),
        { method: 'POST', body: String(value) });
      return;
    } catch (e) { logUpFail(e); }
  }
  localSet(key, value, ttlSec);
}

async function incrBy(key, delta, ttlSec) {
  /* Redis rejects exponential notation ("1e-7"), which is exactly what tiny
     token costs stringify to. Always send a plain decimal. */
  const d = Number(delta) || 0;
  const deltaStr = d.toFixed(12).replace(/0+$/, '').replace(/\.$/, '') || '0';
  if (backendName === 'upstash') {
    try {
      const n = await up('/incrbyfloat/' + encodeURIComponent(key) + '/' + deltaStr, { method: 'POST' });
      /* NX: set the TTL only when the key has none, so a busy counter is not
         kept alive forever by its own increments */
      try { await up('/expire/' + encodeURIComponent(key) + '/' + (ttlSec || 3600) + '/NX', { method: 'POST' }); } catch (e) {}
      return Number(n);
    } catch (e) { logUpFail(e); }
  }
  const cur = Number(localGet(key)) || 0;
  const next = cur + d;
  localSet(key, next, ttlSec);
  return next;
}

/* Atomic rate limiter. Priority: Supabase Postgres RPC (globally atomic, no
 * extra infra) -> Upstash incr -> local counter (per-instance, last resort).
 * Returns true when the hit is ALLOWED. failMode 'closed' denies when no
 * global backend answered (for costly actions: email sends); default 'open'
 * falls back to the local counter (availability first). */
async function rateHit(key, cap, ttlSec, failMode) {
  const su = process.env.SUPABASE_URL;
  const sk = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (su && sk) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3500);
    try {
      const r = await fetch(su.replace(/\/$/, '') + '/rest/v1/rpc/guide_rate_hit', {
        method: 'POST',
        signal: ac.signal,
        headers: { apikey: sk, Authorization: 'Bearer ' + sk, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_key: key, p_cap: cap, p_ttl_s: ttlSec })
      });
      if (r.ok) {
        const txt = (await r.text()).trim();
        clearTimeout(timer);
        if (txt === 'true' || txt === 'false') return txt === 'true';
        console.error('rateHit: unexpected rpc body "' + txt.slice(0, 40) + '"');
      } else {
        console.error('rateHit: rpc status ' + r.status);
      }
    } catch (e) { console.error('rateHit: rpc unreachable: ' + e.message); } finally { clearTimeout(timer); }
  }
  if (backendName === 'upstash') {
    try {
      const n = await up('/incr/' + encodeURIComponent(key), { method: 'POST' });
      try { await up('/expire/' + encodeURIComponent(key) + '/' + (ttlSec || 3600) + '/NX', { method: 'POST' }); } catch (e) {}
      return Number(n) <= cap;
    } catch (e) { logUpFail(e); }
  }
  /* fail-closed applies only when a global backend IS configured but did not
     answer (suspicious infra state on a costly action). With none configured
     (local dev, tests) the local counter is the honest limiter. */
  if (failMode === 'closed' && (su && sk || backendName === 'upstash')) return false;
  const n2 = (Number(localGet(key)) || 0);
  if (n2 >= cap) return false;
  localSet(key, n2 + 1, ttlSec);
  return true;
}

/* undo one reserved hit after a failed downstream action (failed email etc.) */
async function rateRefund(key) {
  const su = process.env.SUPABASE_URL;
  const sk = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (su && sk) {
    try {
      const r = await fetch(su.replace(/\/$/, '') + '/rest/v1/rpc/guide_rate_refund', {
        method: 'POST',
        headers: { apikey: sk, Authorization: 'Bearer ' + sk, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_key: key })
      });
      if (r.ok) return;
      console.error('rateRefund: rpc status ' + r.status);
    } catch (e) { console.error('rateRefund: rpc unreachable: ' + e.message); }
  }
  if (backendName === 'upstash') {
    try {
      const n = await up('/decrby/' + encodeURIComponent(key) + '/1', { method: 'POST' });
      if (Number(n) < 0) { try { await up('/incrby/' + encodeURIComponent(key) + '/1', { method: 'POST' }); } catch (e2) {} }
      return;
    } catch (e) { logUpFail(e); }
  }
  const n = Number(localGet(key)) || 0;
  if (n > 0) localSet(key, n - 1, 86400);
}

module.exports = { get, set, incrBy, rateHit, rateRefund, backendName };
