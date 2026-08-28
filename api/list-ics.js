/* GET /api/list-ics?l=<hash,hash,...>
 * The starred list as a live calendar feed. Google Calendar subscribes to it
 * via "from URL" and iPhone via webcal://, so one tap adds a "My Playa
 * Guide" calendar with every starred event: no file juggling.
 */
'use strict';
const crypto = require('crypto');
const store = require('./_store.js');
const { loadGuide } = require('./_guide.js');
const { buildHashIndex } = require('./_pdf.js');
const { buildListIcs } = require('./_ics.js');

const PER_IP_CAP = Number(process.env.LIST_ICS_IP_CAP || 300); /* calendar apps re-poll; be generous */
const DAY = 86400;

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 24); }

function clientIp(req) {
  const real = (req.headers && req.headers['x-real-ip']) || '';
  if (String(real).trim()) return String(real).trim();
  const xf = (req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'])) || '';
  const parts = String(xf).split(',');
  const last = parts[parts.length - 1].trim();
  return last || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function parseHashes(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 1200) return null;
  const parts = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0 || parts.length > 120) return null;
  for (const p of parts) { if (!/^[0-9a-f]{8}$/.test(p)) return null; }
  return parts;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'method_not_allowed' }));
  }

  const q = (req.query && typeof req.query === 'object') ? req.query : {};
  const hashes = parseHashes(String(q.l || ''));
  if (!hashes) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'bad_list' }));
  }

  const ip = clientIp(req);
  const ipKey = 'li:ip:' + sha(ip);
  if (!(await store.rateHit(ipKey, PER_IP_CAP, DAY))) {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'rate_limited' }));
  }

  const G = loadGuide();
  const byHash = buildHashIndex(G.ev.e);
  const seen = new Set();
  const events = [];
  for (const h of hashes) {
    const e = byHash[h];
    if (e && !seen.has(e.id)) { seen.add(e.id); events.push(e); }
  }
  if (events.length === 0) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'no_events' }));
  }

  const ics = buildListIcs(events);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="my-playa-guide.ics"');
  /* let calendar pollers cache for an hour */
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.end(ics);
};
