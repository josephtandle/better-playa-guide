/* POST /api/query - anonymous query logging so the guide can get better.
 * Privacy: stores ONLY {timestamp, playa day, query text, result count}.
 * No client id, no IP kept, nothing linkable to a person. Text is scrubbed
 * of anything that looks like contact info and hard-capped at 120 chars.
 */
'use strict';
const crypto = require('crypto');
const store = require('./_store.js');

function clientIp(req) {
  const real = (req.headers && req.headers['x-real-ip']) || '';
  if (String(real).trim()) return String(real).trim();
  const xf = (req.headers && (req.headers['x-forwarded-for'] || '')) || '';
  const parts = String(xf).split(',');
  return parts[parts.length - 1].trim() || 'unknown';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); return res.end(); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const raw = body && typeof body.q === 'string' ? body.q : '';
  const q = raw.replace(/https?:\S+|\S+@\S+|[+]?\d[\d ()-]{7,}\d/g, '').replace(/[\r\n\t<>]/g, ' ').trim().slice(0, 120);
  if (q.length < 2) { res.statusCode = 204; return res.end(); }

  const ipKey = 'gq:ip:' + crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 24);
  if (!(await store.rateHit(ipKey, 300, 86400))) { res.statusCode = 204; return res.end(); }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const day = new Date(Date.now() - 7 * 3600 * 1000).toISOString().slice(0, 10);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    try {
      await fetch(url.replace(/\/$/, '') + '/rest/v1/guide_queries', {
        method: 'POST',
        signal: ac.signal,
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify([{ day: day, q: q, results: Math.min(9999, Math.max(-1, Number(body.n) === 0 ? 0 : Number(body.n) || -1)) }])
      });
    } catch (e) { /* logging must never break anything */ }
    finally { clearTimeout(timer); }
  }
  res.statusCode = 204;
  return res.end();
};
