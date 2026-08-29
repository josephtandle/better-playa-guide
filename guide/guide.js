/* Better Playa Guide: all client-side, no network at runtime. MIT. */
(function(){
  'use strict';
  var D = window.__GUIDE__ || {};
  var EV = (D.ev && D.ev.e) || [], MAP = D.map || {}, PICKS = D.picks || [], PIN = D.pinned || null;
  var RING = {}; ((D.ev && D.ev.rings) || []).forEach(function(r){ RING[r[0]] = r[1]; });
  var MAN = (D.ev && D.ev.man) || [0,0], FLAT = (D.ev && D.ev.flat) || 364000, FLON = (D.ev && D.ev.flon) || 275000;
  var $ = function(id){ return document.getElementById(id); };
  /* accent-fold both sides of every text match, so "muse cafe" finds "MUSE Café" */
  var FOLD_RE=/[\u0300-\u036f]/g;
  function fold(s){ return String(s||'').toLowerCase().normalize('NFD').replace(FOLD_RE,''); }
  /* ---- smart search: tokens, filler words dropped, squashed-space and
     typo-tolerant matching ("rhymewave camp events" finds RhythmWave) ---- */
  var STOPW = new Set(['camp','camps','event','events','the','a','an','at','is','are','was','when','whens','what','whats','where','wheres','who','whos','how','hows','im','id','ill','in','on','of','for','to','and','or','me','my','their','there','show','find','all','any','list','playing','play','happening','schedule','stuff','things','going','does','do','can','get','near','around','tonight','tonite','today','tomorrow','now']);
  var VOCAB = null, CORPUS = '';
  function buildVocab(){
    if (VOCAB) return;
    VOCAB = [];
    var seen = new Set();
    for (var i = 0; i < EV.length; i++){
      var words = fold((EV[i].t||'') + ' ' + (EV[i].c||'') + ' ' + (EV[i].k||'') + ' ' + (EV[i].p||'')).split(/[^a-z0-9]+/);
      /* squashed camp and aka names too, so a one-word guess like "rhymewave"
         can land on a camp however it spaces its name */
      words.push(fold(EV[i].c||'').replace(/[^a-z0-9]+/g,''), fold(EV[i].k||'').replace(/[^a-z0-9]+/g,''));
      for (var j = 0; j < words.length; j++){
        var w = words[j];
        if (w.length >= 3 && !seen.has(w)){ seen.add(w); VOCAB.push(w); }
      }
    }
    /* membership corpus also includes description words: a word that exists
       anywhere in the data must never be "corrected" away */
    var descSeen = [];
    for (var k = 0; k < EV.length; k++){
      var dw = fold(EV[k].d || '').split(/[^a-z0-9]+/);
      for (var m2 = 0; m2 < dw.length; m2++){
        if (dw[m2].length >= 3 && !seen.has(dw[m2])){ seen.add(dw[m2]); descSeen.push(dw[m2]); }
      }
    }
    CORPUS = ' ' + VOCAB.join(' ') + ' ' + descSeen.join(' ') + ' ';
  }
  function editDist(a, b, cap){
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++){
      cur[0] = i;
      var rowMin = i;
      for (j = 1; j <= b.length; j++){
        cur[j] = Math.min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (a[i-1] === b[j-1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > cap) return cap + 1;
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[b.length];
  }
  var REMAP_CACHE = {};
  function fuzzyRemap(tok){
    /* token appears nowhere in the data: swap it for the closest real word */
    if (REMAP_CACHE.hasOwnProperty(tok)) return REMAP_CACHE[tok];
    buildVocab();
    /* whole-word membership: "izza" hiding inside "pizza" is not the word "izza" */
    if (CORPUS.indexOf(' ' + tok + ' ') !== -1) { REMAP_CACHE[tok] = tok; return tok; }
    var cap = tok.length >= 9 ? 3 : (tok.length >= 7 ? 2 : (tok.length >= 4 ? 1 : 0));
    if (!cap) return tok;
    var best = null, bestD = cap + 1;
    for (var i = 0; i < VOCAB.length; i++){
      var d = editDist(tok, VOCAB[i], cap);
      if (d < bestD || (d === bestD && best && VOCAB[i][0] === tok[0] && best[0] !== tok[0])){ bestD = d; best = VOCAB[i]; }
      if (bestD === 0) break;
    }
    var out = (best && bestD <= cap) ? best : tok;
    REMAP_CACHE[tok] = out;
    return out;
  }
  function queryTokens(q){
    var words = q.split(/[^a-z0-9]+/).filter(function(w){ return w && !STOPW.has(w); });
    if (!words.length && q.trim()) words = q.split(/[^a-z0-9]+/).filter(Boolean); /* all-filler query: keep as typed */
    return words.map(fuzzyRemap);
  }
  /* ---- clock-time expressions: "coffee at 8am", "after 10 tonight" ----
     Returns {q: cleanedQuery, from: minutes|null, to: minutes|null} where
     minutes are minutes-of-day. "at X" makes a window X-30min..X+2h30. */
  function parseTimeExpr(q){
    var from = null, to = null;
    /* "8:15 & E" / "3:00 and C" is an ADDRESS, not a time */
    if (/\d{1,2}(?::\d{2})?\s*(?:&|and)\s*(?:esplanade|esp\b|[a-l]\b(?!\s+\w))/i.test(q)) return { q: q, from: null, to: null };
    var morningish = /\bmorning\b|\bsunrise\b|\bbreakfast\b|\bbrunch\b|\bdawn\b|\byoga\b|\bcoffee\b|\bkids?\b|\bfamily\b|\bchildren\b|\bam\b/.test(q);
    var nightish = !morningish; /* at a festival a bare "party at 10" means 22:00 */
    function toMin(h, m, ap){
      h = +h; m = +(m || 0);
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      if (!ap && h <= 11 && nightish) h += 12;
      return h * 60 + m;
    }
    var re = /\b(at|after|before|from)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(at|after|before|from)\s+(\d{1,2})(?::(\d{2}))?\b/;
    var m = re.exec(q);
    if (!m) return { q: q, from: null, to: null };
    var word = (m[1] || m[5] || 'at').toLowerCase();
    var rawH = +(m[4] !== undefined ? m[2] : m[6]);
    if (!(rawH >= 0 && rawH <= 23)) return { q: q, from: null, to: null }; /* "Tower 69" is not 69 o'clock */
    var mins = m[4] !== undefined ? toMin(m[2], m[3], m[4]) : toMin(m[6], m[7], null);
    if (word === 'after' || word === 'from') { from = mins; to = (mins + 480) % 1440; /* "after 10pm" runs into the sunrise hours */ }
    else if (word === 'before') { to = mins; }
    else { from = ((mins - 30) + 1440) % 1440; to = (mins + 150) % 1440; }
    var cleaned = q.replace(re, ' ').replace(/\s+/g, ' ').trim();
    return { q: cleaned, from: from, to: to };
  }
  function minsOf(hmStr){
    var hm = /(\d{2}):(\d{2})$/.exec(String(hmStr || ''));
    return hm ? (+hm[1]) * 60 + (+hm[2]) : null;
  }
  function inWin(mins, from, to){
    if (mins === null) return false;
    if (from !== null && to !== null && from > to) return mins >= from || mins <= to; /* window over midnight */
    if (from !== null && mins < from) return false;
    if (to !== null && mins > to) return false;
    return true;
  }
  function slotInWindow(slot, from, to){
    /* slot ["MM-DD HH:MM","HH:MM"]: match if the RUNNING event overlaps the
       window, so a 23:30-02:00 set is found by "at 1am" (interval overlap,
       midnight-aware on both sides) */
    if (!slot || typeof slot[0] !== 'string') return false;
    var s = minsOf(slot[0]);
    if (s === null) return false;
    if (inWin(s, from, to)) return true;
    var e2 = minsOf(slot[1]);
    if (e2 === null) return false;
    if (inWin(e2, from, to)) return true;
    /* window fully inside the running span */
    var probe = from !== null ? from : to;
    if (probe === null) return false;
    if (e2 <= s) e2 += 1440; /* set wraps midnight */
    var pp = probe < s ? probe + 1440 : probe;
    return pp >= s && pp <= e2;
  }
  var HAYS = [];
  function eventHay(e, i){
    if (HAYS[i]) return HAYS[i];
    var hay = fold(e.t + ' ' + e.c + ' ' + (e.k ? e.k + ' ' : '') + e.p + ' ' + e.d);
    HAYS[i] = [hay, hay.replace(/[^a-z0-9]+/g, '')];
    return HAYS[i];
  }
  var BOUND_CACHE = {};
  function matchTokens(tokens, hayPair){
    var joined = null;
    for (var i = 0; i < tokens.length; i++){
      var tok = tokens[i];
      var hit;
      if (tok.length <= 4){
        /* short tokens match whole words only, so "art" stops matching "party" */
        var re = BOUND_CACHE[tok] || (BOUND_CACHE[tok] = new RegExp('(^|[^a-z0-9])' + tok.replace(/[^a-z0-9]/g, ''), 'i'));
        hit = re.test(hayPair[0]);
      } else {
        hit = hayPair[0].indexOf(tok) !== -1 || hayPair[1].indexOf(tok) !== -1;
      }
      if (!hit){
        /* "rhythm wave" typed as two words still matches the squashed camp name */
        if (joined === null) joined = tokens.join('');
        if (tokens.length > 1 && joined.length >= 6 && hayPair[1].indexOf(joined) !== -1) return true;
        return false;
      }
    }
    return true;
  }
  var TAGS = ['workshop','talk','party','music','food','drink','adult','wellness','art','ritual','game'];
  var active = new Set(), shown = 60, here = null, speed = 12;

  /* ---- Stars preference store ---- */
  var STAR_PREF = 'bpg.stars';
  var starred = new Set();
  try {
    var rawStars = JSON.parse(localStorage.getItem(STAR_PREF) || '[]');
    if (Array.isArray(rawStars)) {
      rawStars.forEach(function(st){ starred.add(st); });
    }
  } catch(e){}

  var mylistOnly = false;

  /* ---- Your own private events (camp shifts, weddings). localStorage only:
     never sent to any server, never in share links, PDFs or subscribe feeds.
     They live and die on this phone, and the UI says so. ---- */
  var OWN_PREF = 'bpg.ownevents';
  var ownEvents = [];
  try {
    var rawOwn = JSON.parse(localStorage.getItem(OWN_PREF) || '[]');
    if (Array.isArray(rawOwn)) ownEvents = rawOwn.filter(function(o){ return o && o.t; });
  } catch(e){}
  function saveOwnEvents(){
    try { localStorage.setItem(OWN_PREF, JSON.stringify(ownEvents)); } catch(e){}
  }

  /* ---- Repair doubled descriptions from the payload ("X X" -> "X").
     data.js ships ~3,400 records whose description is the same text twice.
     The payload is generated elsewhere, so undouble at load time. ---- */
  function undouble(s){
    if (!s) return s;
    var t = String(s).replace(/\s+/g, ' ').trim();
    var n = t.length;
    if (n < 24) return s;
    var h = Math.floor(n / 2);
    var a = t.slice(0, h).trim(), b = t.slice(n - h).trim();
    if (a && a === b) return a;
    return s;
  }

  /* ---- Derive stable event IDs ---- */
  for (var i = 0; i < EV.length; i++) {
    var e = EV[i];
    e.d = undouble(e.d);
    e.id = e.t + '|' + e.c + '|' + (e.s && e.s[0] && e.s[0][0] || '');
  }
  if (PIN) {
    PIN.id = PIN.t + '|' + PIN.c + '|' + (PIN.w || '');
  }
  PICKS.forEach(function(p){
    p.id = p.t + '|' + p.c + '|' + (p.w || '');
  });

  /* ---- Stable 8-character Hashing for Shareable Lists ---- */
  function hashId(str) {
    var hash = 0x811c9dc5;
    for (var k = 0; k < str.length; k++) {
      hash ^= str.charCodeAt(k);
      hash = (hash * 0x01000193) >>> 0;
    }
    var hex = hash.toString(16);
    while (hex.length < 8) hex = '0' + hex;
    return hex;
  }

  var HASH_TO_ID = {};
  var ID_TO_HASH = {};
  /* title|camp -> id, for migrating stars saved against an older data vintage
     (slot times shift between data updates, changing the full id). */
  var TC_TO_ID = {};
  var tcCollisions = {};
  for (var hi = 0; hi < EV.length; hi++) {
    var eid = EV[hi].id;
    var h = hashId(eid);
    HASH_TO_ID[h] = eid;
    ID_TO_HASH[eid] = h;
    var tcKey = EV[hi].t + '|' + EV[hi].c;
    if (TC_TO_ID.hasOwnProperty(tcKey)) tcCollisions[tcKey] = true;
    else TC_TO_ID[tcKey] = eid;
  }
  /* Durable alias hashes: hashId(title|camp) also resolves, so share links
     survive slot-time churn between data updates. Unique title|camp only. */
  for (var tk in TC_TO_ID) {
    if (tcCollisions[tk]) continue;
    var ah = hashId(tk);
    if (!HASH_TO_ID[ah]) HASH_TO_ID[ah] = TC_TO_ID[tk];
  }

  /* ---- Migrate stale star ids to the current data vintage ----
     A star saved when an event's first slot was different no longer matches
     any current id. Re-match by title|camp; drop only what truly vanished.
     Without this, getShareableLink() used to hash the stale raw id into a
     garbage hash no version of the guide could ever resolve. */
  (function migrateStars(){
    var changed = false;
    var next = new Set();
    starred.forEach(function(sid){
      if (ID_TO_HASH[sid]) { next.add(sid); return; }
      var parts = String(sid).split('|');
      var tc = parts.slice(0, 2).join('|');
      if (TC_TO_ID[tc] && !tcCollisions[tc]) { next.add(TC_TO_ID[tc]); changed = true; return; }
      /* keep the stale id: a future data update may bring the event back */
      next.add(sid);
    });
    if (changed) {
      starred = next;
      try { localStorage.setItem(STAR_PREF, JSON.stringify(Array.from(starred))); } catch(e){}
    }
  })();

  /* ---- RENDER-LAYER DEDUPLICATION ---- */
  var GROUPS = [];
  var groupMap = {};
  for (var gi = 0; gi < EV.length; gi++) {
    var item = EV[gi];
    var gKey = item.t + '|' + item.c + '|' + (item.a || '');
    if (!groupMap[gKey]) {
      var groupObj = {
        id: item.id,
        t: item.t,
        c: item.c,
        a: item.a,
        p: item.p,
        d: item.d,
        k: item.k,
        src: item.src,
        g: item.g ? item.g.slice() : [],
        f: item.f ? item.f.slice() : [],
        s: [],
        allIds: []
      };
      groupMap[gKey] = groupObj;
      GROUPS.push(groupObj);
    }
    var targetGroup = groupMap[gKey];
    if (!targetGroup.k && item.k) targetGroup.k = item.k;
    /* different days of the same listing carry different lineups: merge every
       distinct presenter/description so search sees the whole week */
    if (item.p && targetGroup.p.indexOf(item.p) === -1) targetGroup.p = targetGroup.p ? targetGroup.p + ', ' + item.p : item.p;
    if (item.d && targetGroup.d.indexOf(item.d) === -1) targetGroup.d = targetGroup.d ? targetGroup.d + ' ' + item.d : item.d;
    if (targetGroup.allIds.indexOf(item.id) === -1) {
      targetGroup.allIds.push(item.id);
    }
    if (item.s) {
      for (var sj = 0; sj < item.s.length; sj++) {
        targetGroup.s.push(item.s[sj]);
      }
    }
    if (item.g) {
      for (var tg = 0; tg < item.g.length; tg++) {
        if (targetGroup.g.indexOf(item.g[tg]) === -1) {
          targetGroup.g.push(item.g[tg]);
        }
      }
    }
    if (item.f) {
      for (var tf = 0; tf < item.f.length; tf++) {
        if (targetGroup.f.indexOf(item.f[tf]) === -1) {
          targetGroup.f.push(item.f[tf]);
        }
      }
    }
  }

  var DAY_NAMES = {
    '08-30': 'Sun', '08-31': 'Mon', '09-01': 'Tue', '09-02': 'Wed',
    '09-03': 'Thu', '09-04': 'Fri', '09-05': 'Sat', '09-06': 'Sun', '09-07': 'Mon'
  };

  function formatMergedSchedule(slots, dayFilter) {
    if (!slots || slots.length === 0) return '';
    var activeSlots = slots;
    if (dayFilter) {
      var filtered = slots.filter(function(st) {
        return st[0] && st[0].indexOf(dayFilter) === 0;
      });
      if (filtered.length > 0) activeSlots = filtered;
    }
    var unique = [];
    var seen = {};
    for (var i = 0; i < activeSlots.length; i++) {
      var st = activeSlots[i];
      var k = st[0] + '|' + (st[1] || '');
      if (!seen[k]) {
        seen[k] = true;
        unique.push(st);
      }
    }
    /* A slot with no start has neither a day nor a time, so it cannot be placed on
       a timeline. Drop those, and fall back to plain words if nothing else is left. */
    var dated = [];
    for (var dz = 0; dz < unique.length; dz++) {
      if (typeof unique[dz][0] === 'string' && unique[dz][0]) dated.push(unique[dz]);
    }
    if (dated.length === 0) return 'no set time';
    unique = dated;

    if (unique.length === 1) {
      /* Friendly, day-first wording: never show a raw MM-DD to a human. */
      var sp = unique[0][0].split(' ');
      if (unique[0][0].indexOf(' ') === -1) {
        return dayLabel(sp[0]) + ', no set time';
      }
      return dayLabel(sp[0]) + ' · ' + sp[1] + (unique[0][1] ? '-' + unique[0][1] : '');
    }
    var firstTime = null;
    var allSameTime = true;
    var days = [];
    for (var j = 0; j < unique.length; j++) {
      var parts = unique[j][0].split(' ');
      var day = parts[0];
      var time = (parts[1] || '') + (unique[j][1] ? '-' + unique[j][1] : '');
      if (firstTime === null) firstTime = time;
      else if (firstTime !== time) allSameTime = false;
      if (days.indexOf(day) === -1) days.push(day);
    }
    var dayLabels = [];
    for (var d = 0; d < days.length; d++) {
      dayLabels.push(DAY_NAMES[days[d]] || days[d]);
    }
    if (allSameTime && days.length > 1) {
      if (!firstTime) {
        return dayLabels.join(', ') + ', no set time';
      }
      if (days.length >= 7) {
        return 'Daily ' + firstTime;
      } else {
        return dayLabels.join(', ') + ' ' + firstTime;
      }
    }
    if (days.length >= 7) {
      return 'Daily (multiple slots)';
    }
    if (dayLabels.length > 1 && unique.length > 4) {
      return dayLabels.join(', ') + ' (multiple slots)';
    }
    var formatted = [];
    for (var u = 0; u < Math.min(unique.length, 3); u++) {
      var p = unique[u][0].split(' ');
      var dName = DAY_NAMES[p[0]] || p[0];
      formatted.push(dName + ' ' + (p[1] || '') + (unique[u][1] ? '-' + unique[u][1] : ''));
    }
    if (unique.length > 3) {
      formatted.push('+' + (unique.length - 3) + ' more');
    }
    return formatted.join(' · ');
  }

  /* ---- Forgiving Location Parser ---- */
  var WORD_TO_NUM = {
    'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,
    'seven':7,'eight':8,'nine':9,'ten':10,'eleven':11,'twelve':12
  };

  function parseWhere(str){
    if (!str || typeof str !== 'string') return null;
    var raw = str.trim();
    if (!raw) return null;

    var clean = raw.replace(/^(?:i['’]?m\s+at|we\s+are\s+at|located\s+at|currently\s+at|at)\s+/i, '').trim();
    var cleanLower = clean.toLowerCase().normalize('NFD').replace(FOLD_RE,'');
    var cleanNoThe = cleanLower.replace(/^the\s+/, '');

    /* 1. Landmark check */
    var landmarks = (MAP && MAP.landmarks) || [];
    for (var lmIdx = 0; lmIdx < landmarks.length; lmIdx++) {
      var lm = landmarks[lmIdx];
      var lmNameLower = lm.n.toLowerCase().normalize('NFD').replace(FOLD_RE,'');
      var lmNameNoThe = lmNameLower.replace(/^the\s+/, '').replace(/\s*\(.*\)/, '');
      if (cleanLower === lmNameLower || cleanNoThe === lmNameNoThe || cleanLower === lmNameNoThe) {
        var cx = lm.c[0], cy = lm.c[1];
        return {
          landmark: true,
          label: lm.n,
          lat: MAN[0] - cy / FLAT,
          lon: MAN[1] + cx / FLON
        };
      }
    }

    /* 2. Camp check */
    for (var evIdx = 0; evIdx < EV.length; evIdx++) {
      var evItem = EV[evIdx];
      if (evItem.c && evItem.a) {
        var campLower = evItem.c.toLowerCase().normalize('NFD').replace(FOLD_RE,'');
        var campNoThe = campLower.replace(/^the\s+/, '');
        var akaMatch = evItem.k && (cleanLower === evItem.k.toLowerCase().normalize('NFD').replace(FOLD_RE,'') || cleanNoThe === evItem.k.toLowerCase().normalize('NFD').replace(FOLD_RE,'').replace(/^the\s+/, ''));
        if (cleanLower === campLower || cleanNoThe === campNoThe || akaMatch) {
          var campRes = parseWhere(evItem.a);
          if (campRes && !campRes.error) {
            campRes.camp = evItem.c;
            return campRes;
          }
        }
      }
    }

    /* 3. Address parsing */
    var s = cleanLower;
    s = s.replace(/\bforty[\s-]five\b/g, '45');
    s = s.replace(/\bo'?clock\b/g, ':00');
    s = s.replace(/\b(\d{1,2})\.([0-5]\d)\b/g, '$1:$2');
    s = s.replace(/(\d{1,2}:[0-5]\d)\s*([a-k]|esp|esplanade)\b/gi, '$1 $2');
    s = s.replace(/(\d{1,2})\s*([a-k]|esp|esplanade)\b/gi, '$1 $2');
    s = s.replace(/\bgreat\s+oak\b/g, 'great_oak');
    s = s.replace(/\bthe\s+esplanade\b/g, 'esplanade');

    var rawTokens = s.split(/[\s&,@+]+/).filter(function(t){ return t.length > 0; });
    if (rawTokens.length === 0) return null;

    var hour = null, mins = null, street = null;

    function matchStreetToken(tok){
      if (!tok) return null;
      if (tok === 'esp' || tok === 'esplanade' || tok === 'espl') return 'ESP';
      if (tok === 'great_oak' || tok === 'great' || tok === 'oak') return 'G';
      if (tok === 'eternal' || tok === 'ete') return 'E';
      if (tok.length === 1 && tok >= 'a' && tok <= 'k') return tok.toUpperCase();
      var streets = D.ev && D.ev.streets || {};
      var keys = Object.keys(streets);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var name = streets[k].toLowerCase().normalize('NFD').replace(FOLD_RE,'');
        if (tok === name) return k;
        if (tok.length >= 2 && name.indexOf(tok) === 0 && tok !== 'es') return k;
      }
      return null;
    }

    for (var i = 0; i < rawTokens.length; i++) {
      var tok = rawTokens[i];

      if (!street) {
        var stMatch = matchStreetToken(tok);
        if (stMatch) {
          street = stMatch;
          continue;
        }
      }

      if (hour === null) {
        var mCol = /^(\d{1,2}):([0-5]\d)$/.exec(tok);
        if (mCol) {
          hour = parseInt(mCol[1], 10);
          mins = parseInt(mCol[2], 10);
          continue;
        }
        var mMil = /^0?([1-9]|1[0-2])([0-5]\d)$/.exec(tok);
        if (mMil && tok.length >= 3 && tok !== '100') {
          hour = parseInt(mMil[1], 10);
          mins = parseInt(mMil[2], 10);
          continue;
        }
        if (WORD_TO_NUM[tok] !== undefined) {
          var hNum = WORD_TO_NUM[tok];
          var nextTok = rawTokens[i + 1];
          if (nextTok === 'thirty') { hour = hNum; mins = 30; i++; continue; }
          if (nextTok === 'fifteen') { hour = hNum; mins = 15; i++; continue; }
          if (nextTok === '45' || nextTok === 'forty-five') { hour = hNum; mins = 45; i++; continue; }
          hour = hNum; mins = 0;
          continue;
        }
        var mNum = /^(\d{1,2})$/.exec(tok);
        if (mNum) {
          hour = parseInt(mNum[1], 10);
          mins = 0;
          continue;
        }
      }
    }

    if (street === null || hour === null) return null;

    if (hour < 2 || hour > 10) {
      return { error: 'BRC streets only run from 2:00 to 10:00 (11, 12, and 1 do not exist).' };
    }

    var origHour = hour, origMins = mins;
    var snappedMins = Math.round(mins / 15) * 15;
    var snappedHour = hour;
    if (snappedMins === 60) {
      snappedMins = 0;
      snappedHour = hour + 1;
      if (snappedHour > 10 || snappedHour < 2) {
        return { error: 'BRC streets only run from 2:00 to 10:00.' };
      }
    }

    var wasSnapped = (snappedMins !== origMins || snappedHour !== origHour);
    var clockStr = snappedHour + ':' + (snappedMins < 10 ? '0' + snappedMins : snappedMins);
    var labelStr = clockStr + ' & ' + street;

    var r = RING[street];
    var lat = null, lon = null;
    if (r !== undefined) {
      var clockVal = snappedHour + (snappedMins / 60);
      var b = ((clockVal - 10.5) * 30) * Math.PI / 180;
      lat = MAN[0] + (r * Math.cos(b)) / FLAT;
      lon = MAN[1] + (r * Math.sin(b)) / FLON;
    }

    return {
      clock: clockStr,
      street: street,
      label: labelStr,
      lat: lat,
      lon: lon,
      snapped: wasSnapped
    };
  }

  var addrCache = {};
  function parseAddr(s){
    if (!s || typeof s !== 'string') return null;
    if (addrCache[s] !== undefined) return addrCache[s];
    var p = parseWhere(s);
    if (!p || p.error || p.lat === undefined || p.lat === null) {
      addrCache[s] = null;
      return null;
    }
    var res = { lat: p.lat, lon: p.lon };
    addrCache[s] = res;
    return res;
  }

  function getProximityInfo(hereLoc, speedVal) {
    if (!hereLoc) {
      return { countNow: 0, countLater: 0, text: '', sanityFailed: false, eventsNow: [], eventsLater: [], isFallback: false };
    }
    var playaInfo = getPlayaNow();
    var nowObj = playaInfo.date;
    var nowMs = nowObj.getTime();
    var wStart = nowMs;
    var wEnd = nowMs + 3 * 3600 * 1000;
    var endOfTodayMs = Date.UTC(nowObj.getUTCFullYear(), nowObj.getUTCMonth(), nowObj.getUTCDate(), 23, 59, 59);

    var curSpeed = speedVal || 12;
    var modeVal = $('mode') ? $('mode').value : '12';
    var modeText = modeVal === '3' ? 'on foot' : (modeVal === '8' ? 'on your bike' : 'on your ebike');

    var eventsNow = [];
    var eventsLater = [];

    var prevHere = here;
    var prevSpeed = speed;
    here = hereLoc;
    speed = curSpeed;

    for (var i = 0; i < GROUPS.length; i++) {
      var evItem = GROUPS[i];
      var d = minsTo(evItem.a);
      if (d === null || d > 10) continue;

      var isNow = false;
      var isLater = false;
      var slotNow = null;
      var slotLater = null;

      for (var sidx = 0; sidx < evItem.s.length; sidx++) {
        var slot = evItem.s[sidx];
        var stime = parseSlotTimes(slot);
        if (stime) {
          if (stime.start < wEnd && stime.end > wStart) {
            if (!isNow) { isNow = true; slotNow = slot; }
          } else if (stime.start >= wEnd && stime.start <= endOfTodayMs) {
            if (!isLater) { isLater = true; slotLater = slot; }
          }
        }
      }

      if (isNow) {
        eventsNow.push({ ev: evItem, slot: slotNow, d: d });
      } else if (isLater) {
        eventsLater.push({ ev: evItem, slot: slotLater, d: d });
      }
    }

    here = prevHere;
    speed = prevSpeed;

    var totalEvents = GROUPS.length;
    var totalCount = eventsNow.length + eventsLater.length;
    if (totalCount > 0.15 * totalEvents) {
      console.warn('Proximity count sanity guard failed: ' + totalCount + ' of ' + totalEvents + ' events');
      return {
        countNow: eventsNow.length,
        countLater: eventsLater.length,
        text: '',
        sanityFailed: true,
        eventsNow: eventsNow,
        eventsLater: eventsLater,
        isFallback: playaInfo.isFallback
      };
    }

    var text = '';
    if (eventsNow.length > 0) {
      text = eventsNow.length + (eventsNow.length === 1 ? ' thing within 10 minutes ' : ' things within 10 minutes ') + modeText + '.';
    } else if (eventsLater.length > 0) {
      text = 'Nothing within 10 minutes right now. ' + eventsLater.length + (eventsLater.length === 1 ? ' thing later today.' : ' things later today.');
    } else {
      text = 'Nothing within 10 minutes right now.';
    }

    return {
      countNow: eventsNow.length,
      countLater: eventsLater.length,
      text: text,
      sanityFailed: false,
      eventsNow: eventsNow,
      eventsLater: eventsLater,
      isFallback: playaInfo.isFallback
    };
  }

  function updateLocButton(){
    var btn = $('loc-open-btn');
    if (!btn) return;
    var locVal = ($('loc') ? $('loc').value : '').trim();
    if (!locVal) {
      btn.textContent = 'Set your location';
    } else {
      var p = parseWhere(locVal);
      var label = (p && !p.error && p.label) ? p.label : locVal;
      btn.textContent = label + ' \u270E';
    }
  }

  function updateLocConfirm(val){
    var confirmEl = $('loc-confirm');
    updateLocButton();
    if (!confirmEl) return;
    val = (val || '').trim();
    if (!val) {
      confirmEl.textContent = '';
      confirmEl.className = 'loc-confirm';
      return;
    }
    var p = parseWhere(val);
    if (!p) {
      confirmEl.textContent = 'Not sure where that is. Try 7:30 and E, or Bodhi 9:30, or Center Camp.';
      confirmEl.className = 'loc-confirm invalid';
      return;
    }
    if (p.error) {
      confirmEl.textContent = p.error;
      confirmEl.className = 'loc-confirm invalid';
      return;
    }

    here = { lat: p.lat, lon: p.lon };
    speed = +($('mode') ? $('mode').value : 12) || 12;

    var prox = getProximityInfo(here, speed);
    var countStr = prox.text;

    if (p.landmark) {
      confirmEl.textContent = 'Got it: ' + p.label + (countStr ? ' · ' + countStr : '');
      confirmEl.className = 'loc-confirm valid';
    } else {
      var displayLoc = p.clock + ' & ' + p.street;
      if (p.snapped) {
        confirmEl.textContent = 'Rounded to ' + displayLoc + ', the nearest corner.' + (countStr ? ' ' + countStr : '');
      } else {
        confirmEl.textContent = 'Got it: ' + displayLoc + (countStr ? ' · ' + countStr : '');
      }
      confirmEl.className = 'loc-confirm valid';
    }
  }
  function minsTo(addr){
    var p = here, q = parseAddr(addr);
    if (!p || !q) return null;
    var dn = (q.lat-p.lat)*FLAT, de = (q.lon-p.lon)*FLON;
    return Math.round(Math.hypot(dn, de) / speed / 60);
  }
  /* ---- porta potties: official 2026 GIS toilet-bank centroids ---- */
var TOILETS = [[40.791913,-119.214257],[40.795076,-119.216656],[40.778403,-119.196484],[40.77658,-119.192323],[40.776114,-119.197809],[40.773186,-119.19443],[40.774709,-119.20122],[40.773689,-119.204354],[40.771548,-119.198817],[40.770162,-119.203115],[40.77332,-119.207729],[40.768901,-119.207727],[40.770102,-119.21236],[40.773628,-119.211114],[40.774591,-119.214279],[40.77143,-119.216682],[40.776699,-119.217293],[40.773019,-119.221118],[40.776575,-119.223441],[40.778403,-119.219284],[40.780811,-119.220545],[40.779863,-119.225183],[40.783386,-119.226758],[40.783385,-119.220944],[40.78595,-119.220452],[40.786891,-119.225093],[40.78833,-119.219104],[40.793489,-119.221103],[40.790936,-119.217227],[40.781122,-119.195576],[40.780245,-119.190896],[40.792625,-119.210585],[40.796147,-119.211823],[40.780674,-119.204158],[40.783238,-119.20582],[40.786073,-119.211263],[40.787711,-119.198913],[40.796769,-119.194341],[40.791705,-119.188491],[40.798651,-119.206697],[40.800281,-119.203537],[40.797871,-119.20141],[40.777736,-119.185546],[40.777305,-119.183859],[40.789769,-119.22239]];
  function nearestPotty(p){
    if (!p) return null;
    var best = null, bestFt = Infinity;
    for (var i = 0; i < TOILETS.length; i++){
      var dn = (TOILETS[i][0] - p.lat) * FLAT, de = (TOILETS[i][1] - p.lon) * FLON;
      var ft = Math.hypot(dn, de);
      if (ft < bestFt){ bestFt = ft; best = TOILETS[i]; }
    }
    if (!best) return null;
    /* compass bearing user -> potty, translated to the city's clock face */
    var brg = Math.atan2((best[1] - p.lon) * FLON, (best[0] - p.lat) * FLAT) * 180 / Math.PI;
    var clock = ((brg / 30) + 10.5) % 12; if (clock < 0) clock += 12;
    var h = Math.round(clock * 2) / 2; if (h === 0) h = 12;
    var hh = Math.floor(h), mm = (h % 1) ? ':30' : ':00';
    return { ft: Math.round(bestFt), min: Math.max(1, Math.round(bestFt / 3 / 60)), clock: hh + mm };
  }
  function initPotty(){
    var btn = $('potty-btn');
    if (!btn) return;
    btn.addEventListener('click', function(){
      var note = $('potty-note');
      if (!note) return;
      if (!here){ note.textContent = 'Set your location first, then I can point you.'; note.style.display = ''; return; }
      var n = nearestPotty(here);
      if (!n){ note.textContent = 'No potty data. That should not happen; go by the smell.'; note.style.display = ''; return; }
      note.textContent = '🚽 Nearest bank: about ' + n.min + ' min walk (' + n.ft + ' ft), head toward the ' + n.clock + ' direction on the clock.';
      note.style.display = '';
    });
  }
  /* Every generated attribute in this file is double-quoted, but escape the
     single quote too so one future data-x='...' cannot become an XSS hole. */
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  /* ---- preferences: local only ---- */
  var PREF = 'bpg.prefs';
  function loadPrefs(){
    try {
      var p = JSON.parse(localStorage.getItem(PREF) || '{}');
      if (p.loc && $('loc')) $('loc').value = p.loc;
      if (p.mode && $('mode')) $('mode').value = p.mode;
      if (p.tags) p.tags.forEach(function(t){ active.add(t); });
      if ($('confirmed-only')) $('confirmed-only').checked = localStorage.getItem('bpg.confirmedOnly') === 'true';
    } catch(e){}
  }
  function savePrefs(){
    try {
      localStorage.setItem(PREF, JSON.stringify({
        loc: $('loc') ? $('loc').value : '',
        mode: $('mode') ? $('mode').value : '12',
        tags: Array.from(active)
      }));
    } catch(e){}
  }

  function saveStars(){
    invalidateStarCache();
    try {
      localStorage.setItem(STAR_PREF, JSON.stringify(Array.from(starred)));
    } catch(e){}
  }
  function updateStarCount(){
    /* the count lives in the My Events tab badge; empty string hides it at 0 */
    var sc = $('star-count');
    if (sc) sc.textContent = starred.size ? String(starred.size) : '';
  }

  function toast(msg){
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on');
    setTimeout(function(){ t.classList.remove('on'); }, 2200);
  }

  /* ---- FEATURE C: SHAREABLE STARRED LISTS ---- */
  var URL_ = 'https://musecafe.vip/guide/';
  var SHARE_TEXT = 'Better Playa Guide: every Burning Man 2026 event, searchable by where you\'re standing. Works with no signal. A gift from Muse Cafe.';

  /* The one place star ids become share hashes. Prefer the durable
     title|camp hash (survives slot churn); fall back to the full-id hash.
     Never hash a stale id the receiver can't resolve: that produced dead
     links that merged zero events. */
  function shareHashes(){
    var arr = Array.from(starred);
    var hashes = [];
    for (var k = 0; k < arr.length; k++) {
      var id = arr[k];
      if (!ID_TO_HASH[id]) continue;
      var parts = String(id).split('|');
      var tc = parts.slice(0, 2).join('|');
      var h = (!tcCollisions[tc] && TC_TO_ID[tc] === id) ? hashId(tc) : ID_TO_HASH[id];
      if (h && hashes.indexOf(h) === -1) hashes.push(h);
    }
    return hashes;
  }

  function getShareableLink(){
    var hashes = shareHashes();
    var loc = window.location || {};
    var base = loc.origin ? (loc.origin + loc.pathname) : URL_;
    if (hashes.length === 0) return base;
    return base + '#l=' + hashes.join(',');
  }

  function checkShareHash(){
    var loc = window.location || {};
    var hash = loc.hash || '';
    var match = /#l=([a-f0-9,]+)/i.exec(hash);
    var banner = $('shared-list-banner');
    if (!match) {
      if (banner) banner.style.display = 'none';
      return;
    }
    var rawHashes = match[1].split(',');
    var validIds = [];
    var missingCount = 0;
    for (var i = 0; i < rawHashes.length; i++) {
      var h = rawHashes[i].trim().toLowerCase().normalize('NFD').replace(FOLD_RE,'');
      if (h) {
        if (HASH_TO_ID[h]) {
          if (validIds.indexOf(HASH_TO_ID[h]) === -1) validIds.push(HASH_TO_ID[h]);
        } else {
          missingCount++;
        }
      }
    }

    /* Fresh device (no stars yet): merge automatically. On a new phone the
       onboarding modal covers the banner, and people read "nothing came
       over" instead of finding the Merge button. Additive, nothing to lose. */
    if (starred.size === 0 && validIds.length > 0) {
      for (var am = 0; am < validIds.length; am++) starred.add(validIds[am]);
      saveStars();
      updateStarCount();
      toast(validIds.length + (validIds.length === 1 ? ' event' : ' events') + ' added to My Events.');
      if (banner) banner.style.display = 'none';
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', loc.pathname + (loc.search || ''));
      }
      window.location.hash = '#myevents';
      applyHashMode();
      return;
    }

    if (banner) {
      banner.style.display = '';
      var titleEl = $('shared-title');
      var noteEl = $('shared-note');
      if (titleEl) titleEl.textContent = 'This link carries ' + validIds.length + (validIds.length === 1 ? ' starred event' : ' starred events') + '. Merge ' + (validIds.length === 1 ? 'it' : 'them') + ' into yours?';
      if (noteEl) {
        var noteStr = 'Tap Merge and everything starred in this link comes across into your own My Events list.';
        if (missingCount > 0) {
          noteStr += ' ' + missingCount + (missingCount === 1 ? ' item is' : ' items are') + ' not in this version of the guide.';
        }
        noteEl.textContent = noteStr;
      }
      var mergeBtn = $('merge-stars-btn');
      if (mergeBtn) {
        mergeBtn.onclick = function(){
          for (var m = 0; m < validIds.length; m++) {
            starred.add(validIds[m]);
          }
          saveStars();
          updateStarCount();
          toast(validIds.length + (validIds.length === 1 ? ' event' : ' events') + ' added to My Events.');
          banner.style.display = 'none';
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', loc.pathname + (loc.search || ''));
          } else {
            window.location.hash = '';
          }
          /* land the receiver on their merged list so the migration is visible */
          window.location.hash = '#myevents';
          applyHashMode();
        };
      }
      var dismissBtn = $('dismiss-shared-btn');
      if (dismissBtn) {
        dismissBtn.onclick = function(){
          banner.style.display = 'none';
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', loc.pathname + (loc.search || ''));
          } else {
            window.location.hash = '';
          }
          render();
        };
      }
    }
  }

  /* One share implementation for every share/copy button on the page.
     #share/#copylink (header) and #myevents-share-btn/#myevents-copy-btn
     (My Events) all land here. */
  function copyShareLink(targetUrl){
    var urlToCopy = targetUrl || ((starred.size > 0 || mylistOnly) ? getShareableLink() : URL_);
    var txt = SHARE_TEXT + ' ' + urlToCopy;
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(
      function(){ toast('Link copied to clipboard'); },
      function(){ toast(urlToCopy); });
    else toast(urlToCopy);
  }
  function doShare(){
    var shareUrl = (starred.size > 0 || mylistOnly) ? getShareableLink() : URL_;
    if (navigator.share) {
      navigator.share({ title:'Better Playa Guide', text:SHARE_TEXT, url:shareUrl }).catch(function(){});
    } else { copyShareLink(shareUrl); }
  }
  function wireShare(){
    var s = $('share'), c = $('copylink');
    if (s) s.addEventListener('click', doShare);
    if (c) c.addEventListener('click', function(){ copyShareLink(); });
  }

  /* ---- Provenance & Trust Tiers ---- */
  var SRC = {
    0: {label:'WWW Guide',    who:'the official Who What Where guide from Burning Man', tier:'confirmed'},
    1: {label:'Camp Website', who:"the camp's own official website",   tier:'confirmed'},
    2: {label:'Camp IG',      who:"the camp's own Instagram",          tier:'reported'},
    3: {label:'RSL',          who:'Rock Star Librarian, the long-running DJ set list', tier:'confirmed'},
    4: {label:'Flyer',        who:'Playa Set Library, transcribed from set-time flyers by hand', tier:'reported'},
    5: {label:'Telegram',     who:'a post in the BM 2026 community Telegram groups', tier:'reported'},
    6: {label:'Camp Official', who:"the camp's own announcement in its Telegram or WhatsApp channel", tier:'confirmed'},
    7: {label:'Community Cal', who:'the crowd-sourced BM community Google Calendar', tier:'reported'},
    8: {label:'IG Flyer',     who:"read from the camp's own schedule flyer posted to Instagram", tier:'reported'},
    9: {label:'Community',    who:'submitted by a fellow burner through this guide', tier:'reported'}
  };

  function getConfirmsMap(){
    try {
      var raw = localStorage.getItem('bpg.confirms');
      if (raw) return JSON.parse(raw) || {};
    } catch(e){}
    return {};
  }

  function provenance(event){
    if (!event) {
      return { label: 'unverified', who: 'no source recorded', tier: 'unverified' };
    }
    var target = event;
    if (target.id && (target.src === undefined || target.src === null)) {
      if (target.pin) {
        return { label: 'our camp', who: "the camp's own website", tier: 'confirmed' };
      }
      for (var i = 0; i < EV.length; i++) {
        if (EV[i].id === target.id) {
          target = EV[i];
          break;
        }
      }
    }
    if (target.id) {
      var confirmsMap = getConfirmsMap();
      if (confirmsMap && confirmsMap[target.id]) {
        var userConf = confirmsMap[target.id];
        return {
          label: userConf.label || 'You',
          who: userConf.who || 'you confirmed this',
          tier: userConf.tier || 'confirmed'
        };
      }
    }
    if (target.pin) {
      return { label: 'our camp', who: "the camp's own website", tier: 'confirmed' };
    }
    var slot = target.slot || (target.s && target.s[0]);
    var startStr = slot ? slot[0] : null;
    var hasNullStart = !startStr || (typeof startStr === 'string' && (startStr.indexOf(' ') === -1 || !/\d{1,2}:\d{2}/.test(startStr)));
    if (hasNullStart) {
      return {
        label: 'running order, no set time',
        who: 'running order only with no clock time',
        tier: 'unverified'
      };
    }
    var hasLineup = target.g && target.g.indexOf && target.g.indexOf('lineup') !== -1;
    var srcVal = (target.src !== undefined && target.src !== null) ? target.src : 0;
    var info = SRC[srcVal];
    if (!info) {
      return { label: 'unverified', who: 'no source recorded', tier: 'unverified' };
    }
    if (hasLineup && srcVal === 0) {
      return {
        label: 'Official + lineup',
        who: 'Burning Man official listings enriched with lineup',
        tier: 'confirmed'
      };
    }
    return {
      label: info.label,
      who: info.who,
      tier: info.tier
    };
  }

  /* ---- Itinerary: resolve starred ids to real, dated occurrences ---- */
  var WEEKDAY_FULL = {
    '08-30': 'Sunday', '08-31': 'Monday', '09-01': 'Tuesday',
    '09-02': 'Wednesday', '09-03': 'Thursday', '09-04': 'Friday',
    '09-05': 'Saturday', '09-06': 'Sunday', '09-07': 'Monday'
  };
  var MONTH_SHORT = { '08': 'Aug', '09': 'Sep' };

  /* A slot start is either 'MM-DD HH:MM', or a bare 'MM-DD' when the camp
     published a day but no clock time, or null when nothing is known. */
  function slotDayOf(slot){
    if (!slot || typeof slot[0] !== 'string') return null;
    var m = /^(\d{2}-\d{2})/.exec(slot[0]);
    return m ? m[1] : null;
  }

  function slotIsDateOnly(slot){
    return !!(slot && typeof slot[0] === 'string' && /^\d{2}-\d{2}$/.test(slot[0]));
  }

  function dayStartMs(day){
    if (!day) return null;
    return Date.UTC(2026, parseInt(day.slice(0, 2), 10) - 1, parseInt(day.slice(3, 5), 10));
  }

  function dayLabel(dayStr){
    var bits, dnum, wd, mo;
    if (!dayStr) return 'No date';
    /* The two Sundays are landmarks, not dates: name them what burners call them. */
    if (dayStr === '08-30') return 'Sunday Opening Day · 30 Aug';
    if (dayStr === '09-06') return 'Sunday Temple Burn · 6 Sep';
    bits = dayStr.split('-');
    dnum = parseInt(bits[1], 10);
    wd = WEEKDAY_FULL[dayStr];
    mo = MONTH_SHORT[bits[0]] || bits[0];
    return (wd ? wd + ' ' : '') + dnum + ' ' + mo;
  }
  var STAR_INDEX = null;
  function buildStarIndex(){
    var idx, i, k, byTitleCamp, tk, extras, x;
    if (STAR_INDEX) return STAR_INDEX;
    idx = {};
    for (i = 0; i < GROUPS.length; i++) {
      var g = GROUPS[i];
      if (!idx[g.id]) idx[g.id] = g;
      if (g.allIds) {
        for (k = 0; k < g.allIds.length; k++) {
          if (!idx[g.allIds[k]]) idx[g.allIds[k]] = g;
        }
      }
    }
    for (i = 0; i < EV.length; i++) {
      var evItem = EV[i];
      if (evItem && evItem.id) idx[evItem.id] = evItem;
    }
    byTitleCamp = {};
    for (i = 0; i < GROUPS.length; i++) {
      tk = GROUPS[i].t + '|' + GROUPS[i].c;
      if (!byTitleCamp[tk]) byTitleCamp[tk] = GROUPS[i];
    }
    extras = PICKS.slice();
    if (PIN) extras.push(PIN);
    for (i = 0; i < extras.length; i++) {
      x = extras[i];
      if (!x || !x.id || idx[x.id]) continue;
      idx[x.id] = byTitleCamp[x.t + '|' + x.c] || x;
    }
    STAR_INDEX = idx;
    return idx;
  }
  /* 'Wed 2 Sep 13:00' -> '09-02 13:00' */
  function parseWText(w){
    var m, mo, dd, hh;
    if (!w || typeof w !== 'string') return null;
    m = /(\d{1,2})\s+(Aug|Sep)[a-z]*\s+(\d{1,2}):(\d{2})/i.exec(w);
    if (!m) return null;
    mo = /aug/i.test(m[2]) ? '08' : '09';
    dd = m[1].length < 2 ? '0' + m[1] : m[1];
    hh = m[3].length < 2 ? '0' + m[3] : m[3];
    return mo + '-' + dd + ' ' + hh + ':' + m[4];
  }
  function itinerary(){
    var idx = buildStarIndex();
    var ids = Array.from(starred);
    var timed = [], dateOnly = [], undated = [];
    var i, j, y;

    for (i = 0; i < ids.length; i++) {
      var sid = ids[i];
      var srcEv = idx[sid];
      if (!srcEv) continue;
      var base = {
        starId: sid,
        t: srcEv.t, c: srcEv.c, a: srcEv.a, p: srcEv.p,
        desc: srcEv.d || srcEv.n || '',
        src: srcEv.src,
        g: srcEv.g || [],
        pin: !!srcEv.pin
      };
      var pushed = false;
      var slots = (srcEv.s && srcEv.s.length) ? srcEv.s : [];

      /* ONE entry per event per day. A daily event legitimately appears under
         several day headers, once each, with that day's (earliest) time. It
         must never explode into a row per occurrence slot. */
      var timedByDay = {}, dateOnlyByDay = {};
      for (j = 0; j < slots.length; j++) {
        var slot = slots[j];
        var st = parseSlotTimes(slot);
        if (st) {
          var dk = st.dayStr;
          if (!timedByDay[dk]) {
            timedByDay[dk] = {
              e: base,
              day: dk,
              startMs: st.start,
              endMs: st.end,
              slot: slot,
              earliestSlot: slot,
              latestEndSlot: slot,
              slotCount: 1,
              clash: []
            };
          } else {
            var cur = timedByDay[dk];
            cur.slotCount++;
            if (st.start < cur.startMs) {
              cur.startMs = st.start;
              cur.earliestSlot = slot;
            }
            if (st.end > cur.endMs) {
              cur.endMs = st.end;
              cur.latestEndSlot = slot;
            }
          }
          pushed = true;
        } else if (slotIsDateOnly(slot)) {
          var dk2 = slotDayOf(slot);
          if (!dateOnlyByDay[dk2]) {
            dateOnlyByDay[dk2] = { e: base, day: dk2, startMs: null, endMs: null, slot: slot, slotCount: 1, clash: [] };
          } else {
            dateOnlyByDay[dk2].slotCount++;
          }
          pushed = true;
        }
      }
      var tdk;
      for (tdk in timedByDay) { if (timedByDay.hasOwnProperty(tdk)) timed.push(timedByDay[tdk]); }
      for (tdk in dateOnlyByDay) {
        /* a timed slot on the same day beats a bare date */
        if (dateOnlyByDay.hasOwnProperty(tdk) && !timedByDay[tdk]) dateOnly.push(dateOnlyByDay[tdk]);
      }

      if (!pushed && srcEv.w) {
        var wStart = parseWText(srcEv.w);
        if (wStart) {
          var st2 = parseSlotTimes([wStart, null]);
          if (st2) {
            timed.push({ e: base, day: st2.dayStr, startMs: st2.start, endMs: st2.end, slot: [wStart, null], earliestSlot: [wStart, null], latestEndSlot: [wStart, null], slotCount: 1, clash: [] });
            pushed = true;
          }
        }
      }

      if (!pushed) {
        undated.push({ e: base, day: null, startMs: null, endMs: null, slot: null, slotCount: 0, clash: [] });
      }
    }

    /* Your own private events slot into the same day buckets. */
    for (i = 0; i < ownEvents.length; i++) {
      var oe = ownEvents[i];
      if (!oe || !oe.t) continue;
      var obase = {
        starId: oe.id, t: oe.t, c: oe.c || 'Your own event', a: oe.a || '',
        p: '', desc: oe.n || '', src: undefined, g: [], pin: false, own: true
      };
      var placed = false;
      if (oe.day && oe.hm) {
        var slotO = [oe.day + ' ' + oe.hm, oe.end || null];
        var stO = parseSlotTimes(slotO);
        if (stO) {
          timed.push({ e: obase, day: stO.dayStr, startMs: stO.start, endMs: stO.end, slot: slotO, earliestSlot: slotO, latestEndSlot: slotO, slotCount: 1, clash: [] });
          placed = true;
        }
      }
      if (!placed && oe.day) {
        dateOnly.push({ e: obase, day: oe.day, startMs: null, endMs: null, slot: [oe.day, null], slotCount: 1, clash: [] });
        placed = true;
      }
      if (!placed) {
        undated.push({ e: obase, day: null, startMs: null, endMs: null, slot: null, slotCount: 0, clash: [] });
      }
    }

    timed.sort(function(a, b){ return a.startMs - b.startMs; });

    var days = [], dayMap = {};
    function dayBucket(dk){
      if (!dayMap[dk]) {
        dayMap[dk] = { day: dk, items: [], noTime: [] };
        days.push(dayMap[dk]);
      }
      return dayMap[dk];
    }
    for (i = 0; i < timed.length; i++) dayBucket(timed[i].day).items.push(timed[i]);
    for (i = 0; i < dateOnly.length; i++) dayBucket(dateOnly[i].day).noTime.push(dateOnly[i]);

    days.sort(function(a, b){ return a.day < b.day ? -1 : a.day > b.day ? 1 : 0; });
    for (i = 0; i < days.length; i++) {
      days[i].noTime.sort(function(a, b){
        return a.e.t < b.e.t ? -1 : a.e.t > b.e.t ? 1 : 0;
      });
    }

    /* Only real clock times can clash. A day with no time cannot overlap anything,
       so date-only entries are left out of this entirely. */
    for (i = 0; i < days.length; i++) {
      var items = days[i].items;
      for (j = 0; j < items.length; j++) {
        var clash = [];
        for (y = 0; y < items.length; y++) {
          if (y === j) continue;
          if (items[j].e.t === items[y].e.t || items[j].e.starId === items[y].e.starId) continue;
          if (items[j].startMs < items[y].endMs && items[j].endMs > items[y].startMs) {
            if (clash.indexOf(items[y].e.t) === -1) clash.push(items[y].e.t);
          }
        }
        items[j].clash = clash;
      }
    }

    return {
      days: days,
      undated: undated,
      timedCount: timed.length,
      dateOnlyCount: dateOnly.length,
      total: timed.length + dateOnly.length + undated.length
    };
  }
  function occRow(occ){
    var e = occ.e;
    var w, note = '';
    if (occ.slotCount && occ.slotCount > 1 && occ.earliestSlot) {
      var eSlot = occ.earliestSlot;
      var lSlot = occ.latestEndSlot || eSlot;
      var tparts = String(eSlot[0]).split(' ');
      var startStr = tparts[1] || '';
      var endStr = lSlot[1] || '';
      if (!endStr && occ.endMs) {
        var dEnd = new Date(occ.endMs);
        endStr = p2(dEnd.getUTCHours()) + ':' + p2(dEnd.getUTCMinutes());
      }
      w = startStr + (endStr ? '-' + endStr : '') + ' (' + occ.slotCount + ' sets)';
    } else if (occ.slot && !slotIsDateOnly(occ.slot)) {
      var tparts2 = String(occ.slot[0]).split(' ');
      w = (tparts2[1] || '') + (occ.slot[1] ? '-' + occ.slot[1] : '');
    } else if (occ.slot) {
      w = 'no set time';
    } else {
      w = 'no date recorded';
    }
    if (occ.clash && occ.clash.length) {
      if (occ.clash.length === 1) {
        note = 'Overlaps with ' + occ.clash[0];
      } else {
        note = 'Overlaps with ' + occ.clash[0] + ' and ' + (occ.clash.length - 1) + ' more';
      }
    }
    return {
      id: e.starId, t: e.t, c: e.c, a: e.a, p: e.p, desc: e.desc,
      src: e.src, g: e.g, pin: e.pin, own: !!e.own, slot: occ.earliestSlot || occ.slot, w: w,
      note: note, d: minsTo(e.a)
    };
  }
  function renderItinerary(){
    var it = itinerary();
    var html = '', i, j, d, dayTotal;

    for (i = 0; i < it.days.length; i++) {
      d = it.days[i];
      dayTotal = d.items.length + d.noTime.length;
      html += '<li class="itin-day"><span class="itin-day-name">' + esc(dayLabel(d.day)) + '</span>'
            + '<span class="itin-day-count">' + dayTotal + (dayTotal === 1 ? ' thing' : ' things') + '</span></li>';
      for (j = 0; j < d.items.length; j++) {
        html += card(occRow(d.items[j]), '');
      }
      if (d.noTime.length) {
        html += '<li class="itin-subhead">No set time</li>';
        for (j = 0; j < d.noTime.length; j++) {
          html += card(occRow(d.noTime[j]), '');
        }
      }
    }

    if (it.undated.length) {
      html += '<li class="itin-day itin-day-notime"><span class="itin-day-name">No date at all</span>'
            + '<span class="itin-day-count">' + it.undated.length + (it.undated.length === 1 ? ' thing' : ' things') + '</span></li>'
            + '<li class="itin-notime-hint">Nothing in the data gives these a day, so they cannot go in a calendar. Ask at the camp when you are there.</li>';
      for (j = 0; j < it.undated.length; j++) {
        html += card(occRow(it.undated[j]), '');
      }
    }

    if (!html) {
      html = '<li class="itin-empty">Nothing here yet. Tap the star on any event and it lands in My Events.'
        + '<div class="btnrow" style="justify-content:center;margin-top:.8rem">'
        + '<button type="button" class="btn solid find-something-btn">Find something</button></div></li>';
    }

    var noteEl = $('itin-cal-note');
    if (noteEl) {
      var bits = [];
      if (it.dateOnlyCount) {
        bits.push(it.dateOnlyCount + (it.dateOnlyCount === 1
          ? ' running order has a day but no clock time, so it goes in as an all day entry.'
          : ' running orders have a day but no clock time, so they go in as all day entries.'));
      }
      if (it.undated.length) {
        bits.push(it.undated.length + (it.undated.length === 1
          ? ' starred event has no date at all and is not added to your calendar. It is still in your itinerary, at the bottom.'
          : ' starred events have no date at all and are not added to your calendar. They are still in your itinerary, at the bottom.'));
      }
      if (bits.length) {
        noteEl.textContent = bits.join(' ');
        noteEl.style.display = '';
      } else {
        noteEl.textContent = '';
        noteEl.style.display = 'none';
      }
    }

    var countText;
    if (it.total === 0) {
      countText = 'Your itinerary is empty';
    } else {
      countText = it.total + (it.total === 1 ? ' thing' : ' things')
        + ' across ' + it.days.length + (it.days.length === 1 ? ' day' : ' days')
        + (it.undated.length ? ' plus ' + it.undated.length + ' with no date' : '');
    }
    return { html: html, countText: countText, data: it };
  }
  /* ---- ICS export, RFC 5545, entirely client side ---- */
  var ICS_PRODID = '-//Muse Cafe//Better Playa Guide//EN'; var ICS_TZID = 'America/Los_Angeles';
  function icsEscape(s){
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
  }
  function utf8Len(str){
    var n = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) {
        n += 4;
        i++;
      } else n += 3;
    }
    return n;
  }
  function icsFold(line){
    if (utf8Len(line) <= 75) return line;
    var out = [], cur = '', curLen = 0;
    for (var i = 0; i < line.length; i++) {
      var code = line.charCodeAt(i);
      var isPair = (code >= 0xD800 && code <= 0xDBFF && i + 1 < line.length);
      var ch = isPair ? line.substr(i, 2) : line.charAt(i);
      var l = utf8Len(ch);
      if (curLen + l > 75) {
        out.push(cur);
        cur = ' ' + ch;
        curLen = 1 + l;
      } else {
        cur += ch;
        curLen += l;
      }
      if (isPair) i++;
    }
    out.push(cur);
    return out.join('\r\n');
  }
  function p2(n){ return n < 10 ? '0' + n : '' + n; }
  function icsLocalStamp(ms){
    var d = new Date(ms);
    return d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + 'T' + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + '00';
  }
  function icsDateOnly(ms){
    var d = new Date(ms);
    return d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate());
  }
  function icsUtcNow(){
    var d = new Date();
    return d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + 'T' + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
  }
  function tierWords(tier){
    if (tier === 'confirmed') return 'Confirmed: published by the source that runs it.';
    if (tier === 'reported') return 'Reported: someone saw it and passed it on.';
    return 'Unverified: no source recorded, or a running order with no clock time.';
  }
  function buildIcs(){
    var it = itinerary();
    var lines = [];
    var stamp = icsUtcNow();
    var i, j;

    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:' + ICS_PRODID);
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push('X-WR-CALNAME:Better Playa Guide');
    lines.push('X-WR-TIMEZONE:' + ICS_TZID);
    lines.push('BEGIN:VTIMEZONE');
    lines.push('TZID:' + ICS_TZID);
    lines.push('X-LIC-LOCATION:' + ICS_TZID);
    lines.push('BEGIN:DAYLIGHT');
    lines.push('TZOFFSETFROM:-0800');
    lines.push('TZOFFSETTO:-0700');
    lines.push('TZNAME:PDT');
    lines.push('DTSTART:19700308T020000');
    lines.push('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
    lines.push('END:DAYLIGHT');
    lines.push('BEGIN:STANDARD');
    lines.push('TZOFFSETFROM:-0700');
    lines.push('TZOFFSETTO:-0800');
    lines.push('TZNAME:PST');
    lines.push('DTSTART:19701101T020000');
    lines.push('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU');
    lines.push('END:STANDARD');
    lines.push('END:VTIMEZONE');

    function describe(row, extraLine){
      var parts = [];
      if (row.p) parts.push('Lineup: ' + row.p);
      if (row.own) {
        if (row.desc) parts.push(row.desc);
        parts.push('Added by you in the Better Playa Guide.');
        if (extraLine) parts.push(extraLine);
        return parts.join('\n');
      }
      var prov = provenance(row);
      parts.push(tierWords(prov.tier));
      if (extraLine) parts.push(extraLine);
      parts.push('Better Playa Guide: ' + URL_);
      return parts.join('\n');
    }

    for (i = 0; i < it.days.length; i++) {
      var day = it.days[i];

      for (j = 0; j < day.items.length; j++) {
        var occ = day.items[j];
        var row = occRow(occ);
        lines.push('BEGIN:VEVENT');
        lines.push('UID:bpg-' + hashId(row.id) + '-' + icsLocalStamp(occ.startMs) + '@musecafe.vip');
        lines.push('DTSTAMP:' + stamp);
        lines.push('DTSTART;TZID=' + ICS_TZID + ':' + icsLocalStamp(occ.startMs));
        lines.push('DTEND;TZID=' + ICS_TZID + ':' + icsLocalStamp(occ.endMs));
        lines.push('SUMMARY:' + icsEscape(row.t));
        lines.push('LOCATION:' + icsEscape((row.a || 'location unknown') + ', ' + row.c));
        var icsExtra = [];
        if (occ.slotCount && occ.slotCount > 1) {
          icsExtra.push(occ.slotCount + ' sets scheduled on this day.');
        }
        if (occ.clash && occ.clash.length) {
          icsExtra.push('Heads up, this overlaps with: ' + occ.clash.join(', '));
        }
        lines.push('DESCRIPTION:' + icsEscape(describe(row, icsExtra.join('\n'))));
        lines.push('BEGIN:VALARM');
        lines.push('ACTION:DISPLAY');
        lines.push('DESCRIPTION:' + icsEscape(row.t + ' starts in 30 minutes'));
        lines.push('TRIGGER:-PT30M');
        lines.push('END:VALARM');
        lines.push('END:VEVENT');
      }

      /* A day with no clock time becomes a single all day entry on that one day.
         No alarm, because there is no time to be early for. */
      for (j = 0; j < day.noTime.length; j++) {
        var nrow = occRow(day.noTime[j]);
        var dayMs = dayStartMs(day.day);
        lines.push('BEGIN:VEVENT');
        lines.push('UID:bpg-' + hashId(nrow.id) + '-' + icsDateOnly(dayMs) + '-allday@musecafe.vip');
        lines.push('DTSTAMP:' + stamp);
        lines.push('DTSTART;VALUE=DATE:' + icsDateOnly(dayMs));
        lines.push('DTEND;VALUE=DATE:' + icsDateOnly(dayMs + 24 * 3600 * 1000));
        lines.push('SUMMARY:' + icsEscape(nrow.t + ' (running order, no set time)'));
        lines.push('LOCATION:' + icsEscape((nrow.a || 'location unknown') + ', ' + nrow.c));
        lines.push('DESCRIPTION:' + icsEscape(describe(nrow,
          'The camp published a running order for this day but no clock time. Ask at the camp when you get there.')));
        lines.push('END:VEVENT');
      }
    }

    /* Events with no date in any source are deliberately left out. Inventing a date
       to make them calendarable would be a lie. The itinerary still lists them. */

    lines.push('END:VCALENDAR');

    var folded = [];
    for (i = 0; i < lines.length; i++) {
      folded.push(icsFold(lines[i]));
    }
    return folded.join('\r\n') + '\r\n';
  }
  function downloadIcs(text, filename){
    var ok = false;
    try {
      if (typeof Blob === 'function' && window.URL && window.URL.createObjectURL) {
        var blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
        var url = window.URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function(){
          try {
            window.URL.revokeObjectURL(url);
          } catch(e){}
        }, 5000);
        ok = true;
      }
    } catch(e){
      ok = false;
    }
    if (!ok) {
      try {
        var a2 = document.createElement('a');
        a2.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(text);
        a2.download = filename;
        document.body.appendChild(a2);
        a2.click();
        document.body.removeChild(a2);
        ok = true;
      } catch(e2){
        ok = false;
      }
    }
    return ok;
  }
  function exportIcs(){
    var it = itinerary();
    var goingIn = it.timedCount + it.dateOnlyCount;
    if (goingIn === 0) {
      if (it.undated.length) {
        toast('None of your starred events carry a date, so there is nothing to put in a calendar yet.');
      } else {
        toast('Star something first, then it can go in your calendar.');
      }
      return;
    }
    var got = downloadIcs(buildIcs(), 'better-playa-guide.ics');
    if (!got) {
      toast('Your browser blocked the download. Try Share instead.');
      return;
    }
    var msg = 'Calendar file made, ' + goingIn + (goingIn === 1 ? ' entry' : ' entries') + '.';
    if (it.undated.length) {
      msg += ' ' + it.undated.length + ' with no date left out.';
    }
    toast(msg);
  }
  /* Starred lookup that survives the two id vintages: EV ids end in the slot
     start (t|c|s[0][0]) while PIN/PICKS ids end in the w string (t|c|w). The
     title|camp fallback makes a star set on either render as starred on both. */
  var STARRED_TC_CACHE = null;
  function starredTitleCamps(){
    if (STARRED_TC_CACHE) return STARRED_TC_CACHE;
    var out = {};
    starred.forEach(function(id){
      var bar = String(id).lastIndexOf('|');
      if (bar > 0) out[String(id).slice(0, bar)] = true;
    });
    STARRED_TC_CACHE = out;
    return out;
  }
  function invalidateStarCache(){ STARRED_TC_CACHE = null; }
  function isStarredRow(o){
    if (o.id && starred.has(o.id)) return true;
    if (o.allIds && o.allIds.some(function(sid){ return starred.has(sid); })) return true;
    return !!starredTitleCamps()[(o.t || '') + '|' + (o.c || '')];
  }
  function syncStarButtons(){
    var btns = document.querySelectorAll('.star-btn');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var sid = b.getAttribute('data-id');
      if (!sid) continue;
      var on = starred.has(sid) ||
        !!starredTitleCamps()[sid.slice(0, sid.lastIndexOf('|'))];
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      var glyph = b.querySelector('span');
      if (glyph) glyph.textContent = on ? '★' : '☆';
    }
  }

  /* ---- card render ---- */
  function card(o, dayFilter){
    var isStarred = isStarredRow(o);

    var near = o.d !== null && o.d !== undefined && o.d <= 8;
    var cls = o.pin ? 'pin' : (near ? 'near' : '');
    var dist = (o.d === null || o.d === undefined)
      ? (o.a ? '' : ' · location unknown')
      : ' · ' + o.d + ' min';
    var badge, starBtn;
    if (o.own) {
      badge = '<span class="tagline src prov-badge tier-own" title="Added by you. Lives only on this phone."><span aria-hidden="true">✎</span> Yours</span>';
      starBtn = '<button type="button" class="own-del-btn" data-own-id="' + esc(o.id)
        + '" aria-label="Delete ' + esc(o.t) + '"><span aria-hidden="true">🗑</span></button>';
    } else {
      var prov = provenance(o);
      var icon = prov.tier === 'confirmed' ? '●' : (prov.tier === 'reported' ? '○' : '◌');
      badge = '<span class="tagline src prov-badge tier-' + esc(prov.tier)
        + '" title="' + esc(prov.who) + '"><span aria-hidden="true">'
        + icon + '</span> ' + esc(prov.label) + '</span>';
      starBtn = o.id
        ? '<button type="button" class="star-btn" data-id="' + esc(o.id)
          + '" aria-pressed="' + (isStarred ? 'true' : 'false')
          + '" aria-label="' + (isStarred ? 'Unstar ' : 'Star ') + esc(o.t)
          + '"><span aria-hidden="true">' + (isStarred ? '★' : '☆') + '</span></button>'
        : '';
    }
    var navBtn = o.a
      ? '<button type="button" class="nav-btn" data-addr="' + esc(o.a) + '" data-title="' + esc(o.t) + '"'
        + (o.slot && o.slot[0] ? ' data-start="' + esc(o.slot[0]) + '"' : (o.w ? ' data-start="' + esc(o.w) + '"' : ''))
        + ' aria-label="Navigate to ' + esc(o.t) + '"><span aria-hidden="true">🧭</span> Navigate</button>'
      : '';
    var schedStr = o.s ? formatMergedSchedule(o.s, dayFilter) : (o.w || '');

    /* Mobile-first card: title spans the full width, time on its own line,
       address always on its own line (its own colour), buttons at the bottom.
       Never let action buttons share a row with the title: on a 360px phone
       they squeezed the title and fell off the card. */
    return '<li class="' + cls + '"' + (o.id ? ' data-id="' + esc(o.id) + '"' : '') + '>'
      + '<div class="ti">' + esc(o.t) + ' ' + badge + '</div>'
      + '<div class="meta">' + esc(schedStr) + dist + '</div>'
      + '<div class="addr">' + esc(o.a || 'Address TBA: ask at camp') + '</div>'
      + (o.p ? '<div class="who">' + esc(o.p) + '</div>' : '')
      + '<div class="de"><strong>' + esc(o.c) + '</strong>' + (o.desc ? ': ' + esc(o.desc) : (o.n ? ': ' + esc(o.n) : '')) + '</div>'
      + (o.note ? '<div class="itin-note">' + esc(o.note) + '</div>' : '')
      + '<div class="card-actions card-foot">' + navBtn + starBtn + '</div>'
      + '</li>';
  }

  function render(){
    if (!$('list')) return;
    var qEl = $('ask-q') || $('q');
    var q = (qEl ? qEl.value : '').trim().toLowerCase().normalize('NFD').replace(FOLD_RE,'');
    var tw = q ? parseTimeExpr(q) : { q: q, from: null, to: null };
    q = tw.q;
    if (q) { try { var qc = (+localStorage.getItem('bpg.qn') || 0) + 1; localStorage.setItem('bpg.qn', String(qc)); } catch (e) {} }
    var qTokens = q ? queryTokens(q) : null;
    if (qTokens && !qTokens.length) qTokens = null;
    /* multi-intent: "coffee and a sauna" or "party or workshop" means EITHER.
       Used only when the strict all-words match finds nothing. */
    var orClauses = null;
    /* recall fallback: if the full token set matches nothing, drop tokens from
       the end (users put the throwaway words last: "costume making", "climate
       talks", "set time") until something matches */
    if (qTokens && qTokens.length > 1){
      var anyHit = function(toks){
        for (var hi = 0; hi < GROUPS.length; hi++){ if (matchTokens(toks, eventHay(GROUPS[hi], hi))) return true; }
        return false;
      };
      var addressish = /\d{1,2}(?::\d{2})?\s*(?:&|and)\s*(?:esplanade|esp\b|[a-l]\b(?!\s+\w))/i.test(q);
      if (!anyHit(qTokens) && !addressish){
        /* first try splitting on and/or into independent clauses */
        var parts = q.split(/\b(?:and|or)\b|[,+]/).map(function(s){ return queryTokens(s.trim()); }).filter(function(a){ return a && a.length; });
        if (parts.length > 1){
          var live = parts.filter(anyHit);
          if (live.length) orClauses = live;
        }
      }
      if (qTokens && qTokens.length > 1 && !orClauses && !anyHit(qTokens)){
        {
          for (var di = qTokens.length - 1; di >= 0 && qTokens.length > 1; di--){
            var sub = qTokens.slice(0, di).concat(qTokens.slice(di + 1));
            if (anyHit(sub)){ qTokens = sub; break; }
          }
        }
      }
    }
    var day = $('day') ? $('day').value : '', sort = $('sort') ? $('sort').value : 'near';
    var confirmedOnly = $('confirmed-only') ? $('confirmed-only').checked : false;
    var locVal = $('loc') ? $('loc').value : '';
    here = parseAddr(locVal);
    speed = +($('mode') ? $('mode').value : 12) || 12;
    var rows = [];

    for (var i = 0; i < GROUPS.length; i++){
      var e = GROUPS[i];
      var isStarred = isStarredRow(e);
      if (mylistOnly && !isStarred) continue;
      if (confirmedOnly && provenance(e).tier !== 'confirmed') continue;
      if (active.size && !e.g.some(function(t){ return active.has(t); })) continue;
      if (orClauses){
        var hayOr = eventHay(e, i), hitOr = false;
        for (var oc = 0; oc < orClauses.length; oc++){ if (matchTokens(orClauses[oc], hayOr)){ hitOr = true; break; } }
        if (!hitOr) continue;
      } else if (qTokens && !matchTokens(qTokens, eventHay(e, i))) continue;
      var twSlot = null;
      if ((tw.from !== null || tw.to !== null)){
        for (var si2 = 0; si2 < e.s.length; si2++){ if (slotInWindow(e.s[si2], tw.from, tw.to)){ twSlot = e.s[si2]; break; } }
        if (!twSlot) continue;
      }
      /* with a day selected, the day loop alone may pick the slot: an event
         whose only in-window slot is on ANOTHER day must not leak in */
      var slot = day ? null : twSlot;
      if (day){
        for (var j=0; j<e.s.length; j++){
          var slotStart = e.s[j][0];
          if (typeof slotStart === 'string' && slotStart.indexOf(day) === 0){
            slot = e.s[j];
            break;
          }
        }
      } else {
        slot = e.s[0];
      }
      if (!slot) continue;

      rows.push({
        id: e.id, allIds: e.allIds, t: e.t, c: e.c, a: e.a, p: e.p, k: e.k, desc: e.d, src: e.src, g: e.g, s: e.s, slot: slot,
        w: slot[0] + '-' + slot[1], key: slot[0], d: minsTo(e.a)
      });
    }

    if (sort === 'near' && here) rows.sort(function(a,b){
      return (a.d==null?999:a.d) - (b.d==null?999:b.d); });
    else rows.sort(function(a,b){ return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });

    var html = '';
    if (!mylistOnly && PIN && !q && (!day || day === '09-03')){
      var pinProv = provenance(PIN);
      if (!confirmedOnly || pinProv.tier === 'confirmed') {
        var pin = { id:PIN.id, t:PIN.t, c:PIN.c, a:PIN.a, w:PIN.w, n:PIN.n, pin:true, d:minsTo(PIN.a) };
        html += card(pin, day);
      }
    }
    /* Honest count: cards after grouping repeat days, so it never silently
       contradicts the 3,875-events claim (which counts occurrences). */
    var countText = mylistOnly
      ? rows.length + ' starred events'
      : rows.length + ' cards (repeat days grouped)' + (here ? ' · distances from ' + locVal : ' · set your location for distances');
    if ($('count')) $('count').textContent = countText;

    var itinPanel = $('itin-panel');
    if (mylistOnly) {
      var itin = renderItinerary();
      html = itin.html;
      $('count').textContent = itin.countText;
      if (itinPanel) itinPanel.style.display = '';
      var emptyCalHint = $('myevents-cal-empty-hint');
      if (emptyCalHint) emptyCalHint.style.display = starred.size ? 'none' : '';
      var emptyPdfHint = $('myevents-pdf-empty-hint');
      if (emptyPdfHint) emptyPdfHint.style.display = starred.size ? 'none' : '';
    } else {
      html += rows.slice(0, shown).map(function(item){ return card(item, day); }).join('');
      if (itinPanel) itinPanel.style.display = 'none';
    }
    $('list').innerHTML = html || '<li>Nothing matches. Clear a filter.</li>';
    var more = $('more');
    if (more) more.style.display = (!mylistOnly && rows.length > shown) ? '' : 'none';
    updateStarCount();
    syncStarButtons();
    savePrefs();
  }

  function renderPicks(){
    if (!$('picklist')) return;
    $('picklist').innerHTML = PICKS.map(function(p){
      return card({ id:p.id, t:p.t, c:p.c, a:p.a, w:p.w, n:p.n, d:minsTo(p.a) });
    }).join('');
  }

  /* ---- FEATURE 3: LOCAL Parser ---- */
  var CAT_MAP = {
    coffee: ['drink'], tea: ['drink'], bar: ['drink'], booze: ['drink'], cocktail: ['drink'], cocktails: ['drink'],
    eat: ['food'], food: ['food'], snack: ['food'], breakfast: ['food'], pizza: ['food'], burger: ['food'], tacos: ['food'], taco: ['food'],
    dj: ['music'], set: ['music'], dance: ['music'], sound: ['music'], beats: ['music'],
    party: ['party'], rave: ['party'],
    yoga: ['wellness'], massage: ['wellness'], sauna: ['wellness'], healing: ['wellness'], spa: ['wellness'],
    talk: ['talk','workshop'], lecture: ['talk','workshop'], speaker: ['talk','workshop'], class: ['talk','workshop'], workshops: ['workshop'], workshop: ['workshop'], talks: ['talk'],
    sexy: ['adult'], naked: ['adult'], adult: ['adult'], kink: ['adult'],
    art: ['art'], installation: ['art'],
    kids: ['kids'], family: ['kids'],
    accessible: ['accessible'], wheelchair: ['accessible']
  };

  /* Fine-tag vocabulary from the payload, plus query words that should route
     through a fine tag they do not literally contain. Mirrors api/_guide.js. */
  var FV = (D.ev && D.ev.fv) || [];
  var FV_SYN = {
    gay: ['queer', 'lgbtq'], lesbian: ['sapphic', 'queer'], lgbt: ['lgbtq', 'queer'],
    rap: ['hip-hop'], hiphop: ['hip-hop'],
    edm: ['techno', 'dubstep', 'trance', 'tribal-house'], psytrance: ['trance'],
    bondage: ['bdsm', 'kink'], shibari: ['bdsm', 'kink'], rope: ['bdsm'],
    meditate: ['meditation', 'guided-meditation'], meditating: ['meditation'],
    sexy: ['erotic', 'burlesque'], astrology: ['divination', 'oracle', 'tarot'],
    psychic: ['divination', 'oracle', 'tarot'], fortune: ['divination', 'oracle', 'tarot']
  };
  var FV_TERM_CACHE = {};
  function fvIndicesFor(term) {
    if (FV_TERM_CACHE[term]) return FV_TERM_CACHE[term];
    var out = [];
    var tLow = term.toLowerCase().normalize('NFD').replace(FOLD_RE,'');
    var tStem = tLow.charAt(tLow.length - 1) === 's' ? tLow.slice(0, -1) : tLow;
    var syn = FV_SYN[tLow] || FV_SYN[tStem] || null;
    for (var i = 0; i < FV.length; i++) {
      var entry = (FV[i] || '').toLowerCase().normalize('NFD').replace(FOLD_RE,'');
      if (entry === tLow || entry === tStem || entry === tLow + 's' || entry === tLow + 'es') { out.push(i); continue; }
      if (syn && syn.indexOf(entry) !== -1) { out.push(i); continue; }
      var segs = entry.split('-');
      var hit = false;
      for (var sgi = 0; sgi < segs.length; sgi++) {
        var sg = segs[sgi];
        if (sg === tLow || sg === tStem || sg === tLow + 's' || sg === tLow + 'es') { hit = true; break; }
      }
      if (hit) out.push(i);
    }
    FV_TERM_CACHE[term] = out;
    return out;
  }

  /* Word-boundary stem matcher: "party" hits "parties", "taco" hits "tacos",
     but "set" no longer hits "sunset". Mirrors makeStemRe in api/_guide.js. */
  var STEM_RE_CACHE = {};
  function stemRe(term) {
    if (STEM_RE_CACHE[term]) return STEM_RE_CACHE[term];
    var tLow = term.toLowerCase().normalize('NFD').replace(FOLD_RE,'');
    var stems = [tLow];
    if (tLow === 'film') stems.push('movie', 'movies');
    if (tLow === 'movie') stems.push('film', 'films');
    if (tLow.charAt(tLow.length - 1) !== 's') {
      stems.push(tLow + 's');
      stems.push(tLow + 'es');
      if (tLow.length > 3 && tLow.charAt(tLow.length - 1) === 'y') stems.push(tLow.slice(0, -1) + 'ies');
    } else {
      stems.push(tLow.slice(0, -1));
      if (tLow.length > 4 && tLow.slice(-3) === 'ies') stems.push(tLow.slice(0, -3) + 'y');
      if (tLow.length > 3 && tLow.slice(-2) === 'es') stems.push(tLow.slice(0, -2));
    }
    var pat = [];
    for (var si = 0; si < stems.length; si++) {
      pat.push(stems[si].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
    var re = new RegExp('\\b(?:' + pat.join('|') + ')\\b', 'i');
    STEM_RE_CACHE[term] = re;
    return re;
  }

  function applyAskSynonyms(s) {
    s = s.replace(/\bsound\s+camps?\b/g, 'dj');
    s = s.replace(/\bsets\b/g, 'set');
    s = s.replace(/\bparties\b/g, 'party');
    s = s.replace(/\braves\b/g, 'rave');
    s = s.replace(/\bveggie\b/g, 'vegetarian').replace(/\bveg\b/g, 'vegetarian');
    s = s.replace(/\bpizzas\b/g, 'pizza');
    s = s.replace(/\bdjs\b/g, 'dj');
    s = s.replace(/\bsaunas\b/g, 'sauna').replace(/\bsteam\b/g, 'sauna');
    s = s.replace(/\bmassages\b/g, 'massage');
    s = s.replace(/\b(i'?m looking for|i am looking for|i want|show me|give me|looking for)\b/g, ' ');
    s = s.replace(/\baround here\b|\bnear here\b|\baround me\b/g, 'near me');
    s = s.replace(/\b(closest|nearest)\b/g, ' ');
    s = s.replace(/\b(bathrooms?|restrooms?|porta\s*-?\s*pott(y|ies)|portapott(y|ies)|loos?)\b/g, 'toilet');
    return s;
  }

  function getPlayaNow(){
    var now = new Date();
    var playaMs = now.getTime() - (7 * 3600 * 1000);
    var d = new Date(playaMs);
    var y = d.getUTCFullYear();
    var m = d.getUTCMonth() + 1;
    var dt = d.getUTCDate();
    var isBurn = (y === 2026 && ((m === 8 && dt >= 30) || (m === 9 && dt <= 7)));
    if (isBurn) {
      return { date: d, isFallback: false };
    }
    return { date: new Date(Date.UTC(2026, 7, 30, 12, 0, 0)), isFallback: true };
  }

  function parseSlotTimes(slot){
    if (!slot || !slot[0]) return null;
    var parts = slot[0].split(' ');
    if (parts.length < 2) return null;
    var md = parts[0].split('-');
    var hm = parts[1].split(':');
    var month = parseInt(md[0], 10) - 1;
    var day = parseInt(md[1], 10);
    var startMs = Date.UTC(2026, month, day, parseInt(hm[0], 10), parseInt(hm[1], 10), 0);
    var endMs = startMs + 2 * 3600 * 1000;
    if (slot[1]){
      var endHm = slot[1].split(':');
      var endMsCandidate = Date.UTC(2026, month, day, parseInt(endHm[0], 10), parseInt(endHm[1], 10), 0);
      if (endMsCandidate <= startMs) endMsCandidate += 24 * 3600 * 1000;
      endMs = endMsCandidate;
    }
    return { start: startMs, end: endMs, dayStr: parts[0] };
  }

  function getCategoryNoun(word, count) {
    if (!word) return count === 1 ? 'event' : 'events';
    var w = word.toLowerCase().normalize('NFD').replace(FOLD_RE,'');
    if (w === 'sauna') return count === 1 ? 'sauna' : 'saunas';
    if (w === 'massage') return count === 1 ? 'massage' : 'massages';
    if (w === 'party') return count === 1 ? 'party' : 'parties';
    if (w === 'parties') return count === 1 ? 'party' : 'parties';
    if (w === 'rave') return count === 1 ? 'rave' : 'raves';
    if (w === 'talk' || w === 'talks') return count === 1 ? 'talk' : 'talks';
    if (w === 'lecture' || w === 'lectures') return count === 1 ? 'lecture' : 'lectures';
    if (w === 'workshop' || w === 'workshops') return count === 1 ? 'workshop' : 'workshops';
    if (w === 'class' || w === 'classes') return count === 1 ? 'class' : 'classes';
    if (w === 'speaker' || w === 'speakers') return count === 1 ? 'speaker' : 'speakers';
    if (w === 'cocktail' || w === 'cocktails') return count === 1 ? 'cocktail' : 'cocktails';
    if (w === 'snack' || w === 'snacks') return count === 1 ? 'snack' : 'snacks';
    if (w === 'pizza' || w === 'pizzas') return count === 1 ? 'pizza' : 'pizzas';
    if (w === 'installation' || w === 'installations') return count === 1 ? 'installation' : 'installations';

    if (w.length > 1 && w.charAt(w.length - 1) === 's' && w !== 'wellness') {
      return count === 1 ? w.slice(0, -1) + ' event' : w + ' events';
    }
    return count === 1 ? w + ' event' : w + ' events';
  }

  function answer(q){
    var raw = (q || '').trim();
    if (!raw) {
      return { reply: "Try asking something like 'whats on near me now' or 'coffee tomorrow morning'.", results: [] };
    }
    var qLower = applyAskSynonyms(raw.toLowerCase().normalize('NFD').replace(FOLD_RE,''));
    /* sanitation intent: route toilet questions to the GIS potty finder */
    if (/\btoilets?\b|\bpotty\b|\bpotties\b/.test(qLower)) {
      if (here) {
        var np = nearestPotty(here);
        if (np) return { reply: '🚽 Nearest porta potty bank: about ' + np.min + ' min walk (' + np.ft + ' ft), head toward the ' + np.clock + ' direction on the clock face. Banks sit along most streets; this is the closest of the 45 official ones.', results: [] };
      }
      return { reply: '🚽 Set your location first (the button up top), then ask again or tap the Potty button and I will point you to the nearest of the 45 official porta potty banks.', results: [] };
    }
    /* burn-night logistics: "when does the man burn" is a date, not a DJ */
    if (/\b(man|temple)\b.*\bburns?\b|\bburn\b.*\b(man|temple)\b/.test(qLower) && !/burn barrel|burn night party/.test(qLower)) {
      if (/temple/.test(qLower)) return { reply: 'The Temple burns Sunday 6 September, after dark (typically around 8pm, in silence). The Man burns the night before, Saturday 5 September around 9pm.', results: [] };
      return { reply: 'The Man burns Saturday 5 September around 9pm (fire conclave first, then the burn). The Temple burns Sunday 6 September after dark, in silence.', results: [] };
    }
    /* typo-correct words that match nothing in the data ("opulant" -> "opulent"),
       so the ask path fuzzes the same way the live filter does */
    qLower = qLower.split(/(\s+)/).map(function(part){
      var w = part.trim();
      if (!w || w.length < 4 || STOPW.has(w) || !/^[a-z0-9]+$/.test(w)) return part;
      return part.replace(w, fuzzyRemap(w));
    }).join('');

    var isConvLoc = /^(?:i['’]?m\s+at|we\s+are\s+at|located\s+at|currently\s+at|at)\s+/i.test(raw);
    var pLocDirect = parseWhere(raw);

    if (pLocDirect && !pLocDirect.error && (isConvLoc || !/[a-z]{3,}/i.test(raw.replace(
      /esplanade|eternal|ararat|bodhi|ceiba|delphi|fulcrum|great|oak|heiau|iroko|jiba|kundalini|center|camp|temple|greeters|airport|playa|info|man|the/gi,
      '')))) {
      var setVal = pLocDirect.landmark ? pLocDirect.label : pLocDirect.label;
      var locFresh = (ANSWER_LOC_GUARD === null) || ($('loc') && $('loc').value === ANSWER_LOC_GUARD);
      if ($('loc') && locFresh) { $('loc').value = setVal; savePrefs(); }
      here = { lat: pLocDirect.lat, lon: pLocDirect.lon };
      speed = +($('mode') ? $('mode').value : 12) || 12;
      if (typeof updateLocConfirm === 'function') updateLocConfirm(setVal);

      var prox = getProximityInfo(here, speed);

      var replyLocStr = '';
      if (pLocDirect.landmark) {
        replyLocStr = 'Got it, ' + pLocDirect.label + '.';
      } else {
        replyLocStr = 'Got it, ' + pLocDirect.clock + ' & ' + pLocDirect.street + '.';
      }
      if (prox.text) {
        replyLocStr += ' ' + prox.text;
      }

      var chosenList = (prox.countNow > 0) ? prox.eventsNow : (prox.countLater > 0 ? prox.eventsLater : []);
      var nearbyRows = [];
      for (var ei = 0; ei < chosenList.length; ei++) {
        var item = chosenList[ei];
        var evItem = item.ev;
        var slot = item.slot || (evItem.s[0] || ['?','?']);
        nearbyRows.push({
          id: evItem.id, allIds: evItem.allIds, t: evItem.t, c: evItem.c, a: evItem.a, p: evItem.p, d: evItem.d, src: evItem.src, g: evItem.g, s: evItem.s,
          w: slot[0] + '-' + slot[1], key: slot[0], d: item.d
        });
      }
      nearbyRows.sort(function(a,b){ return (a.d == null ? 999 : a.d) - (b.d == null ? 999 : b.d); });
      return { reply: replyLocStr, results: nearbyRows.slice(0, 60) };
    }

    var intentMatch = /^(?:where\s+is|where's|how\s+(?:do\s+i|to)\s+get\s+to)\s+(.+)/i.exec(raw);
    if (intentMatch) {
      var target = intentMatch[1].replace(/\?$/, '').trim();
      var targetLower = target.toLowerCase().normalize('NFD').replace(FOLD_RE,'');
      var foundAddr = null, foundName = target;

      if (MAP.landmarks) {
        var lkeys = Object.keys(MAP.landmarks);
        for (var l = 0; l < lkeys.length; l++) {
          if (lkeys[l].toLowerCase().normalize('NFD').replace(FOLD_RE,'').indexOf(targetLower) !== -1) {
            foundName = lkeys[l];
            foundAddr = MAP.landmarks[lkeys[l]];
            break;
          }
        }
      }

      if (!foundAddr) {
        for (var c = 0; c < GROUPS.length; c++) {
          if ((GROUPS[c].c && GROUPS[c].c.toLowerCase().normalize('NFD').replace(FOLD_RE,'').indexOf(targetLower) !== -1) ||
              (GROUPS[c].k && GROUPS[c].k.toLowerCase().normalize('NFD').replace(FOLD_RE,'').indexOf(targetLower) !== -1)) {
            foundName = GROUPS[c].c;
            foundAddr = GROUPS[c].a;
            break;
          }
        }
      }

      if (foundAddr || foundName) {
        var userLoc = $('loc') ? $('loc').value : '';
        here = parseAddr(userLoc);
        speed = +($('mode') ? $('mode').value : 12) || 12;
        var mins = foundAddr ? minsTo(foundAddr) : null;
        var modeVal = $('mode') ? $('mode').value : '12';
        var modeText = modeVal === '3' ? 'on foot' : (modeVal === '8' ? 'on your bike' : 'on your ebike');
        var replyText = foundName + ' is at ' + (foundAddr || 'location unknown');
        if (mins !== null && mins !== undefined) {
          replyText += ', about ' + mins + ' minutes ' + modeText + ' from you';
        }
        replyText += '.';

        var matchingEvs = GROUPS.filter(function(e){
          return (e.c && e.c.toLowerCase().normalize('NFD').replace(FOLD_RE,'').indexOf(targetLower) !== -1) ||
                 (e.k && e.k.toLowerCase().normalize('NFD').replace(FOLD_RE,'').indexOf(targetLower) !== -1) ||
                 (e.t && e.t.toLowerCase().normalize('NFD').replace(FOLD_RE,'').indexOf(targetLower) !== -1);
        }).map(function(e){
          var slot = e.s[0] || ['?','?'];
          return { id:e.id, allIds:e.allIds, t:e.t, c:e.c, a:e.a, p:e.p, d:e.d, src:e.src, g:e.g, s:e.s, w: slot[0] + '-' + slot[1], key: slot[0], d: minsTo(e.a) };
        });
        if (here) {
          matchingEvs.sort(function(a,b){ return (a.d == null ? 999 : a.d) - (b.d == null ? 999 : b.d); });
        }
        return { reply: replyText, results: matchingEvs.slice(0, 60) };
      }
    }

    // 1. TIME WINDOW
    var playaInfo = getPlayaNow();
    var nowObj = playaInfo.date;
    var nowMs = nowObj.getTime();
    var wStart = null, wEnd = null, timeDesc = '';
    var hasExplicitTimeFilter = false;

    var inHrsMatch = /\bin\s+(\d+)\s*(?:hours?|hrs?|h)\b/i.exec(qLower);
    if (inHrsMatch) {
      var nHrs = parseInt(inHrsMatch[1], 10);
      wStart = nowMs;
      wEnd = nowMs + nHrs * 3600 * 1000;
      timeDesc = 'in the next ' + nHrs + ' hours';
      hasExplicitTimeFilter = true;
    } else if (/\b(?:right\s+)?now\b/i.test(qLower)) {
      wStart = nowMs;
      wEnd = nowMs + 3 * 3600 * 1000;
      timeDesc = 'in the next 3 hours';
      hasExplicitTimeFilter = true;
    } else if (/\btonight\b/i.test(qLower)) {
      wStart = Date.UTC(nowObj.getUTCFullYear(), nowObj.getUTCMonth(), nowObj.getUTCDate(), 18, 0, 0);
      wEnd = wStart + 9 * 3600 * 1000;
      timeDesc = 'tonight';
      hasExplicitTimeFilter = true;
    } else {
      var targetDayStr = null;
      var BURN_DAYS_MAP = { '1':'08-30', '2':'08-31', '3':'09-01', '4':'09-02', '5':'09-03', '6':'09-04', '7':'09-05', '8':'09-06', '9':'09-07' };
      var burnNightM = /\bburn\s+night\b/i.exec(qLower);
      var burnDayM = /\bday\s*([1-9])\b(?:\s*of\s*the\s*burn)?/i.exec(qLower);
      if (burnNightM) {
        targetDayStr = '09-05';
        timeDesc = 'on burn night';
        hasExplicitTimeFilter = true;
        var bnBase = Date.UTC(2026, 8, 5, 0, 0, 0);
        wStart = bnBase + 18 * 3600 * 1000;
        wEnd = bnBase + 30 * 3600 * 1000;
      } else if (burnDayM) {
        targetDayStr = BURN_DAYS_MAP[burnDayM[1]];
        timeDesc = 'on day ' + burnDayM[1];
        hasExplicitTimeFilter = true;
      } else if (/\bfirst\s+day\b(?:\s*of\s*the\s*burn)?/i.test(qLower)) {
        targetDayStr = '08-30';
        timeDesc = 'on day 1';
        hasExplicitTimeFilter = true;
      } else if (/\blast\s+day\b(?:\s*of\s*the\s*burn)?/i.test(qLower)) {
        targetDayStr = '09-07';
        timeDesc = 'on day 9';
        hasExplicitTimeFilter = true;
      }
      var weekdaysMap = {
        mon: '08-31', monday: '08-31',
        tue: '09-01', tuesday: '09-01',
        wed: '09-02', wednesday: '09-02',
        thu: '09-03', thursday: '09-03',
        fri: '09-04', friday: '09-04',
        sat: '09-05', saturday: '09-05',
        sun: '08-30', sunday: '08-30'
      };
      if (!targetDayStr) {
        var wkKeys = Object.keys(weekdaysMap);
        for (var k = 0; k < wkKeys.length; k++) {
          var pattern = new RegExp('\\b' + wkKeys[k] + '\\b', 'i');
          if (pattern.test(qLower)) {
            targetDayStr = weekdaysMap[wkKeys[k]];
            timeDesc = 'on ' + wkKeys[k].charAt(0).toUpperCase() + wkKeys[k].slice(1);
            hasExplicitTimeFilter = true;
            break;
          }
        }
      }

      if (/\btomorrow\b/i.test(qLower)) {
        var tomorrowMs = nowMs + 24 * 3600 * 1000;
        var tObj = new Date(tomorrowMs);
        var tm = tObj.getUTCMonth() + 1; if (tm < 10) tm = '0' + tm;
        var td = tObj.getUTCDate(); if (td < 10) td = '0' + td;
        targetDayStr = tm + '-' + td;
        timeDesc = 'tomorrow';
        hasExplicitTimeFilter = true;
      }

      if (wStart === null) {
        var winBase, winLabelPrefix;
        if (targetDayStr) {
          var dParts = targetDayStr.split('-');
          winBase = Date.UTC(2026, parseInt(dParts[0], 10) - 1, parseInt(dParts[1], 10), 0, 0, 0);
          winLabelPrefix = timeDesc;
        } else {
          winBase = Date.UTC(nowObj.getUTCFullYear(), nowObj.getUTCMonth(), nowObj.getUTCDate(), 0, 0, 0);
          winLabelPrefix = '';
        }
        if (/\bmorning\b/i.test(qLower)) {
          wStart = winBase + 6 * 3600 * 1000; wEnd = winBase + 12 * 3600 * 1000;
          timeDesc = winLabelPrefix ? winLabelPrefix + ' morning' : 'this morning'; hasExplicitTimeFilter = true;
        } else if (/\bafternoon\b/i.test(qLower)) {
          wStart = winBase + 12 * 3600 * 1000; wEnd = winBase + 18 * 3600 * 1000;
          timeDesc = winLabelPrefix ? winLabelPrefix + ' afternoon' : 'this afternoon'; hasExplicitTimeFilter = true;
        } else if (/\bevening\b/i.test(qLower)) {
          wStart = winBase + 18 * 3600 * 1000; wEnd = winBase + 23 * 3600 * 1000;
          timeDesc = winLabelPrefix ? winLabelPrefix + ' evening' : 'this evening'; hasExplicitTimeFilter = true;
        } else if (/\bsunrise\b/i.test(qLower)) {
          /* sunrise means dawn of that day: 04:00-10:00 */
          wStart = winBase + 4 * 3600 * 1000; wEnd = winBase + 10 * 3600 * 1000;
          timeDesc = winLabelPrefix ? winLabelPrefix + ' around sunrise' : 'around sunrise'; hasExplicitTimeFilter = true;
        } else if (/\b(?:late|night)\b/i.test(qLower)) {
          /* late night runs from 23:00 into the next morning */
          wStart = winBase + 23 * 3600 * 1000; wEnd = winBase + 30 * 3600 * 1000;
          timeDesc = winLabelPrefix ? winLabelPrefix + ' late night' : 'late night'; hasExplicitTimeFilter = true;
        } else if (targetDayStr) {
          wStart = winBase; wEnd = winBase + 24 * 3600 * 1000;
        }
      }
    }

    // 2. PLACE
    var refAddr = null, placeDesc = '', isNearMeRequested = false;
    var addrMatch = /(\d{1,2}(?::\d{2})?)\s*(?:&|and|@|,)?\s*(ESP|Esplanade|[A-Ka-k])\b/i.exec(qLower);
    if (addrMatch) {
      var addrStr = addrMatch[0];
      if (addrMatch[1].indexOf(':') === -1) addrStr = addrMatch[1] + ':00 & ' + addrMatch[2];
      else addrStr = addrMatch[1] + ' & ' + addrMatch[2];
      refAddr = addrStr;
      placeDesc = 'near ' + addrStr;
      var locFresh2 = (ANSWER_LOC_GUARD === null) || ($('loc') && $('loc').value === ANSWER_LOC_GUARD);
      if ($('loc') && locFresh2) { $('loc').value = addrStr; savePrefs(); }
    } else if (/\b(?:near\s+me|close|nearby|walking\s+distance)\b/i.test(qLower)) {
      isNearMeRequested = true;
      var currentLoc = $('loc') ? $('loc').value.trim() : '';
      if (currentLoc) {
        refAddr = currentLoc;
        placeDesc = 'near ' + currentLoc;
      }
    }

    var hasTimeFilter = hasExplicitTimeFilter;
    if ((isNearMeRequested || refAddr) && wStart === null && wEnd === null) {
      wStart = nowMs;
      wEnd = nowMs + 3 * 3600 * 1000;
      timeDesc = 'in the next 3 hours';
      hasTimeFilter = true;
    }

    // 3. CATEGORY RECOGNITION
    var matchedCatWord = null;
    var catKeys = Object.keys(CAT_MAP);
    for (var ck = 0; ck < catKeys.length; ck++) {
      var cWord = catKeys[ck];
      if (new RegExp('\\b' + cWord + '\\b', 'i').test(qLower)) {
        matchedCatWord = cWord;
        break;
      }
    }
    if (!matchedCatWord) {
      for (var tk = 0; tk < TAGS.length; tk++) {
        if (new RegExp('\\b' + TAGS[tk] + '\\b', 'i').test(qLower)) {
          matchedCatWord = TAGS[tk];
          break;
        }
      }
    }

    // 4. SEARCH TOKENS
    var cleanStr = qLower
      .replace(/[?!.,;:]+/g, ' ')
      .replace(/^(?:whats?\s+on|show\b|find\b|is\s+there|any\b|where\s+is|how\s+to\s+get\s+to)/g, '')
      .replace(/\b(?:near\s+me|close|nearby|walking\s+distance|now|right\s+now|tonight|today|tomorrow|morning|afternoon|evening|late|night|sunrise|in\s+\d+\s*(?:hours?|hrs?|h))\b/g, '')
      .replace(/\bburn\s+night\b/g, '')
      .replace(/\bday\s*[1-9]\b(?:\s*of\s*the\s*burn)?/g, '')
      .replace(/\b(?:first|last)\s+day\b(?:\s*of\s*the\s*burn)?/g, '')
      .replace(/\b(?:mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)\b/g, '')
      .replace(/(\d{1,2}(?::\d{2})?)\s*(?:&|and|@|,)?\s*(ESP|Esplanade|[A-Ka-k])\b/g, '');

    if (matchedCatWord) {
      cleanStr = cleanStr.replace(new RegExp('\\b' + matchedCatWord + '\\b', 'gi'), '');
    }
    /* Stopwords and structural words, kept in sync with api/_guide.js */
    var ASK_STOP = ['the','and','for','you','can','what','whats',"what's",'your','with',
      'who','when','where','how','why','does','are','any','there','get','got','being',
      'giving','serving','served','playing','offering','hosting','running','doing','having',
      'should','could','would','was','were','will','did','going','want','need','like',
      'find','show','tell','thing','things','stuff','something','anything','good','best',
      'cool','fun','please','thanks','this','that','from','about','have','getting','right',
      "there's",'theres','play','plays','set','sets','lineup','happening','event','events',
      'times','time','spinning','b2b','activities','activity'];
    var searchTokens = cleanStr.split(/\s+/).filter(function(w){
      return w.length > 2 && ASK_STOP.indexOf(w) === -1;
    });

    here = parseAddr(refAddr || ($('loc') ? $('loc').value : ''));
    speed = +($('mode') ? $('mode').value : 12) || 12;

    if (isNearMeRequested && !($('loc') ? $('loc').value.trim() : '')) {
      return {
        reply: "You have not told me where you are. Tap the location box or ask 'I am at 7:30 and F'.",
        results: []
      };
    }

    function runFilter(catType, catVal, distLimit, timeRange) {
      var list = [];
      for (var eidx = 0; eidx < GROUPS.length; eidx++) {
        var evItem = GROUPS[eidx];

        if (catType === 'literal') {
          var evText = (evItem.t + ' ' + evItem.c + ' ' + (evItem.k ? evItem.k + ' ' : '') + evItem.p + ' ' + evItem.d).toLowerCase().normalize('NFD').replace(FOLD_RE,'');
          /* word-boundary stem match so "set" stops hitting "sunset" */
          if (!stemRe(catVal).test(evText)) continue;
        } else if (catType === 'tag') {
          var tagsArr = Array.isArray(catVal) ? catVal : [catVal];
          var hasTag = evItem.g.some(function(gt){ return tagsArr.indexOf(gt) !== -1; });
          if (!hasTag) continue;
        }

        if (searchTokens.length > 0) {
          var fullText = (evItem.t + ' ' + evItem.c + ' ' + (evItem.k ? evItem.k + ' ' : '') + evItem.p + ' ' + evItem.d).toLowerCase().normalize('NFD').replace(FOLD_RE,'');
          var matchesText = searchTokens.every(function(st){
            /* word-boundary stem match: plurals both ways, parties<->party */
            if (stemRe(st).test(fullText)) return true;
            /* longer tokens keep the old substring recall (partial names) */
            if (st.length >= 5 && fullText.indexOf(st) !== -1) return true;
            /* fine-tag layer: "techno" hits events tagged techno, "gay" hits
               queer/lgbtq tagged events, even when the word is not in the text */
            var fvIdx = fvIndicesFor(st);
            if (fvIdx.length && evItem.f && evItem.f.length) {
              for (var fj = 0; fj < evItem.f.length; fj++) {
                if (fvIdx.indexOf(evItem.f[fj]) !== -1) return true;
              }
            }
            return false;
          });
          if (!matchesText) continue;
        }

        var matchingSlot = null;
        if (timeRange && timeRange.start !== null && timeRange.end !== null) {
          for (var sidx = 0; sidx < evItem.s.length; sidx++) {
            var stime = parseSlotTimes(evItem.s[sidx]);
            if (stime && stime.start < timeRange.end && stime.end > timeRange.start) {
              /* a named day is a hard filter: yesterday's late set that spills
                 past midnight does not count as "on Tuesday" */
              if (timeRange.day && stime.dayStr !== timeRange.day) continue;
              matchingSlot = evItem.s[sidx];
              break;
            }
          }
          if (!matchingSlot) continue;
        } else {
          matchingSlot = evItem.s[0];
        }

        var distMins = minsTo(evItem.a);
        if (distLimit === '10min' && (refAddr || isNearMeRequested)) {
          if (distMins === null || distMins > 10) continue;
        }
        var slotArr = matchingSlot || (evItem.s[0] || ['?','?']);
        list.push({
          id: evItem.id, allIds: evItem.allIds, t: evItem.t, c: evItem.c, a: evItem.a, p: evItem.p, d: evItem.d, src: evItem.src, g: evItem.g, s: evItem.s,
          w: slotArr[0] + '-' + slotArr[1], key: slotArr[0], d: distMins
        });
      }
      return list;
    }

    var mappedTags = matchedCatWord ? (CAT_MAP[matchedCatWord] || [matchedCatWord]) : null;
    var tagUsed = mappedTags ? mappedTags[0] : null;

    var endOfTodayMs = Date.UTC(nowObj.getUTCFullYear(), nowObj.getUTCMonth(), nowObj.getUTCDate(), 23, 59, 59);

    var initialTimeRange = (wStart !== null && wEnd !== null)
      ? { start: wStart, end: wEnd, day: (typeof targetDayStr !== 'undefined' && targetDayStr) || null }
      : null;
    var initialDistLimit = (refAddr || isNearMeRequested) ? '10min' : 'any';

    var matchedEvs = [];
    var catMode = 'none';
    var literalHitsCount = 0;
    var timeRelaxed = null;
    var distRelaxed = null;

    var litHitsInitial = matchedCatWord ? runFilter('literal', matchedCatWord, initialDistLimit, initialTimeRange) : [];
    if (matchedCatWord && litHitsInitial.length >= 3) {
      matchedEvs = litHitsInitial;
      catMode = 'literal';
    } else {
      literalHitsCount = litHitsInitial.length;
      var tagHitsInitial = mappedTags ? runFilter('tag', mappedTags, initialDistLimit, initialTimeRange) : [];
      if (tagHitsInitial.length > 0) {
        matchedEvs = tagHitsInitial;
        catMode = 'widened';
      } else if (!matchedCatWord) {
        matchedEvs = runFilter('none', null, initialDistLimit, initialTimeRange);
        catMode = 'none';
      }
    }

    if (matchedEvs.length === 0 && initialTimeRange && initialTimeRange.start !== null) {
      var timeLaterToday = { start: initialTimeRange.start, end: endOfTodayMs };
      var litHitsToday = matchedCatWord ? runFilter('literal', matchedCatWord, initialDistLimit, timeLaterToday) : [];
      if (matchedCatWord && litHitsToday.length >= 3) {
        matchedEvs = litHitsToday;
        catMode = 'literal';
        timeRelaxed = 'today';
      } else {
        if (matchedCatWord && litHitsToday.length > 0) literalHitsCount = litHitsToday.length;
        var tagHitsToday = mappedTags ? runFilter('tag', mappedTags, initialDistLimit, timeLaterToday) : [];
        if (tagHitsToday.length > 0) {
          matchedEvs = tagHitsToday;
          catMode = 'widened';
          timeRelaxed = 'today';
        } else if (!matchedCatWord) {
          var noneHitsToday = runFilter('none', null, initialDistLimit, timeLaterToday);
          if (noneHitsToday.length > 0) {
            matchedEvs = noneHitsToday;
            timeRelaxed = 'today';
          }
        }
      }
    }

    if (matchedEvs.length === 0 && initialDistLimit === '10min') {
      var litHitsAnyDist = matchedCatWord ? runFilter('literal', matchedCatWord, 'any', initialTimeRange) : [];
      if (matchedCatWord && litHitsAnyDist.length > 0) {
        matchedEvs = litHitsAnyDist;
        catMode = 'literal';
        distRelaxed = 'nearest';
      } else {
        var tagHitsAnyDist = mappedTags ? runFilter('tag', mappedTags, 'any', initialTimeRange) : [];
        if (tagHitsAnyDist.length > 0) {
          matchedEvs = tagHitsAnyDist;
          catMode = 'widened';
          distRelaxed = 'nearest';
        }
      }

      if (matchedEvs.length === 0 && initialTimeRange && initialTimeRange.start !== null) {
        var timeLaterToday2 = { start: initialTimeRange.start, end: endOfTodayMs };
        var litHitsTodayAnyDist = matchedCatWord ? runFilter('literal', matchedCatWord, 'any', timeLaterToday2) : [];
        if (matchedCatWord && litHitsTodayAnyDist.length > 0) {
          matchedEvs = litHitsTodayAnyDist;
          catMode = 'literal';
          distRelaxed = 'nearest';
          timeRelaxed = 'today';
        } else {
          var tagHitsTodayAnyDist = mappedTags ? runFilter('tag', mappedTags, 'any', timeLaterToday2) : [];
          if (tagHitsTodayAnyDist.length > 0) {
            matchedEvs = tagHitsTodayAnyDist;
            catMode = 'widened';
            distRelaxed = 'nearest';
            timeRelaxed = 'today';
          }
        }
      }
    }

    if (matchedEvs.length === 0 && initialTimeRange) {
      var litHitsWeek = matchedCatWord ? runFilter('literal', matchedCatWord, 'any', null) : [];
      if (matchedCatWord && litHitsWeek.length > 0) {
        matchedEvs = litHitsWeek;
        catMode = 'literal';
        timeRelaxed = 'week';
        distRelaxed = 'nearest';
      } else {
        var tagHitsWeek = mappedTags ? runFilter('tag', mappedTags, 'any', null) : [];
        if (tagHitsWeek.length > 0) {
          matchedEvs = tagHitsWeek;
          catMode = 'widened';
          timeRelaxed = 'week';
          distRelaxed = 'nearest';
        } else if (!matchedCatWord) {
          /* token-only query ("grilled cheese ... now"): relax to the week too */
          var noneHitsWeek = runFilter('none', null, 'any', null);
          if (noneHitsWeek.length > 0) {
            matchedEvs = noneHitsWeek;
            timeRelaxed = 'week';
            if (initialDistLimit === '10min') distRelaxed = 'nearest';
          }
        }
      }
    }

    if (here) {
      matchedEvs.sort(function(a,b){ return (a.d == null ? 999 : a.d) - (b.d == null ? 999 : b.d); });
    } else {
      matchedEvs.sort(function(a,b){ return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
    }

    if (matchedEvs.length === 0) {
      return {
        reply: "Nothing matching that. Try a camp name, a time like tonight, or a place like 7:30 & F.",
        results: []
      };
    }

    var total = matchedEvs.length;
    var catNoun = '';
    if (catMode === 'literal') {
      catNoun = getCategoryNoun(matchedCatWord, total);
    } else if (catMode === 'widened') {
      catNoun = getCategoryNoun(tagUsed, total);
    } else {
      catNoun = total === 1 ? 'event' : 'events';
    }

    var replyParts = [];
    var sameWordAndTag = (matchedCatWord && tagUsed && matchedCatWord.toLowerCase().normalize('NFD').replace(FOLD_RE,'') === tagUsed.toLowerCase().normalize('NFD').replace(FOLD_RE,''));

    if (catMode === 'widened' && !sameWordAndTag) {
      if (timeRelaxed || distRelaxed) {
        var noStr = 'No ' + matchedCatWord;
        if (isNearMeRequested || refAddr) noStr += ' near you';
        else if (initialDistLimit === '10min') noStr += ' within 10 minutes';
        if (hasTimeFilter && timeDesc) noStr += ' ' + timeDesc;
        noStr += '.';
        replyParts.push(noStr);
      } else {
        if (literalHitsCount === 0) {
          replyParts.push('No ' + matchedCatWord + ' by name, so here is ' + tagUsed + ':');
        } else {
          replyParts.push('Only ' + literalHitsCount + ' ' + getCategoryNoun(matchedCatWord, literalHitsCount) + ' by name, so here is ' + tagUsed + ':');
        }
      }
    } else if (catMode === 'literal' && (timeRelaxed || distRelaxed)) {
      var noStrLit = 'No ' + matchedCatWord;
      if (initialDistLimit === '10min') noStrLit += ' within 10 minutes';
      if (hasTimeFilter && timeDesc) noStrLit += ' ' + timeDesc;
      noStrLit += '.';
      replyParts.push(noStrLit);
    }

    /* existence questions get a straight yes: "Is Layla Martin giving a
       workshop?" answers "Yes, one: <title>" */
    var isExistence = /^(?:is|are|does|do|any)\b/i.test(raw);
    var countPart = '';
    if (isExistence && total === 1) {
      countPart = 'Yes, one: ' + matchedEvs[0].t;
    } else if (isExistence && total <= 60) {
      countPart = 'Yes, ' + total + ' ' + catNoun;
    } else if (total > 60) {
      countPart = 'Showing the first 60 of ' + total + ' ' + catNoun;
    } else {
      countPart = total + ' ' + catNoun;
    }
    replyParts.push(countPart);

    if (placeDesc) replyParts.push(placeDesc);

    if (timeRelaxed === 'today') {
      replyParts.push('later today');
    } else if (timeRelaxed === 'week') {
      replyParts.push('this week');
    } else if (hasTimeFilter && timeDesc) {
      replyParts.push(timeDesc);
    }

    var mainReply = replyParts.join(' ');
    if (!/\.$/.test(mainReply)) {
      if (here && total > 60) {
        mainReply += ', closest first.';
      } else {
        mainReply += '.';
      }
    }

    if (playaInfo.isFallback && hasTimeFilter) {
      mainReply += ' (Showing Sun 30 Aug, the first day of the burn.)';
    }

    return { reply: mainReply, results: matchedEvs.slice(0, 60) };
  }

  /* ---- Ask: conversational, with a hard offline fallback ---- */
  var askTurns = [];      /* last 3 turns, kept short so tokens stay small */
  var askBusy = false, askSeq = 0;
  var askRows = [], askHeadline = '';
  var ASK_CARD_LIMIT = 12;

  function askShow(html) {
    var box = $('ask-reply');
    if (!box) return;
    box.style.display = '';
    box.innerHTML = html;
  }
  function askCards(rows) {
    askRows = rows || [];
    if (!askRows.length) return '';
    var day = $('day') ? $('day').value : '';
    var head = askRows.slice(0, ASK_CARD_LIMIT);
    var out = '<ul class="ev ask-cards">' + head.map(function(r){ return card(r, day); }).join('') + '</ul>';
    if (askRows.length > head.length) out += '<div class="btnrow"><button type="button" class="btn ask-more-btn">Show all ' + askRows.length + ' in the list below</button></div>';
    return out;
  }
  function askBubbles(userText, bodyHtml, noteText, cardsHtml) {
    return '<div class="chat-turn">'
      + '<div class="chat-you">' + esc(userText) + '</div>'
      + '<div class="chat-me">' + bodyHtml + (cardsHtml || '') + '</div>'
      + (noteText ? '<div class="chat-note">' + esc(noteText) + '</div>' : '')
      + '</div>';
  }
  function askProse(text) {
    return String(text == null ? '' : text).split(/\n{2,}/).map(function(para){
      return '<p>' + esc(para).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function askPaint(rows, headline) {
    if (!$('list')) return;
    if ($('count')) $('count').textContent = headline;
    var day = $('day') ? $('day').value : '';
    $('list').innerHTML = (rows || []).map(function(r){ return card(r, day); }).join('')
      || '<li>Nothing matches.</li>';
    if ($('more')) $('more').style.display = 'none';
  }
  var ANSWER_LOC_GUARD = null;
  function askLocally(queryText, note) {
    /* Late fallbacks must not overwrite a location the user changed while the
       network attempt was in flight. */
    ANSWER_LOC_GUARD = askLocAtStart;
    var res;
    try { res = answer(queryText); }
    finally { ANSWER_LOC_GUARD = null; }
    askHeadline = res.reply;
    askShow(askBubbles(queryText, askProse(res.reply), note || 'Answered offline from the guide.', askCards(res.results)));
    syncStarButtons();
  }

  var askLocAtStart = null;
  var askPending = null;
  function runAsk(queryText) {
    queryText = String(queryText == null ? '' : queryText).trim();
    if (!queryText) return;
    if (askBusy) { askPending = queryText; return; }   /* run after the flight */
    askLocAtStart = $('loc') ? $('loc').value : null;
    if (queryText.length > 300) queryText = queryText.slice(0, 300);
    var askInput = $('ask-q');
    if (askInput) askInput.value = queryText;

    var seq = ++askSeq, startedAt = Date.now();
    askBusy = true;
    var askBtn = $('ask-btn');
    if (askBtn) askBtn.disabled = true;

    askShow(askBubbles(queryText,
      '<p class="chat-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span>'
      + ' <span id="ask-slow">Reading the listings</span></p>', '', ''));
    var slowTimer = setTimeout(function(){
      if (seq !== askSeq) return;
      var t = $('ask-slow');
      if (t) t.textContent = 'Still going, the signal out here is thin';
    }, 2500);

    function done() {
      clearTimeout(slowTimer);
      askBusy = false;
      if (askBtn) askBtn.disabled = false;
      if (askPending) {
        var nextQ = askPending;
        askPending = null;
        setTimeout(function(){ runAsk(nextQ); }, 0);
      }
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      done(); askLocally(queryText); return;
    }
    if (typeof fetch !== 'function') { done(); askLocally(queryText); return; }

    var ctrl = null, killer = null;
    try {
      ctrl = new AbortController();
      killer = setTimeout(function(){ try { ctrl.abort(); } catch(e){} }, 15000);
    } catch(e){}

    fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: queryText,
        loc: ($('loc') && $('loc').value.trim()) || null,
        speed: +($('mode') ? $('mode').value : 12) || 12,
        history: askTurns.slice(-6)
      }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function(r){
      return r.json().then(function(j){ j.__status = r.status; return j; });
    }).then(function(j){
      if (killer) clearTimeout(killer);
      if (seq !== askSeq) { done(); return; }
      done();

      if (j.__status === 429) { askLocally(queryText, 'Busy right now, so that one came from the offline guide.'); return; }
      if (j.refused) {
        askTurns = [];
        askRows = [];
        askShow(askBubbles(queryText, askProse(j.reply), '', ''));
        return;
      }
      if (!j.reply || j.fallback) {
        var res = answer(queryText);
        var mixed = (j.results && j.results.length) ? j.results : res.results;
        askHeadline = res.reply;
        askShow(askBubbles(queryText, askProse(res.reply), 'Answered offline from the guide.', askCards(mixed)));
        syncStarButtons();
        return;
      }

      var took = Date.now() - startedAt;
      var note = [];
      if (j.cached) note.push('answered before, in the last day');
      if (took > 2500) note.push((Math.round(took / 100) / 10) + 's');
      var n = (j.results || []).length;
      askHeadline = n + (n === 1 ? ' event' : ' events') + (j.parsed && j.parsed.placeDesc ? ' ' + j.parsed.placeDesc : '');
      askShow(askBubbles(queryText, askProse(j.reply), note.join(' · '), askCards(j.results)));
      syncStarButtons();

      askTurns.push({ role: 'user', content: queryText });
      askTurns.push({ role: 'assistant', content: String(j.reply).slice(0, 300) });
      if (askTurns.length > 6) askTurns = askTurns.slice(-6);
    }).catch(function(){
      if (killer) clearTimeout(killer);
      if (seq !== askSeq) { done(); return; }
      done();
      askLocally(queryText);
    });
  }

  /* ---- Add to Home Screen ---- */
  var deferredInstall = null;
  var INSTALL_SLOTS = [
    { block: 'install-block-modal', btn: 'install-btn-modal', hint: 'install-hint-modal' },
    { block: 'install-block-itin', btn: 'install-btn-itin', hint: 'install-hint-itin' },
    { block: 'install-block-save', btn: 'install-btn-save', hint: 'install-hint-save' }
  ];
  var IOS_INSTALL_HINT = 'On iPhone there is no button for this. Tap the Share icon in Safari, scroll down the list, then tap Add to Home Screen.';
  function isStandalone(){
    try {
      if (window.navigator && window.navigator.standalone) return true;
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch(e){}
    return false;
  }
  function isIOS(){
    var ua = (window.navigator && window.navigator.userAgent) || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return /Macintosh/.test(ua) && typeof document !== 'undefined' && ('ontouchend' in document);
  }
  function eachInstallSlot(fn){
    for (var i = 0; i < INSTALL_SLOTS.length; i++) {
      var cfg = INSTALL_SLOTS[i];
      fn($(cfg.block), $(cfg.btn), $(cfg.hint));
    }
  }
  function hideInstall(){
    eachInstallSlot(function(block, btn, hint){
      if (block) block.style.display = 'none';
      if (btn) btn.style.display = 'none';
      if (hint) hint.style.display = 'none';
    });
  }
  function showInstallButton(){
    eachInstallSlot(function(block, btn, hint){
      if (block) block.style.display = '';
      if (btn) btn.style.display = '';
      if (hint) {
        hint.style.display = 'none';
        hint.textContent = '';
      }
    });
  }
  function showInstallHint(text){
    eachInstallSlot(function(block, btn, hint){
      if (block) block.style.display = '';
      if (btn) btn.style.display = 'none';
      if (hint) {
        hint.textContent = text;
        hint.style.display = '';
      }
    });
  }
  function onBeforeInstallPrompt(e){
    if (e && e.preventDefault) e.preventDefault();
    deferredInstall = e;
    if (isStandalone() || isIOS()) return;
    if ($('install-btn-modal')) showInstallButton();
  }
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', function(){ deferredInstall = null; hideInstall(); toast('Saved to your home screen. It runs with no signal now.'); });
  function initInstall(){
    hideInstall();
    if (isStandalone()) return;
    if (isIOS()) {
      showInstallHint(IOS_INSTALL_HINT);
      return;
    }
    if (deferredInstall) showInstallButton();
    eachInstallSlot(function(block, btn){
      if (!btn) return;
      btn.addEventListener('click', function(){
        var ev = deferredInstall;
        deferredInstall = null;
        if (!ev || !ev.prompt) {
          hideInstall();
          return;
        }
        try {
          ev.prompt();
        } catch(err) {
          hideInstall();
          return;
        }
        var choice = ev.userChoice;
        if (choice && choice.then) {
          choice.then(function(){
            hideInstall();
          }, function(){
            hideInstall();
          });
        } else hideInstall();
      });
    });
  }

  /* ---- Profile: name + camp, local only ---- */
  var PROFILE_KEY = 'bpg.profile';
  function getProfile(){
    try {
      var p = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
      if (p && typeof p === 'object') return p;
    } catch(e){}
    return {};
  }
  function saveProfile(patch){
    var p = getProfile();
    for (var k in patch) { if (patch.hasOwnProperty(k)) p[k] = patch[k]; }
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch(e){}
    return p;
  }
  /* Greeting renders in exactly ONE place: the results header. */
  function renderGreet(){
    var el = $('greet');
    if (!el) return;
    var name = (getProfile().name || '').trim();
    if (name) {
      el.textContent = 'Alright ' + name + ', what are you looking for?';
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  }

  function normStr(s) {
    if (!s) return '';
    var str = String(s).toLowerCase().normalize('NFD').replace(FOLD_RE,'');
    if (str.normalize) {
      try {
        str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      } catch(e){}
    } else {
      str = str.replace(/[éèêë]/g, 'e').replace(/[áàâä]/g, 'a').replace(/[óòôö]/g, 'o').replace(/[úùûü]/g, 'u').replace(/ñ/g, 'n');
    }
    return str;
  }

  /* ---- Camp directory for the onboarding typeahead. The list is UI sugar;
     resolution always goes through parseWhere, the one existing matcher. ---- */
  var CAMP_DIR = null;
  function campDirectory(){
    if (CAMP_DIR) return CAMP_DIR;
    var seen = {}, out = [];
    for (var i = 0; i < EV.length; i++) {
      var e = EV[i];
      if (!e.c || !e.a) continue;
      var key = normStr(e.c);
      if (!seen[key]) {
        seen[key] = true;
        out.push({ label: e.c, camp: e.c, a: e.a, k: e.k || '' });
      }
    }
    CAMP_DIR = out;
    return out;
  }

  function campSuggest(q){
    /* Matches names AND aliases, but always shows one row per camp under its
       canonical name (alias strings in the payload can be raw multi-alias dumps). */
    var nq = normStr(q).trim();
    if (nq.length < 2) return [];
    var dir = campDirectory(), best = {}, order = [], i, key;
    for (i = 0; i < dir.length; i++) {
      var entry = dir[i];
      var campNorm = normStr(entry.camp);
      var aliasNorm = normStr(entry.k);
      var score = 0;

      if (campNorm.indexOf(nq) === 0) {
        score = 3;
      } else if (campNorm.indexOf(nq) !== -1) {
        score = 2;
      } else if (aliasNorm.indexOf(nq) !== -1) {
        score = 1;
      }

      if (!score) continue;
      key = campNorm;
      if (!best[key]) {
        best[key] = { label: entry.camp, camp: entry.camp, a: entry.a, score: score };
        order.push(key);
      } else if (score > best[key].score) {
        best[key].score = score;
      }
    }
    var out = [];
    for (i = 0; i < order.length; i++) out.push(best[order[i]]);
    out.sort(function(x, y){
      if (y.score !== x.score) return y.score - x.score;
      var xParen = x.label.indexOf('(') !== -1 ? 1 : 0;
      var yParen = y.label.indexOf('(') !== -1 ? 1 : 0;
      if (xParen !== yParen) return xParen - yParen;
      return x.label.localeCompare(y.label);
    });
    return out.slice(0, 6);
  }

  function resolveCamp(val){
    if (!val || typeof val !== 'string') return null;
    var nq = normStr(val).trim();
    if (!nq) return null;
    var dir = campDirectory();
    for (var i = 0; i < dir.length; i++) {
      var cNorm = normStr(dir[i].camp);
      var cNoThe = cNorm.replace(/^the\s+/, '');
      var nqNoThe = nq.replace(/^the\s+/, '');
      if (cNorm === nq || cNoThe === nqNoThe) {
        return { camp: dir[i].camp, addr: dir[i].a };
      }
    }
    var p = parseWhere(val);
    if (p && !p.error) {
      if (p.camp) {
        for (var j = 0; j < dir.length; j++) {
          if (normStr(dir[j].camp) === normStr(p.camp)) {
            return { camp: p.camp, addr: dir[j].a };
          }
        }
        return { camp: p.camp, addr: p.label || val };
      }
      if (p.label) {
        return { camp: val, addr: p.label };
      }
    }
    var suggestions = campSuggest(val);
    if (suggestions && suggestions.length > 0) {
      return { camp: suggestions[0].camp, addr: suggestions[0].a };
    }
    return null;
  }

  function applyCampLocation(addr, force){
    if (!addr) return;
    var locEl = $('loc');
    var curLoc = locEl ? locEl.value.trim() : '';
    var prof = getProfile();
    var setByOnboarding = prof._locFromOnboarding;
    if (!curLoc || force || setByOnboarding === curLoc) {
      if (locEl) locEl.value = addr;
      savePrefs();
      updateLocConfirm(addr);
      saveProfile({ _locFromOnboarding: addr });
    } else {
      updateLocButton();
    }
    shown = 60; render(); renderPicks();
  }

  /* ---- FEATURE B: FIRST-RUN ONBOARDING (3 steps, skippable, never blocks) ---- */
  function initModal() {
    var modal = $('intro-modal');
    var closeBtn = $('modal-close');
    var helpBtn = $('show-intro');
    var previousFocus = null;
    var obStep = 1;

    function showStep(n){
      obStep = n;
      for (var s = 1; s <= 3; s++) {
        var el = $('ob-step-' + s);
        if (el) el.style.display = (s === n) ? '' : 'none';
        var dot = $('ob-dot-' + s);
        if (dot) dot.className = 'ob-dot' + (s === n ? ' on' : '');
      }
    }

    function openModal(step) {
      if (!modal) return;
      previousFocus = document.activeElement;
      var prof = getProfile();
      if ($('ob-name')) $('ob-name').value = prof.name || '';
      if ($('ob-camp')) $('ob-camp').value = prof.camp || '';
      if ($('ob-camp-list')) $('ob-camp-list').innerHTML = '';
      if ($('ob-camp-offer')) $('ob-camp-offer').style.display = 'none';
      showStep(step || 1);
      modal.style.display = 'flex';
      document.body.classList.add('modal-open');
      /* autofocus the field on desktop only: mobile keyboards jumping on load feel broken */
      var wide = false;
      try { wide = window.innerWidth >= 768; } catch(e){}
      if (wide && $('ob-name')) $('ob-name').focus();
      else if (closeBtn) closeBtn.focus();
    }

    function closeModal() {
      if (!modal) return;
      modal.style.display = 'none';
      document.body.classList.remove('modal-open');
      try { localStorage.setItem('bpg.seen.intro', '1'); } catch(e){}
      if (previousFocus && previousFocus.focus) previousFocus.focus();
    }

    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) closeModal();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }

    if (helpBtn) {
      helpBtn.addEventListener('click', function(e) {
        e.preventDefault();
        openModal();
      });
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        if (modal && modal.style.display !== 'none') {
          closeModal();
        }
      }
      if (modal && modal.style.display !== 'none' && (e.key === 'Tab' || e.keyCode === 9)) {
        var focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusables.length > 0) {
          var first = focusables[0];
          var last = focusables[focusables.length - 1];
          if (e.shiftKey) {
            if (document.activeElement === first) {
              last.focus();
              e.preventDefault();
            }
          } else {
            if (document.activeElement === last) {
              first.focus();
              e.preventDefault();
            }
          }
        }
      }
    });

    var modalChips = modal ? modal.querySelectorAll('.modal-chip') : [];
    for (var mc = 0; mc < modalChips.length; mc++) {
      modalChips[mc].addEventListener('click', function(e) {
        var q = e.target.getAttribute('data-q');
        closeModal();
        if (q) runAsk(q);
      });
    }

    /* step 1: first name (optional) */
    function commitName(){
      var el = $('ob-name');
      var name = el ? el.value.trim().split(/\s+/)[0] : '';
      if (name) saveProfile({ name: name });
      renderGreet();
    }
    if ($('ob-next-1')) $('ob-next-1').addEventListener('click', function(){ commitName(); showStep(2); });
    if ($('ob-skip-1')) $('ob-skip-1').addEventListener('click', function(){ showStep(2); });

    /* step 2: camp typeahead + offer to use its address as the starting point */
    var pickedCamp = null;
    function renderCampList(items){
      var box = $('ob-camp-list');
      if (!box) return;
      var html = '';
      for (var i = 0; i < items.length; i++) {
        html += '<button type="button" class="ob-camp-item" data-camp="' + esc(items[i].camp) + '">' +
          esc(items[i].label) +
          '<span class="ob-camp-addr">' + esc(items[i].a) + '</span>' +
          '</button>';
      }
      box.innerHTML = html;
    }
    function pickCamp(campName){
      pickedCamp = null;
      var offer = $('ob-camp-offer');
      if ($('ob-camp')) $('ob-camp').value = campName;
      if ($('ob-camp-list')) $('ob-camp-list').innerHTML = '';
      var res = resolveCamp(campName) || parseWhere(campName);
      var addrLabel = (res && res.addr) || (res && res.label);
      if (res && addrLabel) {
        pickedCamp = { camp: res.camp || campName, addr: addrLabel };
        if (offer) {
          if ($('ob-camp-offer-text')) $('ob-camp-offer-text').textContent =
            (res.camp || campName) + ' is at ' + addrLabel + '. Use that as your starting point?';
          if ($('ob-camp-use')) {
            $('ob-camp-use').textContent = 'Use ' + addrLabel;
            $('ob-camp-use').style.display = '';
          }
          offer.style.display = '';
        }
      } else if (offer) offer.style.display = 'none';
    }
    var obCampEl = $('ob-camp');
    if (obCampEl) {
      obCampEl.addEventListener('input', function(){
        if ($('ob-camp-offer')) $('ob-camp-offer').style.display = 'none';
        pickedCamp = null;
        renderCampList(campSuggest(obCampEl.value));
      });
    }
    if ($('ob-camp-list')) $('ob-camp-list').addEventListener('click', function(e){
      var b = e.target.closest('.ob-camp-item');
      if (b) pickCamp(b.getAttribute('data-camp'));
    });
    if ($('ob-camp-use')) $('ob-camp-use').addEventListener('click', function(){
      if (!pickedCamp) return;
      saveProfile({ camp: pickedCamp.camp, campAddress: pickedCamp.addr });
      applyCampLocation(pickedCamp.addr, true);
      if ($('ob-camp-offer')) $('ob-camp-offer').style.display = 'none';
      showStep(3);
    });
    function commitCamp(onSuccess){
      var val = obCampEl ? obCampEl.value.trim() : '';
      if (!val) {
        if (onSuccess) onSuccess();
        return true;
      }
      var res = pickedCamp ? { camp: pickedCamp.camp, addr: pickedCamp.addr } : resolveCamp(val);
      if (res && res.camp) {
        saveProfile({ camp: res.camp, campAddress: res.addr || '' });
        if (res.addr) {
          applyCampLocation(res.addr);
        }
        if (onSuccess) onSuccess();
        return true;
      } else {
        var offer = $('ob-camp-offer');
        if (offer) {
          if ($('ob-camp-offer-text')) $('ob-camp-offer-text').textContent = 'I do not know that camp, you can set it later';
          if ($('ob-camp-use')) $('ob-camp-use').style.display = 'none';
          offer.style.display = '';
        }
        return false;
      }
    }
    if ($('ob-next-2')) $('ob-next-2').addEventListener('click', function(){
      commitCamp(function(){ showStep(3); });
    });
    if ($('ob-skip-2')) $('ob-skip-2').addEventListener('click', function(){ showStep(3); });

    /* step 3: how to use it, then Start */
    if ($('ob-start')) $('ob-start').addEventListener('click', closeModal);

    try {
      var seen = localStorage.getItem('bpg.seen.intro');
      if (!seen) {
        openModal(1);
      }
    } catch(e){}
  }

  /* ---- My Events: a first-class screen state driven by the #myevents hash.
     Back button and reload both land where the user expects, entirely offline. ---- */
  function normPath(p){
    return String(p || '').replace(/\.html$/,'').replace(/\/index$/,'').replace(/\/$/,'');
  }
  function syncTabBar(){
    var loc = window.location || {};
    var path = normPath(loc.pathname);
    Array.prototype.forEach.call(document.querySelectorAll('nav.tabs a'), function(a){
      var tab = a.getAttribute('data-tab');
      var href = normPath((a.getAttribute('href') || '').split('#')[0]);
      var cur = false;
      if (tab === 'myevents') {
        cur = mylistOnly;
      } else {
        cur = !!href && href === path && !(mylistOnly && tab === 'finder');
      }
      if (cur) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }
  function applyHashMode(){
    var hash = (window.location && window.location.hash) || '';
    var on = hash === '#myevents';
    var changed = (on !== mylistOnly);
    mylistOnly = on;
    if (changed) shown = 60;
    if (document.body && document.body.classList) {
      if (on) document.body.classList.add('myevents');
      else document.body.classList.remove('myevents');
    }
    if (/^#ask=/i.test(hash)) {
      var q = '';
      try { q = decodeURIComponent(hash.slice(5)).replace(/\+/g, ' '); } catch(e){ q = hash.slice(5); }
      if ($('ask-q')) $('ask-q').value = '';
      if ($('day')) $('day').value = '';
      if (q) {
        try { runAsk(q); } catch(e){}
      }
    }
    syncTabBar();
    render();
    if (on && changed) {
      var resSec = $('results');
      if (resSec && resSec.scrollIntoView) resSec.scrollIntoView({ block: 'start' });
    } else if (changed && window.scrollTo) {
      try { window.scrollTo(0, 0); } catch(e){}
    }
  }

  /* ---- New-build toast: the sw serves the previous build first, so tell the
     user a fresh one is ready and let one tap load it. ---- */
  var swUpdateShown = false;
  var swToastRetries = 0;
  function showUpdateToast(reg){
    if (swUpdateShown || $('update-toast')) return;
    /* never fight the onboarding modal for the screen: wait until it closes
       (bounded: give up after ~1 minute rather than polling forever) */
    if (document.body && document.body.classList && document.body.classList.contains('modal-open')) {
      if (swToastRetries++ < 20) setTimeout(function(){ showUpdateToast(reg); }, 3000);
      return;
    }
    swUpdateShown = true;
    var b = document.createElement('button');
    b.id = 'update-toast';
    b.type = 'button';
    b.className = 'update-toast';
    b.textContent = 'Updated. Tap to refresh';
    b.addEventListener('click', function(){
      /* skipWaiting is async: reload only after the new worker takes control,
         or the reload re-serves the OLD cache and the toast comes right back.
         The timeout covers the no-waiting-worker case. */
      var reloaded = false;
      function goReload(){
        if (reloaded) return;
        reloaded = true;
        try { window.location.reload(); } catch(e){}
      }
      try {
        if (reg && reg.waiting && reg.waiting.postMessage) {
          var sw = navigator.serviceWorker;
          if (sw && sw.addEventListener) sw.addEventListener('controllerchange', goReload);
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          setTimeout(goReload, 1200);
          return;
        }
      } catch(e){}
      goReload();
    });
    if (document.body) document.body.appendChild(b);
  }
  function initSwUpdate(){
    try {
      if (!('serviceWorker' in navigator) || !navigator.serviceWorker) return;
      var sw = navigator.serviceWorker;
      if (sw.addEventListener) sw.addEventListener('controllerchange', function(){
        /* a new build took control while the page is open */
        if (sw.controller) showUpdateToast(null);
      });
      if (!sw.getRegistration) return;
      sw.getRegistration('/guide/').then(function(reg){
        if (!reg) return;
        if (reg.waiting && sw.controller) showUpdateToast(reg);
        if (reg.addEventListener) reg.addEventListener('updatefound', function(){
          var nw = reg.installing;
          if (!nw || !nw.addEventListener) return;
          nw.addEventListener('statechange', function(){
            if (nw.state === 'installed' && sw.controller) showUpdateToast(reg);
          });
        });
      }).catch(function(){});
    } catch(e){}
  }

  /* ---- Move to another device: email the user their own list. Honest and
     optional: the copy states the email is stored, the app never nags for it,
     and "no account needed" stays true. The share link IS the payload; the
     server never lets an email look a list up (see api/list-sync.js). ---- */
  function updateInstallPanel(){
    var installedEl = $('install-status-installed');
    var blockEl = $('install-block-itin');
    var btnEl = $('install-btn-itin');
    var hintEl = $('install-hint-itin');

    if (isStandalone()) {
      if (installedEl) { installedEl.textContent = 'Already installed on your home screen.'; installedEl.style.display = ''; }
      if (blockEl) blockEl.style.display = 'none';
      if (btnEl) btnEl.style.display = 'none';
      if (hintEl) hintEl.style.display = 'none';
      return;
    }
    if (installedEl) installedEl.style.display = 'none';

    if (isIOS()) {
      if (blockEl) blockEl.style.display = '';
      if (btnEl) btnEl.style.display = 'none';
      if (hintEl) { hintEl.textContent = IOS_INSTALL_HINT; hintEl.style.display = ''; }
      return;
    }

    if (deferredInstall) {
      if (blockEl) blockEl.style.display = '';
      if (btnEl) btnEl.style.display = '';
      if (hintEl) { hintEl.textContent = ''; hintEl.style.display = 'none'; }
    } else {
      if (blockEl) blockEl.style.display = '';
      if (btnEl) btnEl.style.display = 'none';
      if (hintEl) {
        hintEl.textContent = 'To install, open your browser menu and select Add to Home Screen.';
        hintEl.style.display = '';
      }
    }
  }

  function initMyEventsAccordion(){
    var items = [
      { btn: $('myevents-btn-cal'), panel: $('myevents-panel-cal') },
      { btn: $('myevents-btn-pdf'), panel: $('myevents-panel-pdf') },
      { btn: $('myevents-btn-own'), panel: $('myevents-panel-own') },
      { btn: $('myevents-btn-move'), panel: $('myevents-panel-move') },
      { btn: $('myevents-btn-install'), panel: $('myevents-panel-install') }
    ];
    function closeAll(){
      for (var i = 0; i < items.length; i++) {
        if (items[i].btn) items[i].btn.setAttribute('aria-expanded', 'false');
        if (items[i].panel) items[i].panel.style.display = 'none';
      }
    }
    for (var i = 0; i < items.length; i++) {
      (function(item){
        if (!item.btn) return;
        item.btn.addEventListener('click', function(){
          var open = item.btn.getAttribute('aria-expanded') === 'true';
          closeAll();
          if (!open) {
            item.btn.setAttribute('aria-expanded', 'true');
            if (item.panel) item.panel.style.display = '';
            if (item.panel && item.panel.id === 'myevents-panel-install') updateInstallPanel();
          }
        });
      })(items[i]);
    }
    document.addEventListener('keydown', function(ev){
      if (ev.key === 'Escape' || ev.keyCode === 27) closeAll();
    });

    var shareBtn = $('myevents-share-btn');
    if (shareBtn) shareBtn.addEventListener('click', function(){ doShare(); });
    var copyBtn = $('myevents-copy-btn');
    if (copyBtn) copyBtn.addEventListener('click', function(){ copyShareLink(); });
  }

  /* ---- Move to another device: email the user their own list. Honest and
     optional: the copy states the email is stored, the app never nags for it,
     and "no account needed" stays true. The share link IS the payload; the
     server never lets an email look a list up (see api/list-sync.js). ---- */
  function initMoveDevice(){
    var form = $('move-device-form');
    var emailEl = $('move-device-email'), note = $('move-device-note');
    if (!form) return;
    if (emailEl) {
      try {
        var savedEmail = localStorage.getItem('bpg.email') || '';
        if (savedEmail) emailEl.value = savedEmail;
      } catch(e){}
    }
    function say(msg){ if (note) note.textContent = msg; }
    var moveSeq = 0;
    form.addEventListener('submit', function(ev){
      ev.preventDefault();
      var mySeq = ++moveSeq;
      var email = ((emailEl && emailEl.value) || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { say('That does not look like an email address.'); return; }
      if (starred.size === 0) { say('Star something first, then send the list.'); return; }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        say('This needs signal. Your list still lives on this phone; Share this guide works too.');
        return;
      }
      if (typeof fetch !== 'function') { say('Could not send from this browser. Use Share this guide instead.'); return; }
      var hashes = shareHashes();
      if (hashes.length === 0) { say('Star something first, then send the list.'); return; }
      var prof = getProfile();
      var sendBtn = $('move-device-send');
      if (sendBtn) sendBtn.disabled = true;
      say('Sending.');
      fetch('/api/list-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          hashes: hashes,
          name: prof.name || null,
          camp: prof.camp || null
        })
      }).then(function(r){
        return r.json().then(function(j){ j.__status = r.status; return j; });
      }).then(function(j){
        if (mySeq !== moveSeq) return;   /* a newer submit owns the UI now */
        if (sendBtn) sendBtn.disabled = false;
        if (j && j.ok) {
          try { localStorage.setItem('bpg.email', email); } catch(e){}
          say('Sent. Open the email on your other phone and tap Merge.');
          toast('Sent. Check your inbox.');
        } else if (j && j.__status === 429) {
          say('Limit reached for today. Use Share this guide instead.');
        } else {
          say('Could not send right now. Use Share this guide instead.');
        }
      }).catch(function(){
        if (mySeq !== moveSeq) return;
        if (sendBtn) sendBtn.disabled = false;
        say('Could not send right now. Use Share this guide instead.');
      });
    });
  }

  /* ---- Calendar buttons: subscribe, don't download. Google Calendar adds
     the hosted feed via "from URL"; iPhone opens the native subscribe sheet
     through webcal://. Both stay in sync with the hosted list. ---- */
  var ICS_HOST = 'musecafe.vip';
  function listIcsUrl(scheme){
    return scheme + '://' + ICS_HOST + '/api/list-ics?l=' + shareHashes().join(',');
  }
  function initCalendarButtons(){
    var g = $('gcal-btn'), ip = $('iphone-cal-btn');
    function guard(){
      if (starred.size === 0 || shareHashes().length === 0) {
        toast('Star events first, then add them to your calendar.');
        return false;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        toast('Adding to a calendar needs signal. The .ics download works offline.');
        return false;
      }
      return true;
    }
    if (g) g.addEventListener('click', function(){
      if (!guard()) return;
      var url = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(listIcsUrl('webcal'));
      window.open(url, '_blank', 'noopener');
    });
    if (ip) ip.addEventListener('click', function(){
      if (!guard()) return;
      window.location.href = listIcsUrl('webcal');
    });
  }

  /* ---- Printable PDF: open it, or email it (same list-sync endpoint,
     mode:'pdf', which also stores the backup row). ---- */
  function initPdfPanel(){
    var openBtn = $('pdf-open-btn');
    var form = $('pdf-email-form');
    var emailEl = $('pdf-email-input'), note = $('pdf-email-note');
    function say(msg){ if (note) note.textContent = msg; }
    if (emailEl) {
      try {
        var savedEmail = localStorage.getItem('bpg.email') || '';
        if (savedEmail) emailEl.value = savedEmail;
      } catch(e){}
    }
    if (openBtn) openBtn.addEventListener('click', function(){
      var hashes = shareHashes();
      if (hashes.length === 0) { toast('Star events first, then get the PDF.'); return; }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        toast('The PDF needs signal to build. Your list itself works offline.');
        return;
      }
      var prof = getProfile();
      var url = '/api/list-pdf?l=' + hashes.join(',') + (prof.name ? '&name=' + encodeURIComponent(prof.name) : '');
      window.open(url, '_blank', 'noopener');
    });
    if (!form) return;
    var pdfSeq = 0;
    form.addEventListener('submit', function(ev){
      ev.preventDefault();
      var mySeq = ++pdfSeq;
      var email = ((emailEl && emailEl.value) || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { say('That does not look like an email address.'); return; }
      var hashes = shareHashes();
      if (hashes.length === 0) { say('Star something first, then send the PDF.'); return; }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { say('This needs signal.'); return; }
      var prof = getProfile();
      var sendBtn = $('pdf-email-send');
      if (sendBtn) sendBtn.disabled = true;
      say('Sending.');
      fetch('/api/list-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          hashes: hashes,
          name: prof.name || null,
          camp: prof.camp || null,
          mode: 'pdf'
        })
      }).then(function(r){
        return r.json().then(function(j){ j.__status = r.status; return j; });
      }).then(function(j){
        if (mySeq !== pdfSeq) return;
        if (sendBtn) sendBtn.disabled = false;
        if (j && j.ok) {
          try { localStorage.setItem('bpg.email', email); } catch(e){}
          say('Sent. The PDF is in your inbox.');
          toast('PDF sent. Check your inbox.');
        } else if (j && j.__status === 429) {
          say('Limit reached for today. Use Open the PDF instead.');
        } else {
          say('Could not send right now. Use Open the PDF instead.');
        }
      }).catch(function(){
        if (mySeq !== pdfSeq) return;
        if (sendBtn) sendBtn.disabled = false;
        say('Could not send right now. Use Open the PDF instead.');
      });
    });
  }

  /* ---- Add your own private event (camp shift, wedding). Stays on-device. ---- */
  function initOwnEvents(){
    var form = $('own-event-form');
    if (!form) return;
    var msg = $('own-note-msg');
    function say(t){ if (msg) msg.textContent = t; }
    form.addEventListener('submit', function(ev){
      ev.preventDefault();
      var t = ($('own-title') && $('own-title').value || '').trim();
      var day = $('own-day') ? $('own-day').value : '';
      var hm = ($('own-start') && $('own-start').value || '').trim();
      var end = ($('own-end') && $('own-end').value || '').trim();
      var aRaw = ($('own-addr') && $('own-addr').value || '').trim();
      var n = ($('own-note') && $('own-note').value || '').trim();
      if (!t) { say('Give it a name first.'); return; }
      if (!day) { say('Pick a day. During the burn "some day" means never.'); return; }
      var a = '';
      if (aRaw) {
        var parsed = parseWhere ? parseWhere(aRaw) : null;
        a = (parsed && parsed.label) ? parsed.label : aRaw;
      }
      ownEvents.push({
        id: 'own-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
        t: t, day: day, hm: hm || null, end: end || null, a: a, n: n
      });
      saveOwnEvents();
      form.reset();
      say('');
      toast('Added to My Events, marked Yours.');
      window.location.hash = '#myevents';
      render();
    });
  }

  /* ---- Community submissions: anyone can send a missing event in. It goes
     to a review queue at home, never straight into the guide. ---- */
  function initSubmitEvent(){
    var form = $('submit-event-form');
    if (!form) return;
    var msg = $('sub-note-msg');
    function say(t2){ if (msg) msg.textContent = t2; }
    form.addEventListener('submit', function(ev){
      ev.preventDefault();
      var text = ($('sub-text') && $('sub-text').value || '').trim();
      if (text.length < 12) { say('Give it a little more than that: what, where, when.'); return; }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        say('No signal right now. Try again when you have bars, or add it to My Events as your own event.');
        return;
      }
      var btn = $('sub-send');
      if (btn) btn.disabled = true;
      say('Sending.');
      fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text,
          id: (function(){ try { return localStorage.getItem('bpg.cid'); } catch(e){ return null; } })()
        })
      }).then(function(r){ return r.json().then(function(j){ j.__status = r.status; return j; }); })
      .then(function(j){
        if (btn) btn.disabled = false;
        if (j && j.ok) { form.reset(); say('Got it, thank you! It gets checked and lands in the guide, usually within the hour.'); toast('Sent. Thank you for the gift.'); }
        else if (j && j.__status === 429) { say('That is plenty for today. Thank you!'); }
        else { say('Could not send right now. Try again later.'); }
      }).catch(function(){
        if (btn) btn.disabled = false;
        say('Could not send right now. Try again later.');
      });
    });
  }

  function syncDayPills(){
    var curDay = $('day') ? $('day').value : '';
    var pills = document.querySelectorAll('#day-chips .day-chip');
    for (var i = 0; i < pills.length; i++) {
      var pDay = pills[i].getAttribute('data-day') || '';
      pills[i].setAttribute('aria-pressed', pDay === curDay ? 'true' : 'false');
    }
  }

  function initFilterModal(){
    var modal = $('filter-modal');
    var openBtn = $('filter-btn');
    var closeBtn = $('filter-modal-close');
    if (!modal) return;

    function openFilter(){
      syncDayPills();
      modal.style.display = 'flex';
      document.body.classList.add('modal-open');
    }

    function closeFilter(){
      modal.style.display = 'none';
      document.body.classList.remove('modal-open');
      shown = 60;
      render();
    }

    if (openBtn) openBtn.addEventListener('click', openFilter);
    if (closeBtn) closeBtn.addEventListener('click', closeFilter);

    modal.addEventListener('click', function(e){
      if (e.target === modal) closeFilter();
    });

    document.addEventListener('keydown', function(e){
      if ((e.key === 'Escape' || e.keyCode === 27) && modal.style.display !== 'none') {
        closeFilter();
      }
    });

    var dayChips = $('day-chips');
    if (dayChips) {
      dayChips.addEventListener('click', function(e){
        var chip = e.target.closest('.day-chip');
        if (!chip) return;
        var dayVal = chip.getAttribute('data-day') || '';
        if ($('day')) $('day').value = dayVal;
        syncDayPills();
        closeFilter();
      });
    }

    if ($('day')) {
      $('day').addEventListener('change', syncDayPills);
    }
  }

  function initLocModal(){
    var modal = $('loc-modal');
    var openBtn = $('loc-open-btn');
    var closeBtn = $('loc-modal-close');
    var saveBtn = $('loc-save-btn');
    if (!modal) return;

    function openLoc(){
      modal.style.display = 'flex';
      document.body.classList.add('modal-open');
      if ($('loc')) {
        updateLocConfirm($('loc').value);
        try { $('loc').focus(); } catch(e){}
      }
    }

    function closeLoc(){
      modal.style.display = 'none';
      document.body.classList.remove('modal-open');
      updateLocButton();
      shown = 60;
      render();
      renderPicks();
    }

    if (openBtn) openBtn.addEventListener('click', openLoc);
    if (closeBtn) closeBtn.addEventListener('click', closeLoc);
    if (saveBtn) saveBtn.addEventListener('click', closeLoc);

    modal.addEventListener('click', function(e){
      if (e.target === modal) closeLoc();
    });

    document.addEventListener('keydown', function(e){
      if ((e.key === 'Escape' || e.keyCode === 27) && modal.style.display !== 'none') {
        closeLoc();
      }
    });

    var qpContainer = $('loc-quick-picks');
    if (qpContainer) {
      qpContainer.addEventListener('click', function(e){
        var chip = e.target.closest('.loc-chip');
        if (!chip) return;
        var targetLoc = chip.getAttribute('data-loc');
        if (targetLoc && $('loc')) {
          $('loc').value = targetLoc;
          updateLocConfirm(targetLoc);
          savePrefs();
          shown = 60;
          render();
          renderPicks();
          closeLoc();
        }
      });
    }
  }

  function getClockVal(clockStr) {
    if (!clockStr) return null;
    var parts = clockStr.split(':');
    if (parts.length < 2) return null;
    return parseInt(parts[0], 10) + (parseInt(parts[1], 10) / 60);
  }

  function getClockRad(clockVal) {
    return ((clockVal - 10.5) * 30) * Math.PI / 180;
  }

  function formatDist(ft) {
    return Math.round(ft).toLocaleString ? Math.round(ft).toLocaleString() : Math.round(ft);
  }

  function calcRoute(fromStr, toStr, speedVal, startStr) {
    if (!fromStr || !toStr) return null;
    var pFrom = parseWhere(fromStr);
    var pTo = parseWhere(toStr);
    if (!pFrom || pFrom.error || !pTo || pTo.error) return null;

    var curSpeed = speedVal || +($('mode') ? $('mode').value : 12) || 12;
    var modeName = curSpeed === 3 ? 'walking' : (curSpeed === 8 ? 'bike' : 'ebike');

    var rEsp = RING['ESP'] || 2492.7;

    var r1 = null, c1 = null, theta1 = null;
    if (pFrom.landmark) {
      var dy1 = (pFrom.lat - MAN[0]) * FLAT;
      var dx1 = (pFrom.lon - MAN[1]) * FLON;
      r1 = Math.hypot(dx1, dy1);
      var phi1 = Math.atan2(dx1, dy1);
      if (phi1 < 0) phi1 += 2 * Math.PI;
      theta1 = phi1;
    } else if (pFrom.street && pFrom.clock) {
      r1 = RING[pFrom.street];
      c1 = getClockVal(pFrom.clock);
      if (c1 !== null) theta1 = getClockRad(c1);
    }

    var r2 = null, c2 = null, theta2 = null;
    if (pTo.landmark) {
      var dy2 = (pTo.lat - MAN[0]) * FLAT;
      var dx2 = (pTo.lon - MAN[1]) * FLON;
      r2 = Math.hypot(dx2, dy2);
      var phi2 = Math.atan2(dx2, dy2);
      if (phi2 < 0) phi2 += 2 * Math.PI;
      theta2 = phi2;
    } else if (pTo.street && pTo.clock) {
      r2 = RING[pTo.street];
      c2 = getClockVal(pTo.clock);
      if (c2 !== null) theta2 = getClockRad(c2);
    }

    if (r1 === null || r2 === null) return null;

    var st1Label = (pFrom.street === 'ESP' ? 'Esplanade' : (pFrom.street || 'origin'));
    var st2Label = (pTo.street === 'ESP' ? 'Esplanade' : (pTo.street || 'destination'));
    var toLabel = pTo.landmark ? pTo.label : pTo.label;

    var steps = [];
    var totalDist = 0;
    var points = [];

    if (r1 < rEsp || r2 < rEsp || theta1 === null || theta2 === null) {
      var dn = (pTo.lat - pFrom.lat) * FLAT;
      var de = (pTo.lon - pFrom.lon) * FLON;
      totalDist = Math.hypot(dn, de);
      steps.push('Walk/Ride straight across open playa toward ' + toLabel + ' (' + formatDist(totalDist) + ' ft).');
      steps.push('Arrive at ' + toLabel + '.');
      points.push({ lat: pFrom.lat, lon: pFrom.lon });
      points.push({ lat: pTo.lat, lon: pTo.lon });
    } else {
      var dTheta = Math.abs(c1 - c2) * Math.PI / 6;
      var deltaR = Math.abs(r1 - r2);

      var arcDistR1 = r1 * dTheta;
      var arcDistR2 = r2 * dTheta;

      var distArcFirst = arcDistR1 + deltaR;
      var distRadialFirst = deltaR + arcDistR2;

      var useArcFirst = distArcFirst <= distRadialFirst;
      totalDist = useArcFirst ? distArcFirst : distRadialFirst;

      function generateArcPoints(R, cA, cB) {
        var pts = [];
        var count = Math.max(2, Math.ceil(Math.abs(cA - cB) * 10));
        for (var i = 0; i <= count; i++) {
          var frac = i / count;
          var curC = cA + (cB - cA) * frac;
          var b = getClockRad(curC);
          var lat = MAN[0] + (R * Math.cos(b)) / FLAT;
          var lon = MAN[1] + (R * Math.sin(b)) / FLON;
          pts.push({ lat: lat, lon: lon });
        }
        return pts;
      }

      if (c1 === c2) {
        totalDist = deltaR;
        var dirStr = r1 > r2 ? 'Head in toward ' : 'Head out toward ';
        steps.push(dirStr + st2Label + ' (' + formatDist(deltaR) + ' ft).');
        steps.push('Arrive at ' + toLabel + '.');
        points = generateArcPoints(r1, c1, c1);
        var endB = getClockRad(c2);
        points.push({ lat: MAN[0] + (r2 * Math.cos(endB)) / FLAT, lon: MAN[1] + (r2 * Math.sin(endB)) / FLON });
      } else if (r1 === r2) {
        totalDist = arcDistR1;
        var tMin = Math.max(1, Math.round(arcDistR1 / (curSpeed * 88)));
        steps.push('Turn along ' + st1Label + ' for ' + tMin + ' min toward ' + pTo.clock + ' (' + formatDist(arcDistR1) + ' ft).');
        steps.push('Arrive at ' + toLabel + '.');
        points = generateArcPoints(r1, c1, c2);
      } else if (useArcFirst) {
        var tMinArc = Math.max(1, Math.round(arcDistR1 / (curSpeed * 88)));
        steps.push('Turn along ' + st1Label + ' for ' + tMinArc + ' min toward ' + pTo.clock + ' (' + formatDist(arcDistR1) + ' ft).');
        var dirStr = r1 > r2 ? 'Head in along ' : 'Head out along ';
        steps.push(dirStr + pTo.clock + ' toward ' + st2Label + ' (' + formatDist(deltaR) + ' ft).');
        steps.push('Arrive at ' + toLabel + '.');

        var arcPts = generateArcPoints(r1, c1, c2);
        points = arcPts;
        var endB = getClockRad(c2);
        points.push({ lat: MAN[0] + (r2 * Math.cos(endB)) / FLAT, lon: MAN[1] + (r2 * Math.sin(endB)) / FLON });
      } else {
        var dirStr = r1 > r2 ? 'Head in toward ' : 'Head out toward ';
        steps.push(dirStr + st2Label + ' (' + formatDist(deltaR) + ' ft).');
        var tMinArc = Math.max(1, Math.round(arcDistR2 / (curSpeed * 88)));
        steps.push('Turn along ' + st2Label + ' for ' + tMinArc + ' min toward ' + pTo.clock + ' (' + formatDist(arcDistR2) + ' ft).');
        steps.push('Arrive at ' + toLabel + '.');

        var midB = getClockRad(c1);
        points.push({ lat: MAN[0] + (r1 * Math.cos(midB)) / FLAT, lon: MAN[1] + (r1 * Math.sin(midB)) / FLON });
        var arcPts = generateArcPoints(r2, c1, c2);
        for (var pi = 0; pi < arcPts.length; pi++) points.push(arcPts[pi]);
      }
    }

    var totalTimeMins = Math.max(1, Math.round(totalDist / (curSpeed * 88)));
    var leaveByStr = '';
    if (startStr && typeof startStr === 'string') {
      var mTime = /\b(\d{1,2}):(\d{2})\b/.exec(startStr);
      if (mTime) {
        var startH = parseInt(mTime[1], 10);
        var startM = parseInt(mTime[2], 10);
        var totalStartMins = startH * 60 + startM;
        var leaveMins = totalStartMins - totalTimeMins;
        if (leaveMins < 0) leaveMins += 24 * 60;
        var leaveH = Math.floor(leaveMins / 60);
        var leaveM = leaveMins % 60;
        var leaveHStr = leaveH < 10 ? '0' + leaveH : '' + leaveH;
        var leaveMStr = leaveM < 10 ? '0' + leaveM : '' + leaveM;
        leaveByStr = 'Leave by ' + leaveHStr + ':' + leaveMStr + ' to arrive on time.';
      }
    }

    return {
      from: pFrom,
      to: pTo,
      dist: totalDist,
      timeMins: totalTimeMins,
      mode: modeName,
      steps: steps,
      leaveBy: leaveByStr,
      points: points
    };
  }

  function initNavModal(){
    var modal = $('nav-modal');
    var closeBtn = $('nav-modal-close');
    var fromInput = $('nav-from');
    var toInput = $('nav-to');
    var gpsBtn = $('nav-gps-btn');
    var gpsMsg = $('nav-gps-msg');
    var mapBtn = $('nav-map-btn');
    var outputPanel = $('nav-output');
    var instEl = $('nav-instructions');
    var metaEl = $('nav-meta');
    var activeStartStr = null;

    if (!modal) return;

    function updateNavRoute(){
      var fVal = fromInput ? fromInput.value.trim() : '';
      var tVal = toInput ? toInput.value.trim() : '';
      if (!fVal || !tVal) {
        if (outputPanel) outputPanel.style.display = 'none';
        return;
      }
      var sp = +($('mode') ? $('mode').value : 12) || 12;
      var route = calcRoute(fVal, tVal, sp, activeStartStr);
      if (!route) {
        if (outputPanel) outputPanel.style.display = 'none';
        return;
      }
      if (instEl) {
        instEl.innerHTML = route.steps.map(function(s){ return '<p style="margin:.2rem 0">' + esc(s) + '</p>'; }).join('');
      }
      if (metaEl) {
        metaEl.textContent = 'Total time: ' + route.timeMins + ' min (' + route.mode + ').' + (route.leaveBy ? ' ' + route.leaveBy : '');
      }
      if (outputPanel) outputPanel.style.display = '';
    }

    function openNav(fromVal, toVal, startStr){
      activeStartStr = startStr || null;
      if (fromInput) fromInput.value = fromVal || '';
      if (toInput) toInput.value = toVal || '';
      if (gpsMsg) { gpsMsg.textContent = ''; gpsMsg.className = 'loc-confirm'; }
      modal.style.display = 'flex';
      document.body.classList.add('modal-open');
      updateNavRoute();
      if (!fromVal && fromInput) try { fromInput.focus(); } catch(e){}
      else if (!toVal && toInput) try { toInput.focus(); } catch(e){}
    }

    function closeNav(){
      modal.style.display = 'none';
      document.body.classList.remove('modal-open');
    }

    if (closeBtn) closeBtn.addEventListener('click', closeNav);
    modal.addEventListener('click', function(e){ if (e.target === modal) closeNav(); });
    document.addEventListener('keydown', function(e){
      if ((e.key === 'Escape' || e.keyCode === 27) && modal.style.display !== 'none') closeNav();
    });

    if (fromInput) fromInput.addEventListener('input', updateNavRoute);
    if (toInput) toInput.addEventListener('input', updateNavRoute);
    if ($('mode')) $('mode').addEventListener('change', updateNavRoute);

    document.addEventListener('click', function(e){
      var btn = e.target.closest('.nav-btn');
      if (!btn) return;
      var toAddr = btn.getAttribute('data-addr') || '';
      var startStr = btn.getAttribute('data-start') || '';
      var currentLoc = $('loc') ? $('loc').value.trim() : '';
      openNav(currentLoc, toAddr, startStr);
    });

    /* delete one of your own private events */
    document.addEventListener('click', function(e){
      var del = e.target.closest('.own-del-btn');
      if (!del) return;
      var oid = del.getAttribute('data-own-id');
      ownEvents = ownEvents.filter(function(o){ return o && o.id !== oid; });
      saveOwnEvents();
      toast('Removed from your list.');
      render();
    });

    var getDirBtn = $('map-get-directions');
    if (getDirBtn) {
      getDirBtn.addEventListener('click', function(){
        var currentLoc = $('loc') ? $('loc').value.trim() : '';
        openNav(currentLoc, '', null);
      });
    }

    if (mapBtn) {
      mapBtn.addEventListener('click', function(){
        var fVal = fromInput ? fromInput.value.trim() : '';
        var tVal = toInput ? toInput.value.trim() : '';
        closeNav();
        if (fVal && tVal) {
          var targetHash = '#nav=' + encodeURIComponent(fVal) + ';' + encodeURIComponent(tVal);
          var isMapPage = window.location.pathname.indexOf('/guide/map') !== -1;
          if (isMapPage) {
            window.location.hash = targetHash;
            if (window.__BPG_MAP && window.__BPG_MAP.drawRoute) {
              window.__BPG_MAP.drawRoute(fVal, tVal);
            }
          } else {
            window.location.href = '/guide/map' + targetHash;
          }
        }
      });
    }

    if (gpsBtn) {
      gpsBtn.addEventListener('click', function(){
        if (gpsMsg) { gpsMsg.textContent = 'Locating...'; gpsMsg.className = 'loc-confirm'; }
        if (!navigator || !navigator.geolocation || !navigator.geolocation.getCurrentPosition) {
          if (gpsMsg) { gpsMsg.textContent = 'Location services not available'; gpsMsg.className = 'loc-confirm invalid'; }
          return;
        }

        /* Backstop only: the geolocation call has its own timeout:8000, so
           this fires strictly after it, never racing a near-8s fix. */
        var timedOut = false;
        var timer = setTimeout(function(){
          timedOut = true;
          if (gpsMsg) { gpsMsg.textContent = 'Location services not available'; gpsMsg.className = 'loc-confirm invalid'; }
        }, 12000);

        navigator.geolocation.getCurrentPosition(function(pos){
          if (timedOut) return;
          if (timer) { clearTimeout(timer); timer = null; }
          var lat = pos.coords.latitude;
          var lon = pos.coords.longitude;

          var dy = (lat - MAN[0]) * FLAT;
          var dx = (lon - MAN[1]) * FLON;
          var R = Math.hypot(dx, dy);

          if (R > 9000) {
            if (gpsMsg) {
              gpsMsg.textContent = 'GPS fix looks off (> 9000 ft from The Man). Please enter location manually.';
              gpsMsg.className = 'loc-confirm invalid';
            }
            return;
          }

          var phi = Math.atan2(dx, dy);
          var deg = phi * 180 / Math.PI;
          if (deg < 0) deg += 360;

          var clockVal = 10.5 + deg / 30;
          while (clockVal > 12) clockVal -= 12;
          while (clockVal < 1) clockVal += 12;

          var snappedClock = Math.round(clockVal * 4) / 4;
          var hours = Math.floor(snappedClock);
          var mins = Math.round((snappedClock - hours) * 60);
          if (mins === 60) { hours += 1; mins = 0; }
          var clockStr = hours + ':' + (mins < 10 ? '0' + mins : mins);

          var bestStreet = 'ESP';
          var minDiff = 1e9;
          Object.keys(RING).forEach(function(st){
            var diff = Math.abs(R - RING[st]);
            if (diff < minDiff) { minDiff = diff; bestStreet = st; }
          });

          var cornerStr = clockStr + ' & ' + bestStreet;
          if (gpsMsg) {
            gpsMsg.innerHTML = 'GPS puts you at ' + esc(cornerStr) + '. <button type="button" id="nav-gps-confirm-btn" class="btn solid" style="padding:.2rem .5rem;font-size:.8rem;min-height:36px">Use it?</button>';
            gpsMsg.className = 'loc-confirm valid';
            var confirmBtn = $('nav-gps-confirm-btn');
            if (confirmBtn) {
              confirmBtn.onclick = function(){
                if (fromInput) fromInput.value = cornerStr;
                if ($('loc')) { $('loc').value = cornerStr; updateLocConfirm(cornerStr); }
                gpsMsg.textContent = 'Location set to ' + cornerStr;
                updateNavRoute();
              };
            }
          }
        }, function(err){
          if (timedOut) return;
          if (timer) { clearTimeout(timer); timer = null; }
          if (gpsMsg) { gpsMsg.textContent = 'Location services not available'; gpsMsg.className = 'loc-confirm invalid'; }
        }, { timeout: 8000, enableHighAccuracy: true });
      });
    }
  }

  function init(){
    initModal();
    initInstall();
    initMyEventsAccordion();
    initMoveDevice();
    initCalendarButtons();
    initPdfPanel();
    initOwnEvents();
    initSubmitEvent();
    initPotty();
    initFilterModal();
    initLocModal();
    initNavModal();

    document.addEventListener('click', function(e){
      var starBtn = e.target.closest('.star-btn');
      if (!starBtn) return;
      var sid = starBtn.getAttribute('data-id');
      if (!sid) return;
      if (starred.has(sid)) starred.delete(sid);
      else starred.add(sid);
      saveStars();
      render();
      renderPicks();
      syncStarButtons();
    });

    var icsBtn = $('ics-btn');
    if (icsBtn) icsBtn.addEventListener('click', exportIcs);
    var askReplyBox = $('ask-reply');
    if (askReplyBox) askReplyBox.addEventListener('click', function(e){
      var moreBtn = e.target.closest('.ask-more-btn');
      if (!moreBtn) return;
      askPaint(askRows, askHeadline);
      syncStarButtons();
      var res = $('results');
      if (res && res.scrollIntoView) res.scrollIntoView({ block: 'start' });
    });

    var askForm = $('ask-form');
    var askInput = $('ask-q');

    if (askForm) {
      askForm.addEventListener('submit', function(e){
        e.preventDefault();
        runAsk(askInput ? askInput.value : '');
      });
    }

    if ($('chips')){
      $('chips').innerHTML = TAGS.map(function(t){
        return '<button class="chip" data-t="' + t + '" aria-pressed="false">' + t + '</button>'; }).join('');
    }
    loadPrefs();
    if ($('chips') && $('chips').children){
      Array.prototype.forEach.call($('chips').children, function(b){
        if (active.has(b.dataset.t)) b.setAttribute('aria-pressed','true');
      });
      $('chips').addEventListener('click', function(e){
        var b = e.target.closest('.chip'); if (!b) return;
        var t = b.dataset.t;
        if (active.has(t)){ active.delete(t); b.setAttribute('aria-pressed','false'); }
        else { active.add(t); b.setAttribute('aria-pressed','true'); }
        shown = 60; render();
      });
    }
    var confEl = $('confirmed-only');
    if (confEl) {
      confEl.addEventListener('change', function(){
        try { localStorage.setItem('bpg.confirmedOnly', confEl.checked ? 'true' : 'false'); } catch(e){}
        shown = 60;
        render();
      });
    }
    var locEl = $('loc');
    if (locEl) {
      var locTimer = null;
      locEl.addEventListener('input', function(){
        if (locTimer) clearTimeout(locTimer);
        locTimer = setTimeout(function(){
          updateLocConfirm(locEl.value);
          shown = 60;
          render();
          renderPicks();
        }, 150);
      });
      updateLocConfirm(locEl.value);
    }

    /* loc quick picks are wired once, inside initLocModal (it also closes
       the modal); a second registration here double-fired every chip tap. */

    /* Selects re-render on change; the search box is debounced (a full render
       walks 3.6k events, far too heavy per keystroke); #loc has its own
       debounced handler above. */
    function filterRerender(){ shown = 60; render(); renderPicks(); updateLocButton(); }
    ['day','sort','mode'].forEach(function(id){
      var el = $(id); if (!el) return;
      el.addEventListener('change', filterRerender);
    });
    var askQFilterEl = $('ask-q');
    if (askQFilterEl) {
      var askQFilterTimer = null;
      askQFilterEl.addEventListener('input', function(){
        if (askQFilterTimer) clearTimeout(askQFilterTimer);
        askQFilterTimer = setTimeout(filterRerender, 200);
      });
      /* blur/Enter (change) filters immediately, no debounce wait */
      askQFilterEl.addEventListener('change', function(){
        if (askQFilterTimer) clearTimeout(askQFilterTimer);
        filterRerender();
      });
    }
    var m = $('more');
    if (m) m.addEventListener('click', function(){ shown += 60; render(); });
    /* The value line: how much more this guide holds than the official
       book. Computed from the live payload so it updates itself with every
       data deploy; 3,465 is the official 2026 Who What Where count. */
    (function valueStat(){
      var el = $('value-stat');
      if (!el) return;
      var n = EV.length, added = 0, enriched = 0;
      for (var vi = 0; vi < EV.length; vi++) {
        if (EV[vi].src !== 0 && EV[vi].src !== undefined) added++;
        else if (EV[vi].src === 0 && EV[vi].p) enriched++;
      }
      var base = n.toLocaleString('en-US') + ' events · ' +
        added.toLocaleString('en-US') + ' added + ' +
        enriched.toLocaleString('en-US') + ' enriched beyond the official book';
      el.textContent = base;
      /* live burner count, when online; cached for offline reopens */
      function showUsers(u){
        if (u > 0) el.textContent = base + ' · used by ' + u.toLocaleString('en-US') + ' burners';
      }
      try {
        var cachedU = Number(localStorage.getItem('bpg.users') || 0);
        if (cachedU) showUsers(cachedU);
        if (typeof fetch === 'function' && !(typeof navigator !== 'undefined' && navigator.onLine === false)) {
          fetch('/api/stats').then(function(r){ return r.json(); }).then(function(j){
            if (j && j.devices) {
              try { localStorage.setItem('bpg.users', String(j.devices)); } catch(e){}
              showUsers(j.devices);
            }
          }).catch(function(){});
        }
      } catch(e){}
    })();

    wireShare();
    checkShareHash();
    window.addEventListener('hashchange', checkShareHash);
    window.addEventListener('hashchange', applyHashMode);

    /* Error beacon: if the guide breaks on someone's phone mid-burn, the
       error reaches home so it can be fixed while everyone is offline.
       At most 3 reports per device per day; sends nothing personal. */
    (function errorBeacon(){
      var sent = 0;
      var NOISE = /__firefox__|__gCrWeb|safari-extension|chrome-extension|moz-extension|webkit-masked-url|ResizeObserver loop|window\.ethereum|solana|metamask|darkreader|webkit\.messageHandlers|zaloJSV2|instantSearchSDK/i;
      function report(msg, src, line){
        try {
          if (sent >= 3 || typeof fetch !== 'function') return;
          if (NOISE.test(String(msg)) || NOISE.test(String(src || ''))) return; /* browser/extension-injected, not our code */
          if (String(msg) === 'Script error.' && !src) return; /* cross-origin scripts (extensions, in-app webviews): opaque, unactionable */
          if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
          sent++;
          fetch('/api/error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: localStorage.getItem('bpg.cid') || null,
              msg: String(msg).slice(0, 300),
              src: String(src || '').slice(0, 200),
              line: line || null,
              ua: (navigator.userAgent || '').slice(0, 120)
            }),
            keepalive: true
          }).catch(function(){});
        } catch(e){}
      }
      window.addEventListener('error', function(ev){
        report(ev.message || 'script error', ev.filename, ev.lineno);
      });
      window.addEventListener('unhandledrejection', function(ev){
        var r = ev.reason;
        report('unhandledrejection: ' + (r && (r.message || String(r)) || 'unknown'), '', null);
      });
    })();

    /* Anonymous daily usage ping: a random token and today's date, nothing
       else (no IP kept, no account, no location). Fires once per day, only
       when online; the guide never depends on it. */
    (function usagePing(){
      try {
        if (typeof fetch !== 'function') return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        var day = new Date(Date.now() - 7 * 3600 * 1000).toISOString().slice(0, 10);
        if (localStorage.getItem('bpg.pinged') === day) return;
        var cid = localStorage.getItem('bpg.cid');
        if (!cid) {
          cid = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
          localStorage.setItem('bpg.cid', cid);
        }
        var sa = false;
        try { sa = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; } catch(e){}
        var qn = 0, ic = 0;
        try { qn = +localStorage.getItem('bpg.qn') || 0; ic = +localStorage.getItem('bpg.ic') || 0; } catch(e){}
        fetch('/api/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: cid, q: qn, ic: ic, sa: sa }),
          keepalive: true
        }).then(function(){ try { localStorage.setItem('bpg.pinged', day); localStorage.setItem('bpg.qn', '0'); localStorage.setItem('bpg.ic', '0'); } catch(e){} })
          .catch(function(){});
      } catch(e){}
    })();

    /* count taps on any Add-to-Home-Screen button (offline-install intent) */
    document.addEventListener('click', function(ev2){
      var t2 = ev2.target;
      while (t2 && t2 !== document) {
        if (t2.classList && t2.classList.contains('install-btn')) {
          try { localStorage.setItem('bpg.ic', String((+localStorage.getItem('bpg.ic') || 0) + 1)); } catch(e){}
          break;
        }
        t2 = t2.parentNode;
      }
    }, true);

    /* Find tab: on the finder page itself it exits My Events instead of reloading */
    document.addEventListener('click', function(e){
      if (!e.target || !e.target.closest) return;
      var findTab = e.target.closest('nav.tabs a[data-tab="finder"]');
      if (findTab) {
        var loc2 = window.location || {};
        var p2 = normPath(loc2.pathname);
        var h2 = normPath(findTab.getAttribute('href') || '');
        if (p2 === h2) {
          e.preventDefault();
          if (mylistOnly) { window.location.hash = ''; applyHashMode(); }
          else if (window.scrollTo) { try { window.scrollTo(0, 0); } catch(err){} }
        }
        return;
      }
      var findBtn = e.target.closest('.find-something-btn');
      if (findBtn) {
        window.location.hash = '';
        applyHashMode();
      }
    });

    updateStarCount();
    applyHashMode();
    renderPicks(); renderGreet();
    initSwUpdate();
    if (window.initMap) window.initMap(MAP, parseAddr, esc);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.__BPG = {
    parseAddr: parseAddr,
    parseWhere: parseWhere,
    esc: esc,
    toast: toast,
    answer: answer,
    provenance: provenance,
    SRC: SRC,
    hashId: hashId,
    getShareableLink: getShareableLink,
    itinerary: itinerary,
    buildIcs: buildIcs,
    exportIcs: exportIcs,
    icsFold: icsFold,
    utf8Len: utf8Len,
    stars: starred,
    saveStars: saveStars,
    render: render,
    renderPicks: renderPicks,
    syncStarButtons: syncStarButtons,
    isStandalone: isStandalone,
    isIOS: isIOS,
    initInstall: initInstall,
    getProfile: getProfile,
    saveProfile: saveProfile,
    renderGreet: renderGreet,
    campSuggest: campSuggest,
    resolveCamp: resolveCamp,
    calcRoute: calcRoute,
    nearestPotty: nearestPotty,
    applyHashMode: applyHashMode,
    syncTabBar: syncTabBar,
    showUpdateToast: showUpdateToast,
    initSwUpdate: initSwUpdate
  };
  window.parseWhere = parseWhere;
  window.answer = answer;
})();
