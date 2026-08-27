/* POST /api/ping - anonymous usage counter, one row per device per day.
 * Privacy: stores ONLY {day, random client id, hit count}. No IP, no UA, no
 * email, no location, nothing linkable to a person. The client id is a
 * random token minted in the browser; clearing site data mints a new one.
 * The guide works fully offline; this fires only when there is signal.
 */
'use strict';
const crypto = require('crypto');
const store = require('./_store.js');

function validId(s) {
  return typeof s === 'string' && /^[a-z0-9]{8,32}$/.test(s);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end();
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const id = body && body.id;
  if (!validId(id)) { res.statusCode = 204; return res.end(); }

  /* per-IP daily cap: a device pings once a day, so allow a family of phones
     on one hotspot but stop scripted count-inflation */
  try {
    const xf = String((req.headers && (req.headers['x-real-ip'] || req.headers['x-forwarded-for'])) || 'unknown');
    const ipKey = 'gp:ip:' + crypto.createHash('sha256').update(xf).digest('hex').slice(0, 24);
    const n = Number(await store.get(ipKey)) || 0;
    if (n >= 25) { res.statusCode = 204; return res.end(); }
    await store.incrBy(ipKey, 1, 86400);
  } catch (e) { /* the counter must never break the guide */ }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const day = new Date(Date.now() - 7 * 3600 * 1000).toISOString().slice(0, 10); /* playa day, UTC-7 */
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    try {
      await fetch(url.replace(/\/$/, '') + '/rest/v1/guide_pings?on_conflict=day,client_id', {
        method: 'POST',
        signal: ac.signal,
        headers: {
          apikey: key,
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=minimal'
        },
        body: JSON.stringify([{ day: day, client_id: id }])
      });
    } catch (e) { /* counting must never break anything */ }
    finally { clearTimeout(timer); }
  }
  res.statusCode = 204;
  return res.end();
};
