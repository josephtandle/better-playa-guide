/* GET /api/list-pdf?l=<hash,hash,...>[&name=First]
 * Returns the starred list as a clean printable PDF, for the old-school
 * crowd who want paper. Same #l= hashes as the share link, so the button in
 * My Events and the emailed link both work. No storage, no lookup by email:
 * the caller supplies the hashes, the server only renders them.
 */
'use strict';
const crypto = require('crypto');
const store = require('./_store.js');
const { loadGuide } = require('./_guide.js');
const { buildListPdf, buildHashIndex, eventsToRows } = require('./_pdf.js');

const PER_IP_CAP = Number(process.env.LIST_PDF_IP_CAP || 60); /* renders per IP per day */
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
  const name = typeof q.name === 'string' ? q.name.replace(/[\r\n\t]/g, ' ').trim().slice(0, 40) : '';

  const ip = clientIp(req);
  const ipKey = 'lp:ip:' + sha(ip);
  const nIp = Number(await store.get(ipKey)) || 0;
  if (nIp >= PER_IP_CAP) {
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

  const rows = eventsToRows(events);
  const pdf = buildListPdf(rows, { name: name || null });
  await store.incrBy(ipKey, 1, DAY);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="playa-guide-list.pdf"');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(pdf);
};
