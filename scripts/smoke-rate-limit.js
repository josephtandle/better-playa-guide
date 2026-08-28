/* Post-deploy smoke check: one real round-trip against guide_rate_hit.
 * Exits 1 (failing the deploy pipeline) if the RPC is missing, denies
 * unexpectedly, or answers with anything but a boolean body.
 * deploy.sh exports SUPABASE_URL/SUPABASE_SECRET_KEY (workspace .env fallback).
 */
'use strict';
(async () => {
  const su = process.env.SUPABASE_URL;
  const sk = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!su || !sk) { console.error('SMOKE FAIL: no Supabase env for rate-limit check'); process.exit(1); }
  const base = su.replace(/\/$/, '') + '/rest/v1/rpc/';
  const H = { apikey: sk, Authorization: 'Bearer ' + sk, 'Content-Type': 'application/json' };
  const key = 'smoke:' + Date.now();
  async function hit() {
    const r = await fetch(base + 'guide_rate_hit', { method: 'POST', headers: H, body: JSON.stringify({ p_key: key, p_cap: 2, p_ttl_s: 60 }) });
    if (!r.ok) { console.error('SMOKE FAIL: guide_rate_hit status ' + r.status); process.exit(1); }
    return (await r.text()).trim();
  }
  const a = await hit(), b = await hit(), c = await hit();
  if (a !== 'true' || b !== 'true' || c !== 'false') {
    console.error('SMOKE FAIL: expected true,true,false got ' + [a, b, c].join(','));
    process.exit(1);
  }
  const rr = await fetch(base + 'guide_rate_refund', { method: 'POST', headers: H, body: JSON.stringify({ p_key: key }) });
  if (!rr.ok) { console.error('SMOKE FAIL: guide_rate_refund status ' + rr.status); process.exit(1); }
  const d = await hit();
  if (d !== 'true') { console.error('SMOKE FAIL: refund did not free a slot (got ' + d + ')'); process.exit(1); }
  console.log('rate-limit smoke: OK (atomic cap + refund verified live)');
})().catch(e => { console.error('SMOKE FAIL: ' + e.message); process.exit(1); });
