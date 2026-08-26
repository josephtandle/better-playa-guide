/* POST /api/ask - conversational answers over the Better Playa Guide data.
 *
 * Retrieval runs locally and for free over all 3875 events, then only the
 * matching listings go to the model. Public and unauthenticated, so every
 * guard below is load bearing.
 */
'use strict';
const crypto = require('crypto');
const G = require('./_guide.js');
const PROMPT = require('./_prompt.js');
const store = require('./_store.js');

/* USD per token as of 2026-08:
 * Groq (openai/gpt-oss-120b): in 0.075/1e6, out 0.30/1e6
 * Gemini (gemini-2.5-flash-lite): in 0.10/1e6, out 0.40/1e6
 * DeepSeek (deepseek-chat): in 0.14/1e6, out 0.28/1e6 (published cache-miss rate; off-peak discounts vary)
 */
const PRICES = {
  groq: { in: 0.075 / 1e6, out: 0.30 / 1e6 },
  gemini: { in: 0.10 / 1e6, out: 0.40 / 1e6 },
  deepseek: { in: 0.14 / 1e6, out: 0.28 / 1e6 }
};
const MODEL = process.env.ASK_MODEL || 'openai/gpt-oss-120b';

const MAX_Q = 300;
const MAX_CANDIDATES = 28;
const RATE_LIMIT = Number(process.env.ASK_RATE_LIMIT || 20);
const RATE_WINDOW = Number(process.env.ASK_RATE_WINDOW_SEC || 600);
const DAILY_CAP = Number(process.env.ASK_DAILY_USD_CAP || 25);
const CACHE_TTL = 86400;
const TIMEOUT_MS = Number(process.env.ASK_TIMEOUT_MS || 12000);

if (!process.env.GROQ_API_KEY) {
  console.log('[ask] missing env: GROQ_API_KEY (Groq primary disabled)');
}
if (!process.env.GEMINI_API_KEY) {
  console.log('[ask] missing env: GEMINI_API_KEY (Gemini fallback disabled)');
}
if (!process.env.DEEPSEEK_API_KEY) {
  console.log('[ask] missing env: DEEPSEEK_API_KEY (DeepSeek fallback disabled)');
}

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

/* The model occasionally emits fancy dashes and stray markdown. Strip both:
   the guide renders plain text and the house style bans em dashes. */
function sanitise(text) {
  return String(text || '')
    .replace(/[‐‑‒–\u2014―−]/g, '-')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\n)\s*#{1,6}\s+/g, '$1')
    .replace(/\bSTATUS:\s*/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* Last-resort deterministic reply, used when the model refuses a question that
   plainly has listings. Never leaves the user with nothing. */
function localReply(r) {
  const c = r.candidates.slice(0, 5);
  if (!c.length) return G.REFUSAL;
  const live = c.filter(x => x.live);
  const head = live.length
    ? 'Open right now: ' + live.length + (live.length === 1 ? ' place.' : ' places.')
    : 'Nothing is open at this exact moment. Here is what is coming up.';
  const rows = c.map(x => {
    const e = x.e;
    const where = e.a ? e.a : 'address not listed';
    return '- ' + e.t + ' at ' + e.c + ', ' + where + ', ' + G.whenText(x.slot) +
      (x.mins !== null && x.mins !== undefined ? ' (' + x.mins + ' min away)' : '');
  });
  return head + '\n' + rows.join('\n');
}

async function callGroq(messages, timeoutMs) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { error: 'no_key', status: 0, detail: 'GROQ_API_KEY missing' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: ac.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 180,
        reasoning_effort: 'low',
        messages: messages
      })
    });
    const body = await res.json();
    if (!res.ok) {
      const msg = (body && body.error && body.error.message) || ('http_' + res.status);
      return {
        error: res.status === 429 ? 'upstream_rate_limited' : 'upstream_error',
        status: res.status,
        detail: String(msg).slice(0, 200)
      };
    }
    return {
      text: (body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content) || '',
      usage: {
        prompt_tokens: (body.usage && body.usage.prompt_tokens) || 0,
        completion_tokens: (body.usage && body.usage.completion_tokens) || 0
      }
    };
  } catch (e) {
    return {
      error: e.name === 'AbortError' ? 'timeout' : 'network_error',
      status: 0,
      detail: String(e.message).slice(0, 200)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(messages, timeoutMs) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: 'no_key', status: 0, detail: 'GEMINI_API_KEY missing' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  const sysMsg = messages.find(m => m.role === 'system');
  const otherMsgs = messages.filter(m => m.role !== 'system');
  const contents = otherMsgs.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const payload = {
    contents: contents,
    generationConfig: { temperature: 0.3, maxOutputTokens: 180 }
  };
  if (sysMsg) {
    payload.systemInstruction = { parts: [{ text: sysMsg.content }] };
  }

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + encodeURIComponent(key);
    const res = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json();
    if (!res.ok) {
      const msg = (body && body.error && body.error.message) || ('http_' + res.status);
      return {
        error: res.status === 429 ? 'upstream_rate_limited' : 'upstream_error',
        status: res.status,
        detail: String(msg).slice(0, 200)
      };
    }
    const parts = body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts;
    const text = Array.isArray(parts) ? parts.map(p => p.text || '').join('') : '';
    const u = body.usageMetadata || {};
    return {
      text: text,
      usage: {
        prompt_tokens: u.promptTokenCount || 0,
        completion_tokens: u.candidatesTokenCount || 0
      }
    };
  } catch (e) {
    return {
      error: e.name === 'AbortError' ? 'timeout' : 'network_error',
      status: 0,
      detail: String(e.message).slice(0, 200)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callDeepSeek(messages, timeoutMs) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return { error: 'no_key', status: 0, detail: 'DEEPSEEK_API_KEY missing' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      signal: ac.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.3,
        max_tokens: 180,
        messages: messages
      })
    });
    const body = await res.json();
    if (!res.ok) {
      const msg = (body && body.error && body.error.message) || ('http_' + res.status);
      return {
        error: res.status === 429 ? 'upstream_rate_limited' : 'upstream_error',
        status: res.status,
        detail: String(msg).slice(0, 200)
      };
    }
    return {
      text: (body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content) || '',
      usage: {
        prompt_tokens: (body.usage && body.usage.prompt_tokens) || 0,
        completion_tokens: (body.usage && body.usage.completion_tokens) || 0
      }
    };
  } catch (e) {
    return {
      error: e.name === 'AbortError' ? 'timeout' : 'network_error',
      status: 0,
      detail: String(e.message).slice(0, 200)
    };
  } finally {
    clearTimeout(timer);
  }
}

