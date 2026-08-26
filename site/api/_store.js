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
    fs.writeFile(FILE, JSON.stringify(obj), () => {});
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
    catch (e) {}
  }
  return localGet(key);
}

async function set(key, value, ttlSec) {
  if (backendName === 'upstash') {
    try {
      await up('/set/' + encodeURIComponent(key) + '?EX=' + (ttlSec || 3600),
        { method: 'POST', body: String(value) });
      return;
    } catch (e) {}
  }
  localSet(key, value, ttlSec);
}

async function incrBy(key, delta, ttlSec) {
  if (backendName === 'upstash') {
    try {
      const n = await up('/incrbyfloat/' + encodeURIComponent(key) + '/' + delta, { method: 'POST' });
      try { await up('/expire/' + encodeURIComponent(key) + '/' + (ttlSec || 3600), { method: 'POST' }); } catch (e) {}
      return Number(n);
    } catch (e) {}
  }
  const cur = Number(localGet(key) || 0);
  const next = cur + Number(delta);
  localSet(key, next, ttlSec);
  return next;
}

module.exports = { get, set, incrBy, backendName };
