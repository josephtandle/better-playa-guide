#!/usr/bin/env node
/* Better Playa Guide health watcher. Runs on the Studio via launchd every
 * 15 minutes while Joe is on playa with zero signal.
 *
 * Ladder (bounded, never an open loop):
 *   1 failing tick  -> record, stay quiet (transient)
 *   2 consecutive   -> Telegram alert + run self-heal (redeploy; if the
 *                      local tree is red, roll back to the last-green tag)
 *   after self-heal -> re-probe; report healed or STILL DOWN
 *   cooldown        -> at most one self-heal per 2 hours, alerts dedupe
 *
 * Also: new client JS errors from guide_errors -> alert once per distinct
 * message; daily 18:00 (Asia/Makassar) digest with usage + errors + status.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const WS = path.join(process.env.HOME || '/Users/myos', '.myos', 'workspace');
const STATE_PATH = path.join(__dirname, '..', 'data', 'guide-health-state.json');
const SELF_HEAL = path.join(__dirname, 'guide-self-heal.sh');
const BASE = 'https://musecafe.vip';

/* .env loader (launchd has no shell env) */
(function loadEnv(){
  try {
    const raw = fs.readFileSync(path.join(WS, '.env'), 'utf8');
    raw.split('\n').forEach(l => {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
  } catch (e) {}
})();

const { sendMessage, buildTelegramApiBase } = require(path.join(WS, 'agents', 'shared', 'telegram-send.js'));
const TG_API = buildTelegramApiBase(process.env.TELEGRAM_BOT_TOKEN);
const CHAT = process.env.TELEGRAM_CHAT_ID;

async function tg(text) {
  if (!TG_API || !CHAT) { console.error('tg not configured'); return; }
  try { await sendMessage(TG_API, CHAT, text); } catch (e) { console.error('tg send failed', e.message); }
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch (e) { return {}; }
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 1)); }

async function probe(name, fn) {
  try {
    const t0 = Date.now();
    await fn();
    return { name, ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { name, ok: false, err: String(e.message || e).slice(0, 200) };
  }
}
async function get(url, opts) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, Object.assign({ signal: ac.signal, cache: 'no-store' }, opts || {}));
    return r;
  } finally { clearTimeout(timer); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const KNOWN_HASH = '3f558f00'; /* Crazy Love & Mature Relationships: stable, dated */

async function runProbes() {
  const checks = [];
  checks.push(await probe('page', async () => {
    const r = await get(BASE + '/guide/');
    assert(r.status === 200, 'status ' + r.status);
    const t = await r.text();
    assert(t.indexOf('guide.js') !== -1 && t.indexOf('Better Playa Guide') !== -1, 'page marker missing');
  }));
  checks.push(await probe('data', async () => {
    const r = await get(BASE + '/guide/data.js');
    assert(r.status === 200, 'status ' + r.status);
    const t = await r.text();
    assert(t.length > 1000000, 'payload only ' + t.length + ' bytes');
    const g = JSON.parse(t.slice(t.indexOf('=') + 1).trim().replace(/;+$/, ''));
    assert(g.ev.e.length >= 3400, 'only ' + g.ev.e.length + ' events');
  }));
  checks.push(await probe('sw', async () => {
    const r = await get(BASE + '/guide/sw.js');
    assert(r.status === 200 && /bpg-v\d+/.test(await r.text()), 'sw bad');
  }));
  checks.push(await probe('ask', async () => {
    const r = await get(BASE + '/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'where is coffee on wednesday', loc: '6:00 & C' })
    });
    assert(r.status === 200, 'status ' + r.status);
    const j = await r.json();
    assert(j && (j.reply || j.answer || j.results), 'no answer shape');
  }));
  checks.push(await probe('pdf', async () => {
    const r = await get(BASE + '/api/list-pdf?l=' + KNOWN_HASH);
    assert(r.status === 200, 'status ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    assert(buf.slice(0, 5).toString() === '%PDF-', 'not a PDF');
  }));
  checks.push(await probe('ics', async () => {
    const r = await get(BASE + '/api/list-ics?l=' + KNOWN_HASH);
    assert(r.status === 200, 'status ' + r.status);
    assert((await r.text()).indexOf('BEGIN:VCALENDAR') === 0, 'not a calendar');
  }));
  checks.push(await probe('ping', async () => {
    const r = await get(BASE + '/api/ping', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'healthwatch01' })
    });
    assert(r.status === 204, 'status ' + r.status);
  }));
  return checks;
}

