/* Rate limiter contract tests (offline: no Supabase env, exercises the local
 * fallback path and the fail-closed contract; the Postgres path is verified
 * live post-deploy by scripts and the health watcher).
 * Run: node test/rate-limit.test.js
 */
'use strict';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SECRET_KEY = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
const assert = require('assert');
const store = require('../api/_store.js');

let passed = 0; const failures = [];
function ok(cond, name) { if (cond) passed++; else failures.push(name); }

(async () => {
  const K = 'test:rl:' + Date.now() + ':' + Math.random().toString(36).slice(2);

  /* 1. fail-open local fallback: exact cap, no off-by-one */
  const seq = [];
  for (let i = 0; i < 5; i++) seq.push(await store.rateHit(K, 3, 60));
  ok(JSON.stringify(seq) === JSON.stringify([true, true, true, false, false]),
    'cap 3 allows exactly 3 hits then denies (got ' + JSON.stringify(seq) + ')');

  /* 2. independent keys do not share buckets */
  ok(await store.rateHit(K + ':other', 1, 60) === true, 'a different key has its own bucket');
  ok(await store.rateHit(K + ':other', 1, 60) === false, 'and its own cap');

  /* 3. fail-closed contract: with NO backend configured (tests/dev) the local
     counter applies; with a configured-but-unreachable backend it denies */
  ok(await store.rateHit(K + ':closed', 100, 60, 'closed') === true,
    "failMode 'closed' with no backend configured falls back to the local counter");
  process.env.SUPABASE_URL = 'https://127.0.0.1:1'; /* configured but unreachable */
  process.env.SUPABASE_SECRET_KEY = 'x';
  ok(await store.rateHit(K + ':closed2', 100, 2, 'closed') === false,
    "failMode 'closed' denies when the configured global limiter is unreachable");
  ok(await store.rateHit(K + ':open2', 3, 2) === true,
    "default fail-open still allows via local counter when backend unreachable");
  process.env.SUPABASE_URL = ''; process.env.SUPABASE_SECRET_KEY = '';

  /* 4. refund gives a hit back on the local path */
  const K2 = K + ':refund';
  await store.rateHit(K2, 2, 60); await store.rateHit(K2, 2, 60);
  ok(await store.rateHit(K2, 2, 60) === false, 'refund setup: cap reached');
  await store.rateRefund(K2);
  ok(await store.rateHit(K2, 2, 60) === true, 'after a refund one more hit is allowed');

  /* 5. concurrency on the local path never exceeds cap by more than instance semantics allow */
  const K3 = K + ':burst';
  const burst = await Promise.all(Array.from({ length: 20 }, () => store.rateHit(K3, 5, 60)));
  const allowed = burst.filter(Boolean).length;
  ok(allowed === 5, 'a 20-parallel burst on one instance allows exactly the cap (got ' + allowed + ')');

  /* 6. endpoints actually use rateHit (regression: no check-then-act left) */
  const fs = require('fs');
  for (const f of ['submit.js', 'list-sync.js', 'list-pdf.js', 'list-ics.js', 'ping.js']) {
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'api', f), 'utf8');
    ok(/rateHit\(/.test(src), f + ' uses the atomic rateHit');
    ok(!/Number\(await store\.get\([a-zA-Z]*[Kk]ey\)\)\s*\|\|\s*0/.test(src),
      f + ' has no read-then-act quota check left');
  }
  /* list-sync must reserve email quota fail-closed and refund on failed send */
  const ls = fs.readFileSync(require('path').join(__dirname, '..', 'api', 'list-sync.js'), 'utf8');
  ok(/rateHit\(emailKey[^)]*'closed'\)/.test(ls), 'email quota is fail-closed');
  ok(/rateRefund\(emailKey\)/.test(ls), 'failed sends refund the email quota');

  /* 7. list-sync refunds the email reservation when the IP cap denies */
  ok(/okEmail && !okIp[\s\S]{0,80}rateRefund\(emailKey\)/.test(ls),
    'IP-cap denial refunds the email reservation (camp-wifi fairness)');
  /* 8. submit refunds on store failure and preflights config before reserving */
  const sub = fs.readFileSync(require('path').join(__dirname, '..', 'api', 'submit.js'), 'utf8');
  ok(sub.indexOf('not_configured') < sub.indexOf('rateHit('), 'submit checks config BEFORE reserving quota');
  ok(/store_failed[\s\S]{0,200}rateRefund|rateRefund[\s\S]{0,200}store_failed/.test(sub), 'submit refunds quota on store failure');
  /* 9. the store refund treats only 2xx as success and has an Upstash branch */
  const st = fs.readFileSync(require('path').join(__dirname, '..', 'api', '_store.js'), 'utf8');
  ok(/async function rateRefund[\s\S]{0,700}r\.ok/.test(st), 'refund only trusts an ok response');
  ok(/decrby/.test(st), 'refund has an Upstash decrement branch');
  /* 10. the SQL contract ships in-repo and the deploy gate smoke-checks it live */
  ok(fs.existsSync(require('path').join(__dirname, '..', 'db', 'rate-limit.sql')), 'db/rate-limit.sql is in the repo');
  const dep = fs.readFileSync(require('path').join(__dirname, '..', 'scripts', 'deploy.sh'), 'utf8');
  ok(/smoke-rate-limit\.js/.test(dep), 'deploy.sh runs the live RPC smoke check');

  console.log('rate-limit: ' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) { failures.forEach(f => console.error('  FAILED: ' + f)); process.exit(1); }
})();
