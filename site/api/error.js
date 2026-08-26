/* POST /api/error - client-side JS error beacon, so breakage on real phones
 * is visible while everyone (including Joe) is on playa with no signal.
 * Privacy: message, script path, line, coarse UA, random client id. No IP
 * stored, no location, nothing linkable to a person. Heavily capped.
 */
'use strict';
const crypto = require('crypto');
const store = require('./_store.js');

const PER_IP_CAP = Number(process.env.GUIDE_ERROR_IP_CAP || 20); /* reports per IP per day */
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
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end();
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') { res.statusCode = 204; return res.end(); }

  const ip = clientIp(req);
  const ipKey = 'ge:ip:' + sha(ip);
  const n = Number(await store.get(ipKey)) || 0;
  if (n >= PER_IP_CAP) { res.statusCode = 204; return res.end(); }

  const row = {
    client_id: clean(body.id, 32),
    msg: clean(body.msg, 300),
    src: clean(body.src, 200),
    line: Number.isFinite(Number(body.line)) ? Number(body.line) : null,
    ua: clean(body.ua, 120)
  };
  if (!row.msg) { res.statusCode = 204; return res.end(); }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    try {
      await fetch(url.replace(/\/$/, '') + '/rest/v1/guide_errors', {
        method: 'POST',
        signal: ac.signal,
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify([row])
      });
      await store.incrBy(ipKey, 1, DAY);
    } catch (e) { /* error reporting must never itself error the client */ }
    finally { clearTimeout(timer); }
  }
  res.statusCode = 204;
  return res.end();
};
