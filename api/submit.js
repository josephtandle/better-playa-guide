/* POST /api/submit - community event submissions, for after Joe goes
 * offline. Stored in Supabase guide_submissions for review + ingest by the
 * home automation; never published directly (spam and injection safety).
 * Heavily capped; nothing personal required.
 */
'use strict';
const crypto = require('crypto');
const store = require('./_store.js');

const PER_IP_CAP = Number(process.env.GUIDE_SUBMIT_IP_CAP || 10); /* per day */
const DAY = 86400;

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 24); }
function clientIp(req) {
  const real = (req.headers && req.headers['x-real-ip']) || '';
  if (String(real).trim()) return String(real).trim();
  const xf = (req.headers && (req.headers['x-forwarded-for'] || '')) || '';
  const parts = String(xf).split(',');
  return parts[parts.length - 1].trim() || 'unknown';
}
function clean(s, max) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[\r\n\t]/g, ' ').trim().slice(0, max);
  return t || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end(JSON.stringify({ error: 'method_not_allowed' }));
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'bad_request' }));
  }

  const rawBlock = clean(body.text, 6000);
  /* optional flyer photo: small data-URL jpeg/png/webp, downscaled client-side */
  let image = null;
  if (typeof body.image === 'string') {
    const m = body.image.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    let buf = null;
    if (m && m[2].length <= 3500000) {
      try { buf = Buffer.from(m[2], 'base64'); } catch (e) { buf = null; }
    }
    const magicOk = buf && buf.length > 16 && buf.length <= 2600000 && (
      (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) ||                       /* jpeg */
      (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) ||    /* png */
      (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    );
    if (!magicOk) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'bad_image' }));
    }
    image = body.image;
  }
  const row = {
    image: image,
    raw: rawBlock,
    title: clean(body.title, 120) || (rawBlock ? rawBlock.slice(0, 120) : null),
    camp: clean(body.camp, 80),
    address: clean(body.address, 40),
    day: clean(body.day, 5),
    start_hm: clean(body.start, 5),
    end_hm: clean(body.end, 5),
    who: clean(body.who, 300),
    note: clean(body.note, 500),
    contact: clean(body.contact, 120),
    client_id: clean(body.id, 32)
  };
  if (!row.title && !row.raw && !row.image) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'text_required' }));
  }
  if (!row.title && row.image) row.title = '(flyer photo)';

  const ip = clientIp(req);
  const ipKey = 'gs:ip:' + sha(ip);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: 'not_configured' }));
  }
  /* atomic reserve (Postgres) so parallel posts cannot slip past the cap */
  if (!(await store.rateHit(ipKey, PER_IP_CAP, DAY))) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: 'rate_limited' }));
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6000);
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/guide_submissions', {
      method: 'POST',
      signal: ac.signal,
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify([row])
    });
    if (!r.ok) {
      console.error('submit: store failed ' + r.status);
      try { await store.rateRefund(ipKey); } catch (e) {}
      res.statusCode = 502;
      return res.end(JSON.stringify({ error: 'store_failed' }));
    }
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    try { await store.rateRefund(ipKey); } catch (e2) {}
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: 'store_failed' }));
  } finally { clearTimeout(timer); }
};