async function supa(pathQ) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const r = await get(url.replace(/\/$/, '') + pathQ, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  if (!r.ok) return null;
  return r.json();
}

async function newClientErrors(state) {
  const rows = await supa('/rest/v1/guide_errors?select=id,at,msg,src,line&order=id.desc&limit=25');
  if (!rows) return [];
  const lastSeen = state.lastErrorId || 0;
  const fresh = rows.filter(r => r.id > lastSeen);
  if (rows.length) state.lastErrorId = Math.max(lastSeen, rows[0].id);
  /* dedupe by message so one hot loop does not spam 25 alerts */
  const seen = new Set(state.alertedErrorMsgs || []);
  const novel = [];
  for (const r of fresh) {
    const k = (r.msg || '').slice(0, 120);
    if (seen.has(k)) continue;
    seen.add(k);
    novel.push(r);
  }
  state.alertedErrorMsgs = Array.from(seen).slice(-100);
  return novel;
}

async function dailyDigest(state) {
  /* fire once per day after 18:00 Asia/Makassar (UTC+8) */
  const nowUtc8 = new Date(Date.now() + 8 * 3600 * 1000);
  const day = nowUtc8.toISOString().slice(0, 10);
  if (nowUtc8.getUTCHours() < 18 || state.lastDigestDay === day) return;
  state.lastDigestDay = day;
  const pings = await supa('/rest/v1/guide_pings?select=day,client_id');
  const errs = await supa('/rest/v1/guide_errors?select=id');
  let usage = 'usage unknown';
  if (pings) {
    const byDay = {};
    pings.forEach(p => { byDay[p.day] = (byDay[p.day] || 0) + 1; });
    const days = Object.keys(byDay).sort().slice(-3);
    usage = days.map(d => d.slice(5) + ': ' + byDay[d]).join(', ') + ' devices; ' +
      new Set(pings.map(p => p.client_id)).size + ' total';
  }
  await tg('🏜 Playa Guide daily: all checks ' + (state.consecFails ? 'DEGRADED (' + state.consecFails + ' failing ticks)' : 'green') +
    '. ' + usage + '. Client errors ever: ' + (errs ? errs.length : '?') + '.');
}

