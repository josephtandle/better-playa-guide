/* GET /api/stats - public, cached counters for the guide's value line.
 * Returns only aggregate numbers, nothing personal: total distinct devices
 * that have ever opened the guide (from the anonymous daily ping).
 */
'use strict';

let cache = { at: 0, body: null };

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=600');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end(JSON.stringify({ error: 'method_not_allowed' }));
  }
  if (cache.body && Date.now() - cache.at < 10 * 60 * 1000) {
    res.statusCode = 200;
    return res.end(cache.body);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  let devices = null;
  if (url && key) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    try {
      /* distinct devices, not device-days: counted in SQL so the number
         stays honest as people come back day after day */
      const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/guide_device_count', {
        signal: ac.signal,
        method: 'POST',
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: '{}'
      });
      const n = Number(await r.text());
      if (r.ok && isFinite(n) && n >= 0) devices = n;
    } catch (e) { /* stats are best-effort */ }
    finally { clearTimeout(timer); }
  }
  const body = JSON.stringify({ devices: devices });
  if (devices !== null) cache = { at: Date.now(), body: body };
  res.statusCode = 200;
  return res.end(body);
};