function isFallbackEligible(out) {
  if (out.error === 'no_key' || out.error === 'timeout' || out.error === 'network_error') return true;
  if (out.status === 429) return true;
  if (out.status >= 500) return true;
  return false;
}

async function callWithFallback(messages, deadline) {
  const fallbackPath = [];
  const providers = [
    { name: 'groq', fn: callGroq, defaultTimeout: 4000 },
    { name: 'gemini', fn: callGemini, defaultTimeout: 6000 },
    { name: 'deepseek', fn: callDeepSeek, defaultTimeout: 6000 }
  ];

  for (const p of providers) {
    const remaining = deadline - Date.now();
    if (remaining < 1500) break;
    const timeoutMs = Math.min(p.defaultTimeout, remaining);
    const out = await p.fn(messages, timeoutMs);
    let tag = p.name + ':';
    if (!out.error) {
      tag += 'ok';
    } else if (out.status) {
      tag += out.status;
    } else {
      tag += out.error;
    }
    fallbackPath.push(tag);

    if (!out.error) {
      return { provider: p.name, out: out, fallbackPath: fallbackPath };
    }

    if (!isFallbackEligible(out)) {
      return { provider: p.name, out: out, fallbackPath: fallbackPath };
    }
  }

  return { provider: null, out: { error: 'all_failed' }, fallbackPath: fallbackPath };
}

