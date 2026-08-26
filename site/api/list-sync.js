/* POST /api/list-sync - "Move to another device": email the user their own
 * starred list as a share link, and keep the email as an opt-in backup record.
 *
 * SECURITY MODEL (do not change without understanding this): the email is the
 * TRANSPORT, never a lookup key. This endpoint NEVER returns a stored list to
 * anyone. If typing an email retrieved a list, anyone could type YOUR email
 * and read YOUR plans for the week. Instead the list is sent TO the inbox, so
 * possession of the inbox is the only authentication and the only disclosure
 * path. The response body is only {ok:true} or {error:'...'}: no stored data,
 * no echo of other people's emails, ever.
 *
 * Storage: Supabase table guide_list_backups, upsert on email (latest list
 * wins). Mail: Resend. Both configured via env; without them the endpoint
 * answers 503 and the client falls back to plain Share.
 */
'use strict';
const crypto = require('crypto');
const store = require('./_store.js');

const GUIDE_URL = 'https://musecafe.vip/guide/';
const FROM = process.env.LIST_SYNC_FROM || 'Playa Guide <redacted@example.invalid>';
const PER_EMAIL_CAP = Number(process.env.LIST_SYNC_EMAIL_CAP || 3);    /* sends per email per day */
const PER_IP_CAP = Number(process.env.LIST_SYNC_IP_CAP || 10);         /* sends per IP per day */
const DAY = 86400;

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 24); }

function clientIp(req) {
  const xf = (req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'])) || '';
  const first = String(xf).split(',')[0].trim();
  return first || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function validEmail(e) {
  if (typeof e !== 'string') return false;
  const t = e.trim();
  if (t.length < 6 || t.length > 254) return false;
  return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}$/.test(t);
}

function validHashes(h) {
  if (!Array.isArray(h) || h.length === 0 || h.length > 120) return false;
  /* the whole list payload stays small: refuse anything over 1000 chars */
  if (JSON.stringify(h).length > 1000) return false;
  for (let i = 0; i < h.length; i++) {
    if (typeof h[i] !== 'string' || !/^[0-9a-f]{8}$/.test(h[i])) return false;
  }
  return true;
}

function cleanText(s, max) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[\r\n\t]/g, ' ').trim().slice(0, max || 60);
  return t || null;
}

function emailBody(link, name) {
  const hi = name ? 'Hey ' + name + ',' : 'Hey,';
  return [
    hi,
    '',
    'Here is your Playa Guide list.',
    '',
    'Open this link on your other phone and tap Merge. Everything you starred comes across:',
    '',
    link,
    '',
    'Once the page has loaded it works with no signal at all.',
    '',
    'See you out there.',
    'Joe, Muse Cafe, 8:15 & E'
  ].join('\n');
}

async function saveRow(email, name, camp, hashes) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, reason: 'not_configured' };
  const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/guide_list_backups?on_conflict=email', {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify([{ email: email, name: name, camp: camp, list: hashes }])
  });
  if (!r.ok) {
    /* log status only; never log the email address */
    console.error('list-sync: supabase write failed ' + r.status);
    return { ok: false, reason: 'store_failed' };
  }
  return { ok: true };
}

async function sendMail(email, link, name) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, reason: 'not_configured' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: 'Your Playa Guide list',
      text: emailBody(link, name)
    })
  });
  if (!r.ok) {
    console.error('list-sync: resend send failed ' + r.status);
    return { ok: false, reason: 'send_failed' };
  }
  return { ok: true };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'method_not_allowed' }));
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'bad_request' }));
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!validEmail(email)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'bad_email' }));
  }
  if (!validHashes(body.hashes)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'bad_list' }));
  }
  const name = cleanText(body.name, 40);
  const camp = cleanText(body.camp, 60);

  /* rate limits: 3 per email per day, 10 per IP per day */
  const ip = clientIp(req);
  const nEmail = await store.incrBy('ls:e:' + sha(email), 1, DAY);
  const nIp = await store.incrBy('ls:ip:' + sha(ip), 1, DAY);
  if (nEmail > PER_EMAIL_CAP || nIp > PER_IP_CAP) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: 'rate_limited' }));
  }

  const link = GUIDE_URL + '#l=' + body.hashes.join(',');

  const saved = await saveRow(email, name, camp, body.hashes);
  const sent = await sendMail(email, link, name);
  if (!sent.ok) {
    res.statusCode = sent.reason === 'not_configured' ? 503 : 502;
    return res.end(JSON.stringify({ error: sent.reason }));
  }
  /* a failed store with a successful send is still a success for the user;
     log it (status only) and move on. */
  if (!saved.ok) console.error('list-sync: row not stored (' + saved.reason + ')');

  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true }));
};