(async function main(){
  const state = loadState();
  const checks = await runProbes();
  const failed = checks.filter(c => !c.ok);
  const summary = failed.map(c => c.name + ': ' + c.err).join(' | ');

  if (failed.length === 0) {
    if (state.consecFails >= 2) await tg('✅ Playa Guide recovered on its own. All checks green.');
    state.consecFails = 0;
  } else {
    state.consecFails = (state.consecFails || 0) + 1;
    console.error('FAIL tick ' + state.consecFails + ': ' + summary);
    if (state.consecFails === 2) {
      await tg('🚨 Playa Guide failing 2 ticks: ' + summary + '. Running self-heal.');
      const cooldownOk = !state.lastHealAt || (Date.now() - state.lastHealAt) > 2 * 3600 * 1000;
      if (cooldownOk) {
        state.lastHealAt = Date.now();
        saveState(state);
        try {
          const out = execFileSync('bash', [SELF_HEAL], { timeout: 15 * 60 * 1000, encoding: 'utf8' });
          console.log(out.slice(-2000));
          const recheck = await runProbes();
          const stillBad = recheck.filter(c => !c.ok);
          if (stillBad.length === 0) {
            state.consecFails = 0;
            await tg('🩹 Self-heal worked: redeployed and all checks are green again.');
          } else {
            await tg('🔴 Self-heal ran but STILL DOWN: ' + stillBad.map(c => c.name).join(', ') + '. Likely platform-side (Vercel/DNS). Will keep watching.');
          }
        } catch (e) {
          await tg('🔴 Self-heal itself failed: ' + String(e.message).slice(0, 200));
        }
      } else {
        await tg('⏳ Self-heal on cooldown (ran <2h ago). Still failing: ' + summary);
      }
    } else if (state.consecFails > 2 && state.consecFails % 8 === 0) {
      /* every ~2h while down, one reminder, not spam */
      await tg('🔴 Playa Guide still down (' + state.consecFails + ' ticks): ' + summary);
    }
  }

  /* client error alerts + autonomous fix lane (Joe authorized 2026-08-27) */
  try {
    const novel = await newClientErrors(state);
    if (novel.length) {
      await tg('🐛 New client error' + (novel.length > 1 ? 's' : '') + ' from real devices:\n' +
        novel.slice(0, 5).map(r => '- ' + (r.msg || '?') + (r.src ? ' @ ' + r.src.split('/').pop() + ':' + r.line : '')).join('\n'));

      /* auto-fix bounds: our own code only, 3/day, 2 tries per signature */
      const day = new Date().toISOString().slice(0, 10);
      if (state.fixDay !== day) { state.fixDay = day; state.fixesToday = 0; }
      state.fixTries = state.fixTries || {};
      const fixable = novel.filter(r => /guide\.js|index\.html|musecafe/.test(r.src || '') || !r.src);
      for (const err of fixable) {
        const sig = (err.msg || '').slice(0, 80);
        if ((state.fixesToday || 0) >= 3) { await tg('⏸ Auto-fix budget (3/day) spent; logging only.'); break; }
        if ((state.fixTries[sig] || 0) >= 2) continue;
        state.fixTries[sig] = (state.fixTries[sig] || 0) + 1;
        state.fixesToday = (state.fixesToday || 0) + 1;
        saveState(state);
        const ctxPath = '/tmp/guide-error-ctx-' + Date.now() + '.json';
        fs.writeFileSync(ctxPath, JSON.stringify({ error: err, allRecent: novel.slice(0, 10) }, null, 1));
        await tg('🔧 Launching autonomous fix (attempt ' + state.fixTries[sig] + '/2) for: ' + sig);
        try {
          const out = execFileSync('bash', [path.join(__dirname, 'guide-auto-fix.sh'), ctxPath],
            { timeout: 30 * 60 * 1000, encoding: 'utf8', env: Object.assign({}, process.env, { PATH: process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin:' + (process.env.HOME || '/Users/myos') + '/.local/bin' }) });
          if (out.indexOf('AUTOFIX DEPLOYED') !== -1) {
            await tg('✅ Auto-fix DEPLOYED for "' + sig + '". Gates passed: scope, size, new regression test, full suite, independent review, deploy-time suite.');
          } else {
            await tg('🟡 Auto-fix did not deploy for "' + sig + '" (fixer skipped or made no change). Details in guide-health.log.');
          }
        } catch (e) {
          const tail = String((e.stdout || '') + (e.stderr || '')).slice(-400);
          await tg('🟡 Auto-fix blocked by a gate for "' + sig + '":\n' + tail);
        }
        break; /* one fix attempt per tick, never a burst */
      }
    }
  } catch (e) { console.error('error-scan failed', e.message); }

  try { await dailyDigest(state); } catch (e) { console.error('digest failed', e.message); }

  saveState(state);
  console.log(new Date().toISOString(), failed.length === 0 ? 'ALL GREEN' : 'FAILS: ' + summary);
})();
