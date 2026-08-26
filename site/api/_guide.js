/* Better Playa Guide - shared data + retrieval. No network. CommonJS. */
'use strict';
const fs = require('fs');
const path = require('path');

/* ---------- load ---------- */
let GUIDE = null;
function loadGuide() {
  if (GUIDE) return GUIDE;
  const tries = [
    path.join(process.cwd(), 'guide', 'data.js'),
    path.join(__dirname, '..', 'guide', 'data.js'),
    path.join(__dirname, 'data.js')
  ];
  let src = null;
  for (const p of tries) { try { src = fs.readFileSync(p, 'utf8'); break; } catch (e) {} }
  if (!src) throw new Error('guide/data.js not found');
  src = src.trim();
  GUIDE = JSON.parse(src.slice(src.indexOf('=') + 1).trim().replace(/;+$/, ''));
  GUIDE.ev.e.forEach(function (e, i) {
    e.__i = i;
    e.id = e.t + '|' + e.c + '|' + ((e.s && e.s[0] && e.s[0][0]) || '');
  });
  return GUIDE;
}

const SOURCES = {
  0: { label: 'WWW Guide',     who: 'the official Who What Where guide from Burning Man', tier: 'confirmed' },
  1: { label: 'Camp Website',  who: "the camp's own official website",                   tier: 'confirmed' },
  2: { label: 'Camp IG',       who: "the camp's own Instagram",                          tier: 'reported'  },
  3: { label: 'RSL',           who: 'Rock Star Librarian, the long-running DJ set list', tier: 'confirmed' },
  4: { label: 'Flyer',         who: 'Playa Set Library, transcribed from set-time flyers by hand', tier: 'reported' },
  5: { label: 'Telegram',      who: 'a post in the BM 2026 community Telegram groups',   tier: 'reported'  },
  6: { label: 'Camp Official', who: "the camp's own announcement in its Telegram or WhatsApp channel", tier: 'confirmed' },
  7: { label: 'Community Cal', who: 'the crowd-sourced BM community Google Calendar',    tier: 'reported'  },
  8: { label: 'IG Flyer',      who: "read from the camp's own schedule flyer posted to Instagram", tier: 'reported' }
};

const TAGS = ['workshop','talk','party','music','food','drink','adult','wellness','art','ritual','game','kids','accessible','lineup','other'];

const CAT_MAP = {
  coffee:['drink'], tea:['drink'], bar:['drink'], booze:['drink'], cocktail:['drink'], cocktails:['drink'],
  eat:['food'], food:['food'], snack:['food'], breakfast:['food'], pizza:['food'], burger:['food'], tacos:['food'], taco:['food'],
  dj:['music'], set:['music'], dance:['music'], sound:['music'], beats:['music'],
  party:['party'], rave:['party'],
  yoga:['wellness'], massage:['wellness'], sauna:['wellness'], healing:['wellness'], spa:['wellness'],
  talk:['talk','workshop'], lecture:['talk','workshop'], speaker:['talk','workshop'], speaking:['talk','workshop'],
  class:['talk','workshop'], workshops:['workshop'], workshop:['workshop'], talks:['talk'],
  sexy:['adult'], naked:['adult'], adult:['adult'], kink:['adult'],
  art:['art'], installation:['art'],
  kids:['kids'], family:['kids'],
  accessible:['accessible'], wheelchair:['accessible']
};

/* ---------- geometry ---------- */
function geo() {
  const G = loadGuide();
  const RING = {}; (G.ev.rings || []).forEach(r => { RING[r[0]] = r[1]; });
  return { RING, MAN: G.ev.man, FLAT: G.ev.flat, FLON: G.ev.flon, STREETS: G.ev.streets };
}
const WORD_NUM = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10 };