module.exports = async function handler(req, res) {
  const t0 = Date.now();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method_not_allowed', fallback: true }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const q = String(body.q || '').trim();
  const loc = body.loc ? String(body.loc).slice(0, 60).trim() : null;
  const speed = Number(body.speed) || 12;

  /* x-real-ip is set by the platform and not client-forgeable; the LEFTMOST
     x-forwarded-for entry is attacker-controlled, so fall back to the RIGHTMOST. */
  const xff = String(req.headers['x-forwarded-for'] || '').split(',');
  const ip = String(req.headers['x-real-ip'] || '').trim() ||
             xff[xff.length - 1].trim() ||
             (req.socket && req.socket.remoteAddress) || 'unknown';
  const ipHash = sha(ip).slice(0, 12);
  const dayKey = new Date(G.playaNow().ms).toISOString().slice(0, 10);
  const spendKey = 'spend:' + dayKey;

  const log = extra => {
    console.log(JSON.stringify(Object.assign({
      tag: 'ask', ip_hash: ipHash, q_len: q.length, model: MODEL,
      store: store.backendName, latency_ms: Date.now() - t0
    }, extra)));
  };

  if (!q) { log({ outcome: 'empty' }); res.status(400).json({ ok: false, error: 'empty', fallback: true, reply: '' }); return; }
  if (q.length > MAX_Q) {
    log({ outcome: 'too_long' });
    res.status(400).json({ ok: false, error: 'too_long', fallback: true,
      reply: 'That is a bit long. Keep it under ' + MAX_Q + ' characters.' });
    return;
  }

  /* 1. Rate limit. Runs before everything else so refusal probes and abuse
     burn quota too. Read BEFORE incrementing. Counting a rejected request against
     the caller means their own retries keep the counter climbing and the window
     never drains, which locks out a real user who simply tapped twice. */
  const bucket = Math.floor(Date.now() / (RATE_WINDOW * 1000));
  const rlKey = 'rl:' + ipHash + ':' + bucket;
  const used = Number((await store.get(rlKey)) || 0);
  if (used >= RATE_LIMIT) {
    const resetIn = Math.ceil(RATE_WINDOW - ((Date.now() / 1000) % RATE_WINDOW));
    log({ outcome: 'rate_limited', used: used });
    res.setHeader('Retry-After', String(resetIn));
    res.status(429).json({ ok: false, error: 'rate_limited', fallback: true, retry_after_sec: resetIn,
      reply: 'You are asking faster than I can keep up. Try again in ' + Math.ceil(resetIn / 60) +
             ' minutes. The guide below still works without me.' });
    return;
  }
  await store.incrBy(rlKey, 1, RATE_WINDOW + 60);

  /* 2. Scope lock. Runs before anything is assembled, so abuse costs zero tokens. */
  const scope = G.scopeCheck(q);
  if (!scope.ok) {
    await store.incrBy('refusals:' + dayKey, 1, 172800);
    log({ outcome: 'refused', reason: scope.reason, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 });
    res.status(200).json({ ok: true, refused: true, fallback: false, reply: G.REFUSAL, results: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_usd: 0 } });
    return;
  }

  /* 3. History, at most the last 3 turns, each clipped. */
  const history = Array.isArray(body.history) ? body.history.slice(-3).map(h => ({
    role: h && h.role === 'assistant' ? 'assistant' : 'user',
    content: String((h && h.content) || '').slice(0, 300)
  })).filter(h => h.content) : [];
  const priorUser = history.filter(h => h.role === 'user').pop();

  /* 4. Retrieval. Always runs, so the cards render whatever happens to the model. */
  let r;
  try {
    r = G.retrieve(q, { loc: loc, speed: speed, limit: MAX_CANDIDATES });
    /* "what about tomorrow" carries no subject of its own. Retrieval would return
       the whole city. Borrow the subject from the previous question so a follow-up
       still means what the person obviously meant. */
    if (priorUser && !r.parsed.catWord && r.parsed.tokens.length === 0) {
      const merged = G.retrieve(priorUser.content + ' ' + q, { loc: loc, speed: speed, limit: MAX_CANDIDATES });
      if (merged.candidates.length) r = merged;
    }
  } catch (e) {
    log({ outcome: 'retrieval_error', detail: String(e.message).slice(0, 200) });
    res.status(200).json({ ok: true, fallback: true, error: 'retrieval_error', reply: '', results: [] });
    return;
  }
  const results = r.candidates.map(G.cardFor);
  const parsedOut = {
    timeDesc: r.parsed.timeDesc,
    placeDesc: r.parsed.placeDesc,
    catWord: r.parsed.catWord,
    intent: r.parsed.intent,
    relaxed: r.parsed.relaxed,
    didYouMean: r.parsed.didYouMean
  };

  /* Short circuit for person miss BEFORE cache/model */
  if (r.parsed.intent === 'person' && r.parsed.personMiss) {
    const personName = (r.parsed.personTerms && r.parsed.personTerms.length) ? r.parsed.personTerms.join(' ') : 'that name';
    let replyMsg = 'I could not find "' + personName + '" in any lineup I have. Check the spelling, artist names are often stylised.';
    if (r.parsed.didYouMean) {
      replyMsg += ' Did you mean "' + r.parsed.didYouMean + '"?';
    }
    log({ outcome: 'person_miss', prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 });
    res.status(200).json({
      ok: true, cached: false, fallback: false, refused: false, reply: replyMsg, results: [], parsed: parsedOut,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_usd: 0 }
    });
    return;
  }

  /* 5. Cache. Keyed on a 30-minute playa-clock bucket as well: "what is on
     right now" must not serve yesterday's half-hour verbatim for 24 hours
     while the cards recompute fresh. Speed changes distances, so it keys too. */
  const norm = q.toLowerCase().replace(/\s+/g, ' ').replace(/[?!.\s]+$/, '');
  const timeBucket = Math.floor(G.playaNow().ms / (30 * 60e3));
  const cacheKey = 'ans:v3:' + sha(norm + '|' + (loc || '') + '|' + speed + '|' + timeBucket + '|' +
    history.map(h => h.role + ':' + h.content).join('~')).slice(0, 40);
  const cached = await store.get(cacheKey);
  if (cached) {
    log({ outcome: 'cache_hit', prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, candidates: results.length });
    res.status(200).json({ ok: true, cached: true, fallback: false, reply: cached, results: results, parsed: parsedOut,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_usd: 0 } });
    return;
  }

  /* 6. Budget cap. NaN or garbage in the store must never disable the cap. */
  const spent = Number(await store.get(spendKey)) || 0;
  if (spent >= DAILY_CAP) {
    log({ outcome: 'budget_exhausted', spent_usd: spent, cap_usd: DAILY_CAP, candidates: results.length });
    res.status(200).json({ ok: true, fallback: true, budget_exhausted: true, reply: '', results: results, parsed: parsedOut,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_usd: 0 },
      budget: { spent_usd: spent, cap_usd: DAILY_CAP } });
    return;
  }

  /* 7. Model. */
  const userBlock = PROMPT.buildUserBlock(q, r, { loc: loc });
  const messages = [{ role: 'system', content: PROMPT.SYSTEM_PROMPT }].concat(history, [{ role: 'user', content: userBlock }]);
  const deadline = Date.now() + TIMEOUT_MS;

  /* Reserve a conservative estimate BEFORE the model call so a burst of
     concurrent requests cannot sail past the cap during the 12s flight.
     Trued up to the real cost after the call. */
  const EST_COST = 0.002;
  await store.incrBy(spendKey, EST_COST, 172800);

  const fbResult = await callWithFallback(messages, deadline);
  const resOut = fbResult.out;

  if (!fbResult.provider || resOut.error) {
    await store.incrBy(spendKey, -EST_COST, 172800);
    log({ outcome: 'model_failed', fallback_path: fbResult.fallbackPath, reason: resOut.error, detail: resOut.detail, candidates: results.length });
    res.status(200).json({ ok: true, fallback: true, error: resOut.error || 'model_failed', reply: '', results: results, parsed: parsedOut });
    return;
  }

  const provider = fbResult.provider;
  if (!PRICES[provider]) console.error('[ask] no price table for provider ' + provider + ', billing at groq rate');
  const price = PRICES[provider] || PRICES.groq;
  let promptTok = resOut.usage.prompt_tokens || 0;
  let compTok = resOut.usage.completion_tokens || 0;
  let retried = false;

  let reply = sanitise(resOut.text);
  let usedLocalReply = false;
  const looksRefused = !reply || reply.replace(/[^a-z ]/gi, '').toLowerCase().indexOf('i only know what is on at burning man') !== -1;
  if (looksRefused && results.length > 0) {
    retried = true;
    const nudge = messages.concat([
      { role: 'assistant', content: reply || '' },
      { role: 'user', content: 'That question is in scope and the LISTINGS above are relevant to it. Answer it from those listings now. Do not use the refusal sentence.' }
    ]);
    const rem = deadline - Date.now();
    if (rem >= 1500) {
      let out2;
      if (provider === 'groq') out2 = await callGroq(nudge, Math.min(4000, rem));
      else if (provider === 'gemini') out2 = await callGemini(nudge, Math.min(6000, rem));
      else if (provider === 'deepseek') out2 = await callDeepSeek(nudge, Math.min(6000, rem));

      if (out2 && !out2.error) {
        promptTok += out2.usage.prompt_tokens || 0;
        compTok += out2.usage.completion_tokens || 0;
        const r2 = sanitise(out2.text);
        const stillRefused = !r2 || r2.replace(/[^a-z ]/gi, '').toLowerCase().indexOf('i only know what is on at burning man') !== -1;
        if (stillRefused) { reply = localReply(r); usedLocalReply = true; } else { reply = r2; }
      } else {
        reply = localReply(r); usedLocalReply = true;
      }
    } else {
      reply = localReply(r); usedLocalReply = true;
    }
  }
  if (!reply) { reply = localReply(r); usedLocalReply = true; }

  const cost = promptTok * price.in + compTok * price.out;
  /* true-up: the estimate was already charged */
  const newSpent = await store.incrBy(spendKey, cost - EST_COST, 172800);
  /* Never cache a deterministic fallback: a degraded answer must not outlive
     the outage that produced it. */
  if (!usedLocalReply) await store.set(cacheKey, reply, CACHE_TTL);

  log({ outcome: 'answered', provider: provider, fallback_path: fbResult.fallbackPath, retried: retried, candidates: results.length, hits: r.hits,
        prompt_tokens: promptTok, completion_tokens: compTok, cost_usd: +cost.toFixed(6),
        spent_usd: +Number(newSpent).toFixed(6) });

  res.status(200).json({
    ok: true, cached: false, fallback: false, reply: reply, results: results, parsed: parsedOut,
    usage: { provider: provider, prompt_tokens: promptTok, completion_tokens: compTok, total_tokens: promptTok + compTok,
             cost_usd: +cost.toFixed(6), latency_ms: Date.now() - t0 },
    budget: { spent_usd: +Number(newSpent).toFixed(6), cap_usd: DAILY_CAP }
  });
};