function parseAddr(str) {
  if (!str || typeof str !== 'string') return null;
  const { RING, MAN, FLAT, FLON, STREETS } = geo();
  let s = str.toLowerCase().trim()
    .replace(/^(?:i['’]?m\s+at|we\s+are\s+at|located\s+at|currently\s+at|at)\s+/, '')
    .replace(/\bo'?clock\b/g, ':00')
    .replace(/\b(\d{1,2})\.([0-5]\d)\b/g, '$1:$2')
    .replace(/\bgreat\s+oak\b/g, 'great_oak')
    .replace(/\bthe\s+esplanade\b/g, 'esplanade');
  const toks = s.split(/[\s&,@+]+/).filter(Boolean);
  let hour = null, mins = null, street = null;
  const matchStreet = t => {
    if (!t) return null;
    if (t === 'esp' || t === 'esplanade' || t === 'espl') return 'ESP';
    if (t === 'great_oak' || t === 'oak') return 'G';
    if (t.length === 1 && t >= 'a' && t <= 'k') return t.toUpperCase();
    for (const k of Object.keys(STREETS)) {
      const n = STREETS[k].toLowerCase();
      if (t === n) return k;
      if (t.length >= 3 && n.indexOf(t) === 0) return k;
    }
    return null;
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!street) { const m = matchStreet(t); if (m) { street = m; continue; } }
    if (hour === null) {
      let m = /^(\d{1,2}):([0-5]\d)$/.exec(t);
      if (m) { hour = +m[1]; mins = +m[2]; continue; }
      m = /^0?([1-9]|10)([0-5]\d)$/.exec(t);
      if (m && t.length >= 3) { hour = +m[1]; mins = +m[2]; continue; }
      if (WORD_NUM[t] !== undefined) {
        hour = WORD_NUM[t]; mins = 0;
        const n = toks[i + 1];
        if (n === 'thirty') { mins = 30; i++; } else if (n === 'fifteen') { mins = 15; i++; }
        else if (n === '45' || n === 'forty-five') { mins = 45; i++; }
        continue;
      }
      m = /^(\d{1,2})$/.exec(t);
      if (m) { hour = +m[1]; mins = 0; continue; }
    }
  }
  if (street === null || hour === null) return null;
  if (hour < 2 || hour > 10) return null;
  let sm = Math.round(mins / 15) * 15, sh = hour;
  if (sm === 60) { sm = 0; sh += 1; if (sh > 10) return null; }
  const clock = sh + ':' + (sm < 10 ? '0' + sm : sm);
  const r = RING[street];
  let lat = null, lon = null;
  if (r !== undefined) {
    const b = ((sh + sm / 60 - 10.5) * 30) * Math.PI / 180;
    lat = MAN[0] + (r * Math.cos(b)) / FLAT;
    lon = MAN[1] + (r * Math.sin(b)) / FLON;
  }
  return { clock, street, label: clock + ' & ' + street, lat, lon };
}

function minutesTo(from, addrStr, speed) {
  if (!from) return null;
  const q = parseAddr(addrStr);
  if (!q || q.lat === null) return null;
  const { FLAT, FLON } = geo();
  const dn = (q.lat - from.lat) * FLAT, de = (q.lon - from.lon) * FLON;
  return Math.round(Math.hypot(dn, de) / (speed || 12) / 60);
}

/* ---------- playa clock (America/Los_Angeles = UTC-7 in Aug/Sep) ---------- */
const BURN_START = Date.UTC(2026, 7, 30, 0, 0, 0);
const BURN_END   = Date.UTC(2026, 8, 7, 23, 59, 59);
const DAYN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function playaNow(nowMs) {
  const real = (nowMs === undefined ? Date.now() : nowMs) - 7 * 3600 * 1000;
  const inWindow = real >= BURN_START && real <= BURN_END;
  const d = new Date(inWindow ? real : BURN_START + 12 * 3600 * 1000);
  return { ms: d.getTime(), date: d, inWindow, beforeBurn: !inWindow && real < BURN_START, afterBurn: !inWindow && real > BURN_END };
}
function fmtStamp(ms) {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0');
  return DAYN[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONN[d.getUTCMonth()] + ' ' + hh + ':' + mm;
}
function fmtDay(ms) {
  const d = new Date(ms);
  return DAYN[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONN[d.getUTCMonth()];
}
function slotTimes(slot) {
  if (!slot || !slot[0]) return null;
  const parts = String(slot[0]).split(' ');
  if (parts.length < 2) return null;
  const md = parts[0].split('-'), hm = parts[1].split(':');
  const start = Date.UTC(2026, +md[0] - 1, +md[1], +hm[0], +hm[1], 0);
  let end = start + 2 * 3600 * 1000;
  if (slot[1]) {
    const eh = String(slot[1]).split(':');
    let cand = Date.UTC(2026, +md[0] - 1, +md[1], +eh[0], +eh[1], 0);
    if (cand <= start) cand += 24 * 3600 * 1000;
    end = cand;
  }
  return { start, end };
}

/* ---------- scope lock vocabulary (built once from the real index) ---------- */
let VOCAB = null;
function vocab() {
  if (VOCAB) return VOCAB;
  const G = loadGuide();
  const set = new Set();
  const desc = new Set();
  const addTo = (target, s) => {
    if (!s) return;
    String(s).toLowerCase().split(/[^a-z0-9']+/).forEach(w => { if (w.length > 2) target.add(w); });
  };
  const add = s => addTo(set, s);
  G.ev.e.forEach(e => { add(e.t); add(e.c); add(e.p); (e.g || []).forEach(g => set.add(g)); addTo(desc, e.d); });
  Object.keys(G.ev.streets).forEach(k => { set.add(k.toLowerCase()); add(G.ev.streets[k]); });
  ((G.map && G.map.landmarks) || []).forEach(l => add(l.n));
  Object.keys(CAT_MAP).forEach(k => set.add(k));
  TAGS.forEach(t => set.add(t));
  ['now','today','tonight','tomorrow','morning','afternoon','evening','night','late','sunrise','sunset',
   'monday','tuesday','wednesday','thursday','friday','saturday','sunday','mon','tue','wed','thu','fri','sat','sun',
   'playa','brc','burn','burning','camp','camps','event','events','near','nearby','around','close','where','esplanade',
   'deep','open','street','address','walk','bike','ride','get','find','happening','open','serving','served','play',
   'playing','set','sets','lineup','djs','dj','speaker','speakers','speaking','talk','talks','coffee','pizza','food',
   'drink','water','ice','breakfast','lunch','dinner','snack','snacks','bar','music','party','dance','yoga','massage',
   'sauna','art','temple','man','center','centre'].forEach(w => set.add(w));
  VOCAB = { strong: set, desc };
  return VOCAB;
}

const BLOCK_PATTERNS = [
  /\bignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|your)\b/i,
  /\bsystem\s*prompt\b/i, /\byour\s+(?:instructions|rules|prompt|guidelines)\b/i,
  /\bdisregard\b/i, /\byou\s+are\s+now\b/i, /\bact\s+as\b/i, /\bpretend\s+(?:to\s+be|you)\b/i,
  /\bjailbreak\b/i, /\bDAN\b/, /\bdeveloper\s+mode\b/i, /\bprompt\s+injection\b/i,
  /\brepeat\s+(?:the\s+)?(?:above|everything|your)\b/i, /\bprint\s+(?:your|the)\s+(?:system|prompt|instructions)\b/i,
  /\bwrite\s+(?:me\s+)?(?:a\s+)?(?:python|javascript|java|c\+\+|rust|go|sql|bash|shell|code|script|program|function|essay|poem|story|song|haiku|sonnet|email|blog|article)\b/i,
  /\bgenerate\s+(?:code|a\s+script|an\s+essay|a\s+poem|a\s+story)\b/i,
  /\btranslate\b/i, /\bsummari[sz]e\s+(?:this|the\s+following)\b/i,
  /\bcapital\s+of\b/i, /\bwho\s+is\s+the\s+(?:president|prime\s+minister|ceo)\b/i,
  /\bstock\s+price\b/i, /\bmedical\s+advice\b/i, /\blegal\s+advice\b/i,
  /\bsolve\s+(?:for|this\s+equation)\b/i, /\bwhat\s+is\s+\d+\s*[\+\-\*\/x]\s*\d+/i,
  /\broleplay\b/i, /\bwrite\s+in\s+the\s+style\s+of\b/i
];

const REFUSAL = 'I only know what is on at Burning Man 2026. Ask me about events, camps, DJs or where to find something.';

function scopeCheck(q) {
  const raw = String(q || '').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  for (const re of BLOCK_PATTERNS) if (re.test(raw)) return { ok: false, reason: 'blocked_pattern' };
  const low = raw.toLowerCase();
  if (/(\d{1,2})(:\d{2})?\s*(?:&|and|@|,)\s*(esp|esplanade|[a-k])\b/i.test(low)) return { ok: true, reason: 'address' };
  if (/\b(?:when is|who is|who's|where is|where's|set ?times?|lineup|playing|spinning|speaking|talking|teaching|leading|performing)\b/i.test(low)) {
    return { ok: true, reason: 'person_query' };
  }
  const V = vocab();
  const words = low.split(/[^a-z0-9']+/).filter(w => w.length > 2 && !STOP.has(w));
  for (const w of words) if (V.strong.has(w)) return { ok: true, reason: 'entity:' + w };
  let weak = 0, first = null;
  for (const w of words) if (V.desc.has(w)) { weak++; if (!first) first = w; }
  if (weak >= 2) return { ok: true, reason: 'desc:' + first };
  return { ok: false, reason: 'out_of_scope' };
}

/* ---------- query parsing & fine-tag cache ---------- */
const WEEKDAYS = { sun:'08-30', sunday:'08-30', mon:'08-31', monday:'08-31', tue:'09-01', tuesday:'09-01',
  wed:'09-02', wednesday:'09-02', thu:'09-03', thursday:'09-03', fri:'09-04', friday:'09-04',
  sat:'09-05', saturday:'09-05' };

const STOPWORDS_LIST = [
  'what', 'should', 'i', "i'm", 'im', 'do', 'does', 'did', 'can', 'could', 'would', 'is', 'are',
  'there', 'any', 'some', 'get', 'got', 'go', 'going', 'how', 'where', 'when', 'who', 'why',
  'me', 'my', 'mine', 'we', 'us', 'our', 'a', 'an', 'the', 'to', 'for', 'of', 'on', 'at', 'in',
  'and', 'or', 'but', 'want', 'need', 'like', 'find', 'show', 'tell', 'thing', 'things', 'stuff',
  'something', 'anything', 'good', 'best', 'cool', 'fun', 'please', 'thanks',
  'you', 'whats', "what's", 'your', 'with', 'this', 'that', 'from', 'about', 'it', 'be', 'have',
  'getting', 'serving', 'served', 'being', 'right', 'now', 'today', "there's", 'theres',
  'play', 'playing', 'plays', 'set', 'sets', 'lineup', 'happening', 'event', 'events'
];
const STOPWORDS = new Set(STOPWORDS_LIST);
const STOP = STOPWORDS;

const STRUCTURAL_WORDS = new Set([
  'served', 'serving', 'when', 'set', 'sets', 'times', 'time',
  'playing', 'spinning', 'lineup', 'b2b', 'dj', 'speaking', 'talking', 'teaching', 'leading', 'performing'
]);

let FV_CACHE = null;
function getFvIndex() {
  if (FV_CACHE) return FV_CACHE;
  const G = loadGuide();
  FV_CACHE = G.ev.fv || [];
  return FV_CACHE;
}

/* Query words that should route through a fine tag they do not literally match. */
const FV_SYN = {
  gay: ['queer', 'lgbtq'], lesbian: ['sapphic', 'queer'], lgbt: ['lgbtq', 'queer'],
  rap: ['hip-hop'], hiphop: ['hip-hop'],
  edm: ['techno', 'dubstep', 'trance', 'tribal-house'], psytrance: ['trance'],
  bondage: ['bdsm', 'kink'], shibari: ['bdsm', 'kink'], rope: ['bdsm'],
  meditate: ['meditation', 'guided-meditation'], meditating: ['meditation'],
  sexy: ['erotic', 'burlesque'], astrology: ['divination', 'oracle', 'tarot'],
  psychic: ['divination', 'oracle', 'tarot'], fortune: ['divination', 'oracle', 'tarot']
};

function matchFvIndices(term) {
  const fv = getFvIndex();
  const indices = [];
  const tLow = term.toLowerCase();
  const tStem = tLow.endsWith('s') ? tLow.slice(0, -1) : tLow;
  const synNames = FV_SYN[tLow] || FV_SYN[tStem] || null;
  for (let i = 0; i < fv.length; i++) {
    const entry = (fv[i] || '').toLowerCase();
    if (entry === tLow || entry === tStem || entry === tLow + 's' || entry === tLow + 'es') {
      indices.push(i);
      continue;
    }
    if (synNames && synNames.indexOf(entry) !== -1) {
      indices.push(i);
      continue;
    }
    const segs = entry.split('-');
    if (segs.some(s => s === tLow || s === tStem || s === tLow + 's' || s === tLow + 'es')) {
      indices.push(i);
    }
  }
  return indices;
}

let PERSON_VOCAB = null;
function getPersonVocab() {
  if (PERSON_VOCAB) return PERSON_VOCAB;
  const G = loadGuide();
  const set = new Map();
  G.ev.e.forEach(e => {
    if (!e.p) return;
    const words = String(e.p).split(/[^a-zA-Z0-9'’]+/);
    words.forEach(w => {
      const clean = w.replace(/['’]s$/i, '').trim();
      if (clean.length >= 4) {
        const low = clean.toLowerCase();
        if (!set.has(low)) set.set(low, clean);
      }
    });
  });
  PERSON_VOCAB = set;
  return PERSON_VOCAB;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const row = Array(a.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= b.length; i++) {
    let prev = i;
    for (let j = 1; j <= a.length; j++) {
      const val = (b[i - 1] === a[j - 1]) ? row[j - 1] : Math.min(row[j - 1] + 1, prev + 1, row[j] + 1);
      row[j - 1] = prev;
      prev = val;
    }
    row[a.length] = prev;
  }
  return row[a.length];
}

function findDidYouMean(term) {
  if (!term || term.length < 3) return null;
  const vocabMap = getPersonVocab();
  const target = term.toLowerCase();
  let bestWord = null;
  let minDistance = 999;
  for (const [low, orig] of vocabMap.entries()) {
    const d = levenshtein(target, low);
    if (d <= 2 && d < minDistance) {
      minDistance = d;
      bestWord = orig;
    }
  }
  return bestWord;
}

function applySynonyms(str) {
  let s = str.toLowerCase();
  /* "sound camp" means a music camp, not the words sound+camp */
  s = s.replace(/\bsound\s+camps?\b/g, 'dj');
  /* plural forms that the category matcher only knows singular */
  s = s.replace(/\bsets\b/g, 'set');
  s = s.replace(/\bparties\b/g, 'party');
  s = s.replace(/\braves\b/g, 'rave');
  s = s.replace(/\bveggie\b/g, 'vegetarian').replace(/\bveg\b/g, 'vegetarian');
  s = s.replace(/\bpizzas\b/g, 'pizza');
  s = s.replace(/\bdjs\b/g, 'dj');
  s = s.replace(/\bsaunas\b/g, 'sauna').replace(/\bsteam\b/g, 'sauna');
  s = s.replace(/\bmassages\b/g, 'massage');
  return s;
}

function parseQuery(qRaw, opts) {
  opts = opts || {};
  const qOrig = String(qRaw);
  let q = applySynonyms(qOrig);
  const now = playaNow(opts.nowMs);
  const nowMs = now.ms;
  let wStart = null, wEnd = null, timeDesc = '', hasTime = false, wantsNow = false;
  let targetDay = null;

  let m = /\bin\s+(\d+)\s*(?:hours?|hrs?|h)\b/.exec(q);
  const dayStart = ms => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  if (m) {
    wStart = nowMs; wEnd = nowMs + (+m[1]) * 3600e3; timeDesc = 'in the next ' + m[1] + ' hours'; hasTime = true; wantsNow = true;
  } else if (/\b(?:right\s+now|now|currently|at\s+the\s+moment)\b/.test(q)) {
    wStart = nowMs; wEnd = nowMs + 3 * 3600e3; timeDesc = 'right now'; hasTime = true; wantsNow = true;
  } else if (/\btonight\b/.test(q)) {
    const t = new Date(nowMs);
    targetDay = String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
    wStart = dayStart(nowMs) + 18 * 3600e3; wEnd = wStart + 9 * 3600e3;
    timeDesc = 'tonight'; hasTime = true;
  } else {
    const BURN_DAYS = { '1':'08-30', '2':'08-31', '3':'09-01', '4':'09-02', '5':'09-03', '6':'09-04', '7':'09-05', '8':'09-06', '9':'09-07' };
    const bnm = /\bburn\s+night\b/.exec(q);
    const bdm = /\bday\s*([1-9])\b(?:\s*of\s*the\s*burn)?/.exec(q);
    if (bnm) {
      targetDay = '09-05';
      timeDesc = 'on burn night';
      hasTime = true;
      const base = Date.UTC(2026, 8, 5);
      wStart = base + 18 * 3600e3;
      wEnd = base + 30 * 3600e3;
    } else if (bdm) {
      targetDay = BURN_DAYS[bdm[1]];
      timeDesc = 'on day ' + bdm[1];
      hasTime = true;
    } else if (/\bfirst\s+day\b(?:\s*of\s*the\s*burn)?/.test(q)) {
      targetDay = '08-30';
      timeDesc = 'on day 1';
      hasTime = true;
    } else if (/\blast\s+day\b(?:\s*of\s*the\s*burn)?/.test(q)) {
      targetDay = '09-07';
      timeDesc = 'on day 9';
      hasTime = true;
    } else {
      const dm = /\b(0[89]|8|9)[-\/](0[1-9]|[12]\d|3[01])\b/.exec(q);
      if (dm) {
        targetDay = String(dm[1]).padStart(2, '0') + '-' + String(dm[2]).padStart(2, '0');
        timeDesc = 'on ' + targetDay;
        hasTime = true;
      } else {
        for (const k of Object.keys(WEEKDAYS)) {
          if (new RegExp('\\b' + k + '\\b').test(q)) {
            targetDay = WEEKDAYS[k];
            timeDesc = 'on ' + k[0].toUpperCase() + k.slice(1);
            hasTime = true;
            break;
          }
        }
      }
    }
    if (/\btomorrow\b/.test(q)) {
      const t = new Date(nowMs + 864e5);
      targetDay = String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
      timeDesc = 'tomorrow'; hasTime = true;
    }
    if (/\btoday\b/.test(q) && !targetDay) {
      const t = new Date(nowMs);
      targetDay = String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
      timeDesc = 'today'; hasTime = true;
    }
    const base = targetDay ? Date.UTC(2026, +targetDay.split('-')[0] - 1, +targetDay.split('-')[1]) : dayStart(nowMs);
    if (wStart === null) {
      if (/\bmorning\b/.test(q))        { wStart = base + 6 * 3600e3;  wEnd = base + 12 * 3600e3; timeDesc = (timeDesc ? timeDesc + ' morning' : 'this morning'); hasTime = true; }
      else if (/\bafternoon\b/.test(q)) { wStart = base + 12 * 3600e3; wEnd = base + 18 * 3600e3; timeDesc = (timeDesc ? timeDesc + ' afternoon' : 'this afternoon'); hasTime = true; }
      else if (/\bevening\b/.test(q))   { wStart = base + 18 * 3600e3; wEnd = base + 23 * 3600e3; timeDesc = (timeDesc ? timeDesc + ' evening' : 'this evening'); hasTime = true; }
      else if (/\bsunrise\b/.test(q))   { wStart = base + 4 * 3600e3;  wEnd = base + 10 * 3600e3; timeDesc = (timeDesc ? timeDesc + ' around sunrise' : 'around sunrise'); hasTime = true; }
      else if (/\b(?:late|night)\b/.test(q)) { wStart = base + 23 * 3600e3; wEnd = base + 30 * 3600e3; timeDesc = (timeDesc ? timeDesc + ' late night' : 'late night'); hasTime = true; }
      else if (targetDay) { wStart = base; wEnd = base + 864e5; }
    }
  }

  let refAddr = null, placeDesc = '', isNearMe = false;
  const am = /(\d{1,2}(?::\d{2})?)\s*(?:&|and|@|,)?\s*(esp|esplanade|[a-k])\b/.exec(q);
  if (am) {
    const hh = am[1].indexOf(':') === -1 ? am[1] + ':00' : am[1];
    const st = /^esp/.test(am[2]) ? 'ESP' : am[2].toUpperCase();
    refAddr = hh + ' & ' + st;
    placeDesc = 'near ' + refAddr;
  } else if (/\b(?:near\s+me|nearby|close|closest|walking\s+distance|around\s+me|near\s+here)\b/.test(q)) {
    isNearMe = true;
    if (opts.loc) { refAddr = opts.loc; placeDesc = 'near ' + opts.loc; }
  }

  let catWord = null;
  for (const k of Object.keys(CAT_MAP)) if (new RegExp('\\b' + k + '\\b').test(q)) { catWord = k; break; }
  if (!catWord) for (const t of TAGS) if (new RegExp('\\b' + t + '\\b').test(q)) { catWord = t; break; }
  const tags = catWord ? (CAT_MAP[catWord] || [catWord]) : null;

  let clean = q
    .replace(/^(?:whats?\s+on|what\s+is\s+on|show|find|is\s+there|are\s+there|any|where\s+is|where\s+are|who\s+is|who\s+are|how\s+do\s+i\s+get|how\s+to\s+get|how\s+can\s+i\s+get|i\s+need|i\s+want|looking\s+for|im\s+looking\s+for)\b/g, '')
    .replace(/\b(?:near\s+me|nearby|close|closest|walking\s+distance|right\s+now|now|tonight|today|tomorrow|morning|afternoon|evening|late|night|sunrise|in\s+\d+\s*(?:hours?|hrs?|h))\b/g, '')
    .replace(/(\d{1,2}(?::\d{2})?)\s*(?:&|and|@|,)?\s*(esp|esplanade|[a-k])\b/g, '')
    .replace(/\bburn\s+night\b/g, '')
    .replace(/\bday\s*[1-9]\b(?:\s*of\s*the\s*burn)?/g, '')
    .replace(/\bfirst\s+day\b(?:\s*of\s*the\s*burn)?/g, '')
    .replace(/\blast\s+day\b(?:\s*of\s*the\s*burn)?/g, '');
  Object.keys(WEEKDAYS).forEach(k => { clean = clean.replace(new RegExp('\\b' + k + '\\b', 'g'), ''); });
  if (targetDay) clean = clean.replace(new RegExp('\\b' + targetDay.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), '');

  const seen = new Set();
  const rawTokens = clean.split(/[^a-z0-9'’\-]+/).filter(w => {
    if (w.length <= 1 || STOPWORDS.has(w) || STRUCTURAL_WORDS.has(w) || seen.has(w)) return false;
    seen.add(w); return true;
  });

  // INTENT DECISION (mutually exclusive, in order)
  let intent = null;
  let personTerms = [];
  let campFilter = null;

  const isPersonQuery =
    /\bwho(?:'s| is)?\s+(?:playing|spinning|on)\b/i.test(q) ||
    /\bwhere(?:'s| is)?\b.*\b(?:playing|spinning)\b/i.test(q) ||
    /\b(?:playing|spinning)\b/i.test(q) ||
    /\bset ?times?\b/i.test(q) ||
    /\blineup\b/i.test(q) ||
    /\bwhen is\b/i.test(q) ||
    /\b[a-z0-9'’]+['’]s\b/i.test(q);

  if (isPersonQuery) {
    intent = 'person';
    const atMatch = /\bat\s+([^?.,!]+)/i.exec(q);
    if (atMatch) {
      const targetCampStr = atMatch[1].trim();
      const G = loadGuide();
      const matched = G.ev.e.find(e => {
        const cLow = (e.c || '').toLowerCase();
        const kLow = (e.k || '').toLowerCase();
        const tLow = targetCampStr.toLowerCase();
        return (cLow && cLow.includes(tLow)) || (kLow && kLow.includes(tLow));
      });
      if (matched) {
        campFilter = targetCampStr;
      }
    }

    let pClean = q
      .replace(/\bat\s+([^?.,!]+)/i, '')
      .replace(/\bwho(?:'s| is)?\b/gi, '')
      .replace(/\bwhere(?:'s| is)?\b/gi, '')
      .replace(/\bwhen is\b/gi, '')
      .replace(/\bwhat are\b/gi, '')
      .replace(/\bset ?times?\b/gi, '')
      .replace(/\blineup\b/gi, '')
      .replace(/\b(?:playing|spinning|on)\b/gi, '')
      .replace(/\b(?:served|serving|b2b)\b/gi, '')
      .replace(/['’]s\b/gi, '');
    
    let pToks = pClean.split(/[^a-z0-9'’]+/).filter(w => {
      if (!w || w.length <= 1 || STOPWORDS.has(w) || STRUCTURAL_WORDS.has(w)) return false;
      return true;
    });
    if (pToks[0] === 'dj') pToks.shift();
    personTerms = pToks;
  }

  if (!intent) {
    const isWhereIs = /^(?:where\s+is|where's|wheres)\b/i.test(q);
    if (isWhereIs) {
      intent = 'lookup';
    } else if (!catWord && !hasTime && rawTokens.length >= 1 && rawTokens.length <= 4) {
      const queryStr = rawTokens.join(' ');
      const G = loadGuide();
      const strongMatch = G.ev.e.some(e => {
        const tLow = (e.t || '').toLowerCase();
        const cLow = (e.c || '').toLowerCase();
        const kLow = (e.k || '').toLowerCase();
        return tLow.includes(queryStr) || cLow.includes(queryStr) || kLow.includes(queryStr);
      });
      if (strongMatch) intent = 'lookup';
    }
  }

  if (!intent) {
    if (/^(?:is|are|will)\s+there\b/i.test(q) || /^(?:are\s+there\s+any|is\s+there\s+any|\bany\b.+\?)/i.test(q)) {
      intent = 'existence';
    }
  }

  if (!intent && catWord) intent = 'category_time';
  if (!intent && rawTokens.length === 0 && !catWord) intent = 'open_rec';
  if (!intent) intent = 'general';

  const matchTerms = intent === 'person' ? personTerms : rawTokens;
  const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokenRe = matchTerms.map(w => new RegExp('(^|[^a-z0-9])' + esc(w) + '([^a-z0-9]|$)', 'i'));
  const isBroad = (intent === 'open_rec');

  return {
    now, nowMs, tokenRe, targetDay, wStart, wEnd, timeDesc, hasTime, wantsNow,
    refAddr, refLatLon: parseAddr(refAddr), placeDesc, catWord, tags,
    tokens: matchTerms, matchTerms, isBroad, intent, relaxed: [],
    personTerms, campFilter, didYouMean: null, personMiss: false, widened: false
  };
}

/* ---------- retrieval pipeline ----------
 * 1. PARSE: Extract time, location, intent, stopwords, structural words, and synonyms.
 *    Output matchTerms, personTerms, campFilter, intent, relaxed list.
 * 2. MATCH LAYERS: Evaluate L3 (title/camp/lineup strong lexical), L2 (fine tag fv index),
 *    L1 (desc lexical), L0 (coarse category tag). Require ALL terms to hit. L0 is relax-only.
 * 3. STRICT FILTER: Apply targetDay and time window. Strict pass requires matchLayer >= 1.
 *    IRON INVARIANT: When requested day is satisfied (>= MIN_NEEDED), returned candidates
 *    contain ONLY slots on that day.
 * 4. RELAX LADDER: If strict count < MIN_NEEDED, relax one axis at a time in order:
 *    window_widened -> day_adjacent -> day_any -> category_broadened. Stop at first match.
 * 5. RANK: score = matchLayer * 1000 + windowFit + confirmedTier + proximity + multiTermL3.
 *    Match layers dominate score by construction (1000x multiplier). Sort person chronologically.
 */
function makeStemRe(term) {
  let tLow = term.toLowerCase();
  const stems = [tLow];
  if (tLow === 'film') stems.push('movie', 'movies');
  if (tLow === 'movie') stems.push('film', 'films');
  if (!tLow.endsWith('s')) {
    stems.push(tLow + 's');
    stems.push(tLow + 'es');
    if (tLow.length > 3 && tLow.endsWith('y')) stems.push(tLow.slice(0, -1) + 'ies');
  } else {
    stems.push(tLow.slice(0, -1));
    if (tLow.length > 4 && tLow.endsWith('ies')) stems.push(tLow.slice(0, -3) + 'y');
    if (tLow.length > 3 && tLow.endsWith('es')) stems.push(tLow.slice(0, -2));
  }
  const esc = stems.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp('\\b(?:' + esc + ')\\b', 'i');
}

function getTermMatchLayer(e, term) {
  const re = makeStemRe(term);
  const t = e.t || '', p = e.p || '', c = e.c || '', k = e.k || '', d = e.d || '';

  if (re.test(t) || re.test(p) || re.test(c) || re.test(k)) return 3;

  const fvIndices = matchFvIndices(term);
  if (fvIndices.length > 0 && e.f && e.f.some(idx => fvIndices.includes(idx))) return 2;

  if (re.test(d)) return 1;

  const tLow = term.toLowerCase();
  const coarseTags = CAT_MAP[tLow] || (TAGS.includes(tLow) ? [tLow] : null);
  if (coarseTags && e.g && e.g.some(g => coarseTags.includes(g))) return 0;

  return -1;
}

function getAdjacentDays(dayStr) {
  const days = ['08-30', '08-31', '09-01', '09-02', '09-03', '09-04', '09-05', '09-06', '09-07'];
  const idx = days.indexOf(dayStr);
  if (idx === -1) return [];
  const res = [];
  if (idx > 0) res.push(days[idx - 1]);
  if (idx < days.length - 1) res.push(days[idx + 1]);
  return res;
}

function collapseCandidates(candidates, dayCheck, winCheck, byTitleCampOnly) {
  if (!candidates || candidates.length === 0) return candidates;
  const groups = new Map();
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const key = byTitleCampOnly
      ? ((c.e.t || '').trim().toLowerCase() + '|' + (c.e.c || '').trim().toLowerCase())
      : (c.e.id || ((c.e.t || '').trim().toLowerCase() + '|' + (c.e.c || '').trim().toLowerCase()));
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(c);
  }

  const collapsed = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      const item = list[0];
      if (dayCheck || winCheck) {
        const filteredS = (item.e.s || []).filter(sl => {
          if (!sl || !sl[0]) return false;
          if (dayCheck && !dayCheck(sl[0].slice(0, 5))) return false;
          if (winCheck) {
            const st = slotTimes(sl);
            if (st && !winCheck(st)) return false;
          }
          return true;
        });
        if (filteredS.length > 0) {
          const mergedE = Object.assign({}, item.e, { s: filteredS });
          collapsed.push(Object.assign({}, item, { e: mergedE }));
          continue;
        }
      }
      collapsed.push(item);
      continue;
    }

    list.sort((a, b) => {
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      const as = slotTimes(a.slot), bs = slotTimes(b.slot);
      if (as && bs) return as.start - bs.start;
      if (as) return -1; if (bs) return 1; return 0;
    });

    const best = list[0];
    const slotMap = new Map();
    const pSet = new Set();
    const gSet = new Set();

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item.e.p) {
        item.e.p.split(/,\s*/).forEach(name => { if (name.trim()) pSet.add(name.trim()); });
      }
      if (item.e.g) item.e.g.forEach(t => gSet.add(t));
      const sArr = item.e.s || (item.slot ? [item.slot] : []);
      for (let j = 0; j < sArr.length; j++) {
        const sl = sArr[j];
        if (!sl || !sl[0]) continue;
        if (dayCheck && !dayCheck(sl[0].slice(0, 5))) continue;
        if (winCheck) {
          const st = slotTimes(sl);
          if (st && !winCheck(st)) continue;
        }
        const sKey = sl[0] + ' ' + (sl[1] || '');
        if (!slotMap.has(sKey)) {
          slotMap.set(sKey, sl);
        }
      }
    }

    const mergedSlots = Array.from(slotMap.values());
    mergedSlots.sort((a, b) => {
      const as = slotTimes(a), bs = slotTimes(b);
      if (as && bs) return as.start - bs.start;
      if (as) return -1; if (bs) return 1; return 0;
    });

    const mergedE = Object.assign({}, best.e, {
      s: mergedSlots,
      p: Array.from(pSet).join(', '),
      g: Array.from(gSet)
    });

    collapsed.push(Object.assign({}, best, { e: mergedE }));
  }

  return collapsed;
}

function retrieve(qRaw, opts) {
  opts = opts || {};
  const G = loadGuide();
  const EV = G.ev.e;
  const P = parseQuery(qRaw, opts);
  const speed = opts.speed || 12;
  const window = (P.wStart !== null && P.wEnd !== null) ? { start: P.wStart, end: P.wEnd } : null;
  const MIN_NEEDED = (P.intent === 'person' || P.intent === 'lookup') ? 1 : 3;

  if (P.intent === 'person') {
    let matches = [];
    if (P.campFilter) {
      const campLow = P.campFilter.toLowerCase();
      matches = EV.filter(e => {
        const cLow = (e.c || '').toLowerCase();
        const kLow = (e.k || '').toLowerCase();
        return cLow.includes(campLow) || kLow.includes(campLow);
      });
      if (P.personTerms && P.personTerms.length > 0) {
        matches = matches.filter(e => {
          const pLow = (e.p || '').toLowerCase();
          const dLow = (e.d || '').toLowerCase();
          return P.personTerms.every(term => {
            const re = makeStemRe(term);
            return re.test(pLow) || re.test(dLow);
          });
        });
      }
    } else if (P.personTerms && P.personTerms.length > 0) {
      matches = EV.filter(e => {
        const pLow = (e.p || '').toLowerCase();
        const dLow = (e.d || '').toLowerCase();
        return P.personTerms.every(term => {
          const re = makeStemRe(term);
          return re.test(pLow) || re.test(dLow);
        });
      });
    }

    if (matches.length === 0) {
      P.personMiss = true;
      if (P.personTerms && P.personTerms.length > 0) {
        P.didYouMean = findDidYouMean(P.personTerms[0]);
      }
      return { parsed: P, hits: 0, weakMatch: false, candidates: [] };
    }

    const scoredPerson = matches.map(e => {
      const sl = (e.s && e.s[0]) || null;
      const st = slotTimes(sl);
      const startMs = st ? st.start : (sl && sl[0] ? Date.UTC(2026, +sl[0].slice(0, 2) - 1, +sl[0].slice(3, 5)) : 0);
      return {
        e,
        score: 3000,
        slot: sl,
        startMs,
        mins: P.refLatLon && e.a ? minutesTo(P.refLatLon, e.a, speed) : null,
        live: !!(st && st.start <= P.nowMs && st.end > P.nowMs),
        runningOrder: !sl || !sl[0] || !sl[0].includes(' ')
      };
    });
    const collapsedPerson = collapseCandidates(scoredPerson, null, null, !!(P.campFilter || P.personTerms.length === 0));
    collapsedPerson.sort((a, b) => a.startMs - b.startMs);
    const topPerson = collapsedPerson.length <= 10 ? collapsedPerson : collapsedPerson.slice(0, opts.limit || 28);
    return { parsed: P, hits: collapsedPerson.length, weakMatch: false, candidates: topPerson };
  }

  /* Evaluate one event against a term list.
   * Multi-term queries elevate a coarse-tag hit (L0) to L1 so one generic word
   * ("food" in "vegan food") cannot sink an event the other words clearly match.
   * allTitle marks every term hitting the title, for a ranking nudge that keeps
   * "Burgers and Bass" above a radio show that merely mentions burgers. */
  function evalEvent(e, terms) {
    let minLayer = 3;
    let l3Count = 0;
    let titleCount = 0;
    for (const term of terms) {
      let layer = getTermMatchLayer(e, term);
      if (layer === 0 && terms.length >= 2) layer = 1;
      if (layer < minLayer) minLayer = layer;
      if (layer === 3) l3Count++;
      if (makeStemRe(term).test(e.t || '')) titleCount++;
    }
    return {
      e,
      matchLayer: minLayer,
      allL3: (l3Count === terms.length && terms.length > 1),
      allTitle: (terms.length > 0 && titleCount === terms.length)
    };
  }

  const evaluated = [];
  for (let i = 0; i < EV.length; i++) {
    const e = EV[i];
    if (P.isBroad || P.matchTerms.length === 0) {
      /* No usable words. If a category word was recognised ("dj sets tonight"),
         the coarse tags are the filter; without one, everything matches. */
      let matchLayer = 3;
      if (!P.isBroad && P.tags) {
        matchLayer = (e.g && e.g.some(g => P.tags.includes(g))) ? 3 : -1;
      }
      evaluated.push({ e, matchLayer, allL3: false, allTitle: false });
    } else {
      evaluated.push(evalEvent(e, P.matchTerms));
    }
  }

  let selected = [];
  let relaxedStep = null;

  function getCandidatesForFilter(dayCheck, windowCheck, minLayerThreshold) {
    const res = [];
    for (const item of evaluated) {
      if (item.matchLayer < minLayerThreshold) continue;
      const e = item.e;
      /* An entry whose slots blanket 14+ hours of one day is an always-on
         ambient thing (the radio station), not a start a person shows up for. */
      let coveredMs = 0;
      for (const s2 of (e.s || [])) {
        const st2 = slotTimes(s2);
        if (st2) coveredMs += (st2.end - st2.start);
      }
      const isAmbient = coveredMs >= 14 * 3600e3;
      for (const sl of (e.s || [])) {
        if (!sl || !sl[0]) continue;
        const slDay = sl[0].slice(0, 5);
        if (dayCheck && !dayCheck(slDay)) continue;

        const st = slotTimes(sl);
        if (windowCheck && st && !windowCheck(st)) continue;

        const startsInWindow = window && st && st.start >= window.start && st.start < window.end;
        const overlapsWindow = window && st && st.start < window.end && st.end > window.start;
        const slotDuration = st ? (st.end - st.start) / 3600e3 : null;

        const src = SOURCES[e.src] || SOURCES[0];
        let score = item.matchLayer * 1000;

        if (window && st) {
          if (startsInWindow) score += 300;
          else if (overlapsWindow) score += 150;
        }

        /* All-day blobs and running orders rank below real timed starts,
           whether or not the query named a time. */
        if (slotDuration !== null) {
          if (slotDuration <= 4) score += 50;
          else if (slotDuration > 6 || !sl[0].includes(' ')) score -= 60;
        }
        if (isAmbient) score -= 80;

        if (src.tier === 'confirmed') score += 100;

        let mins = null;
        if (P.refLatLon && e.a) {
          mins = minutesTo(P.refLatLon, e.a, speed);
          if (mins !== null) {
            if (mins <= 5) score += 80;
            else if (mins <= 10) score += 60;
            else if (mins <= 20) score += 20;
            else score -= 20;
          }
        }

        if (item.allL3) score += 100;
        if (item.allTitle) score += 60;

        const isLiveNow = !!(st && st.start <= P.nowMs && st.end > P.nowMs);
        const isRunningOrder = !sl[0].includes(' ') || !st;

        res.push({ e, score, slot: sl, mins, live: isLiveNow, runningOrder: isRunningOrder, matchLayer: item.matchLayer });
        break;
      }
    }
    return res;
  }

  const targetDayCheck = P.targetDay ? d => d === P.targetDay : null;
  const windowCheck = window ? st => st.start < window.end && st.end > window.start : null;

  let candidates = getCandidatesForFilter(targetDayCheck, windowCheck, 1);

  if (candidates.length >= MIN_NEEDED) {
    selected = candidates;
  } else {
    if (window && targetDayCheck) {
      const candidatesA = getCandidatesForFilter(targetDayCheck, null, 1);
      if (candidatesA.length >= MIN_NEEDED) {
        selected = candidatesA;
        relaxedStep = 'window_widened';
      }
    }

    if (selected.length < MIN_NEEDED && P.targetDay) {
      const adjDays = getAdjacentDays(P.targetDay);
      const adjCheck = d => adjDays.includes(d);
      const candidatesB = getCandidatesForFilter(adjCheck, null, 1);
      if (candidatesB.length > 0) {
        selected = candidatesB;
        relaxedStep = 'day_adjacent';
      }
    }

    if (selected.length < MIN_NEEDED && P.targetDay) {
      const candidatesC = getCandidatesForFilter(null, null, 1);
      if (candidatesC.length > 0) {
        selected = candidatesC;
        relaxedStep = 'day_any';
      }
    }

    if (selected.length < MIN_NEEDED && P.matchTerms && P.matchTerms.length >= 2) {
      const deadTerms = [];
      const survivingTerms = [];
      for (const term of P.matchTerms) {
        const tLow = term.toLowerCase();
        const hasCoarse = !!(CAT_MAP[tLow] || TAGS.includes(tLow));
        let maxL = -1;
        let maxL3 = -1;
        for (let i = 0; i < EV.length; i++) {
          const l = getTermMatchLayer(EV[i], term);
          if (l > maxL) maxL = l;
          if (l >= 2 && l > maxL3) maxL3 = l;
          if (maxL >= 3) break;
        }
        if (maxL <= 0 || (maxL3 < 2 && !hasCoarse)) deadTerms.push(term);
        else survivingTerms.push(term);
      }

      if (deadTerms.length > 0) {
        relaxedStep = null;
        if (survivingTerms.length > 0) {
          P.relaxed.push('partial_match');
          P.widened = true;

          const deadCoarseTags = [];
          for (const dt of deadTerms) {
            const dtLow = dt.toLowerCase();
            const coarse = CAT_MAP[dtLow] || (TAGS.includes(dtLow) ? [dtLow] : null);
            if (coarse) deadCoarseTags.push(...coarse);
          }

          evaluated.length = 0;
          for (let i = 0; i < EV.length; i++) {
            const item = evalEvent(EV[i], survivingTerms);
            if (deadCoarseTags.length > 0 && item.matchLayer < 0) {
              if (item.e.g && item.e.g.some(g => deadCoarseTags.includes(g))) {
                item.matchLayer = 0;
              }
            }
            evaluated.push(item);
          }

          const rerunCand = getCandidatesForFilter(targetDayCheck, windowCheck, 1);
          if (rerunCand.length >= MIN_NEEDED) {
            selected = rerunCand;
          } else {
            if (window && targetDayCheck) {
              const candA = getCandidatesForFilter(targetDayCheck, null, 1);
              if (candA.length >= MIN_NEEDED) {
                selected = candA;
                relaxedStep = 'window_widened';
              }
            }
            if (selected.length < MIN_NEEDED && targetDayCheck) {
              const candD = getCandidatesForFilter(targetDayCheck, windowCheck, 0);
              if (candD.length > 0) {
                selected = candD;
                relaxedStep = 'category_broadened';
              }
            }
            if (selected.length < MIN_NEEDED && P.targetDay) {
              const adjDays = getAdjacentDays(P.targetDay);
              const candB = getCandidatesForFilter(d => adjDays.includes(d), null, 1);
              if (candB.length > 0) {
                selected = candB;
                relaxedStep = 'day_adjacent';
              }
            }
            if (selected.length < MIN_NEEDED && P.targetDay) {
              const candC = getCandidatesForFilter(null, null, 1);
              if (candC.length > 0) {
                selected = candC;
                relaxedStep = 'day_any';
              }
            }
          }
        } else {
          let hasCoarse = false;
          const deadCoarseTags = [];
          for (const dt of deadTerms) {
            const dtLow = dt.toLowerCase();
            const coarse = CAT_MAP[dtLow] || (TAGS.includes(dtLow) ? [dtLow] : null);
            if (coarse) { hasCoarse = true; deadCoarseTags.push(...coarse); }
          }
          if (hasCoarse) {
            evaluated.length = 0;
            for (let i = 0; i < EV.length; i++) {
              const e = EV[i];
              const matchLayer = (e.g && e.g.some(g => deadCoarseTags.includes(g))) ? 0 : -1;
              evaluated.push({ e, matchLayer, allL3: false, allTitle: false });
            }
            const candD = getCandidatesForFilter(targetDayCheck, windowCheck, 0);
            if (candD.length > 0) {
              selected = candD;
              relaxedStep = 'category_broadened';
            }
          }
        }
      }
    }

    if (selected.length < MIN_NEEDED) {
      const candidatesD = getCandidatesForFilter(targetDayCheck, windowCheck, 0);
      if (candidatesD.length > 0 && selected.length === 0) {
        selected = candidatesD;
        relaxedStep = 'category_broadened';
      }
    }

    if (selected.length === 0) {
      selected = candidates;
    }
  }

  if (relaxedStep) {
    P.relaxed.push(relaxedStep);
    P.widened = true;
  }

  const activeDayCheck = (relaxedStep !== 'day_any' && relaxedStep !== 'day_adjacent') ? targetDayCheck : null;
  const activeWinCheck = (relaxedStep !== 'window_widened') ? windowCheck : null;
  selected = collapseCandidates(selected, activeDayCheck, activeWinCheck, !!(P.campFilter || P.isBroad || P.intent === 'open_rec'));

  selected.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const as = slotTimes(a.slot), bs = slotTimes(b.slot);
    if (as && bs) return as.start - bs.start;
    if (as) return -1; if (bs) return 1; return 0;
  });

  let top = [];
  if (P.isBroad || P.intent === 'open_rec') {
    const campCount = {};
    const tagCount = {};
    const sel = [];
    const def = [];

    for (const x of selected) {
      const camp = x.e.c || 'unknown';
      const tag = (x.e.g && x.e.g[0]) || 'other';

      const cCount = campCount[camp] || 0;
      const tCount = tagCount[tag] || 0;

      if (cCount < 2 && tCount < 3) {
        sel.push(x);
        campCount[camp] = cCount + 1;
        tagCount[tag] = tCount + 1;
      } else {
        def.push(x);
      }
      if (sel.length >= 18) break;
    }
    if (sel.length < 12) {
      for (const x of def) {
        const camp = x.e.c || 'unknown';
        if ((campCount[camp] || 0) < 2) {
          sel.push(x);
          campCount[camp] = (campCount[camp] || 0) + 1;
        }
        if (sel.length >= 16) break;
      }
    }
    top = sel;
  } else {
    const LIMIT = opts.limit || 60;
    top = selected.slice(0, LIMIT);
  }

  return { parsed: P, hits: selected.length, weakMatch: P.relaxed.length > 0, candidates: top };
}

function cardFor(x) {
  const e = x.e;
  const slot = x.slot;
  const src = SOURCES[e.src] || SOURCES[0];
  const prov = x.runningOrder
    ? { label: 'running order, no set time', who: 'running order only with no clock time', tier: 'unverified' }
    : { label: src.label, who: src.who, tier: src.tier };
  return {
    id: e.id, t: e.t, c: e.c, a: e.a, p: e.p, n: e.d, src: e.src, g: e.g,
    s: e.s, slot: slot,
    w: (slot && slot[0]) ? slot[0] + '-' + (slot[1] || '') : '',
    key: (slot && slot[0]) || '', d: x.mins, prov
  };
}

function whenText(slot) {
  const st = slotTimes(slot);
  if (!st) return 'RUNNING ORDER, no set time';
  const d = new Date(st.start), e2 = new Date(st.end);
  const hh = n => String(n.getUTCHours()).padStart(2, '0') + ':' + String(n.getUTCMinutes()).padStart(2, '0');
  return fmtDay(st.start) + ' ' + hh(d) + '-' + hh(e2);
}

const ADDR_IN_TEXT = /\b(\d{1,2})(?::(\d{2}))?\s*(?:&|and|@)\s*(esp|esplanade|[a-k])\b/i;
function addrFromText(e) {
  const m = ADDR_IN_TEXT.exec((e.t || '') + ' ' + (e.d || ''));
  if (!m) return null;
  const h = +m[1]; if (h < 2 || h > 10) return null;
  const mm = m[2] ? m[2] : '00';
  const st = /^esp/i.test(m[3]) ? 'ESP' : m[3].toUpperCase();
  return h + ':' + mm + ' & ' + st;
}

function promptLines(candidates, nowMs) {
  const out = [];
  for (let i = 0; i < candidates.length; i++) {
    const x = candidates[i], e = x.e;
    const parts = ['[' + (i + 1) + ']', '"' + e.t + '"', 'camp: ' + (e.c || 'unknown')];
    if (e.a) parts.push('address: ' + e.a);
    else {
      const guess = addrFromText(e);
      parts.push(guess ? 'address: not given as a field, but the listing text says ' + guess : 'address: not given in the listing');
    }
    parts.push('when: ' + whenText(x.slot));
    if (x.live) parts.push('STATUS: happening right now');
    if (e.p) parts.push('lineup: ' + e.p.slice(0, 220));
    else if (e.d && e.d !== e.t) parts.push('about: ' + e.d.slice(0, 180));
    if (e.g && e.g.length) parts.push('tags: ' + e.g.join(', '));
    const src = SOURCES[e.src] || SOURCES[0];
    parts.push('source: ' + src.label + ' (' + src.tier + ')');
    if (x.mins !== null && x.mins !== undefined) parts.push(x.mins + ' min away');
    out.push(parts.join(' | '));
  }
  let text = out.join('\n');
  while (text.length > 14000 && out.length > 5) { out.pop(); text = out.join('\n'); }
  return text;
}

module.exports = { loadGuide, SOURCES, TAGS, CAT_MAP, parseAddr, minutesTo, playaNow, fmtStamp, fmtDay,
  slotTimes, scopeCheck, REFUSAL, parseQuery, retrieve, cardFor, promptLines, whenText, vocab };
