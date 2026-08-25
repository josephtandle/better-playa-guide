/* Better Playa Guide: all client-side, no network at runtime. MIT. */
(function(){
  'use strict';
  var D = window.__GUIDE__ || {};
  var EV = (D.ev && D.ev.e) || [], MAP = D.map || {}, PICKS = D.picks || [], PIN = D.pinned || null;
  var RING = {}; ((D.ev && D.ev.rings) || []).forEach(function(r){ RING[r[0]] = r[1]; });
  var MAN = (D.ev && D.ev.man) || [0,0], FLAT = (D.ev && D.ev.flat) || 364000, FLON = (D.ev && D.ev.flon) || 275000;
  var $ = function(id){ return document.getElementById(id); };
  var TAGS = ['workshop','talk','party','music','food','drink','adult','wellness','art','ritual','game'];
  var active = new Set(), shown = 60, here = null, speed = 12;

  /* ---- BRC address → lat/lon. bearing = ((clock-10.5)*30) mod 360 ---- */
  function parseAddr(s){
    if (!s) return null;
    var m = /(\d{1,2}):(\d{2})\s*(?:&|and|@|,)?\s*(ESP|Esplanade|[A-Ka-k])\b/i.exec(s);
    if (!m) return null;
    var st = m[3].toUpperCase();
    if (st.charAt(0) === 'E' && st.length > 1) st = 'ESP';
    var r = RING[st];
    if (r === undefined) return null;
    var clock = (+m[1]) + (+m[2]) / 60;
    var b = ((clock - 10.5) * 30) * Math.PI / 180;
    return { lat: MAN[0] + (r*Math.cos(b))/FLAT, lon: MAN[1] + (r*Math.sin(b))/FLON };
  }
  function minsTo(addr){
    var p = here, q = parseAddr(addr);
    if (!p || !q) return null;
    var dn = (q.lat-p.lat)*FLAT, de = (q.lon-p.lon)*FLON;
    return Math.round(Math.hypot(dn, de) / speed / 60);
  }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  /* ---- preferences: local only ---- */
  var PREF = 'bpg.prefs';
  function loadPrefs(){
    try {
      var p = JSON.parse(localStorage.getItem(PREF) || '{}');
      if (p.loc && $('loc')) $('loc').value = p.loc;
      if (p.mode && $('mode')) $('mode').value = p.mode;
      if (p.tags) p.tags.forEach(function(t){ active.add(t); });
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

  function toast(msg){
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on');
    setTimeout(function(){ t.classList.remove('on'); }, 2200);
  }

  /* ---- share ---- */
  var URL_ = 'https://musecafe.vip/guide/';
  var SHARE_TEXT = 'Better Playa Guide: every Burning Man 2026 event, searchable by where you\'re standing. Works with no signal. A gift from Muse Cafe.';
  function wireShare(){
    var s = $('share'), c = $('copylink');
    if (s) s.addEventListener('click', function(){
      if (navigator.share) {
        navigator.share({ title:'Better Playa Guide', text:SHARE_TEXT, url:URL_ }).catch(function(){});
      } else { copy(); }
    });
    if (c) c.addEventListener('click', copy);
    function copy(){
      var txt = SHARE_TEXT + ' ' + URL_;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(
        function(){ toast('Link copied: paste it in your camp chat'); },
        function(){ toast(URL_); });
      else toast(URL_);
    }
  }

  /* ---- render ---- */
  function card(o){
    var near = o.d !== null && o.d !== undefined && o.d <= 8;
    var cls = o.pin ? 'pin' : (near ? 'near' : '');
    var dist = (o.d === null || o.d === undefined)
      ? (o.a ? '' : ' · location unknown')
      : ' · ' + o.d + ' min';
    var badge = o.pin ? '<span class="tagline src">our camp</span>'
      : o.src === 1 ? '<span class="tagline src">camp site only</span>'
      : o.src === 2 ? '<span class="tagline src">from instagram</span>' : '';
    return '<li class="' + cls + '">'
      + '<div class="ti">' + esc(o.t) + badge + '</div>'
      + '<div class="meta">' + esc(o.w) + dist + ' · ' + esc(o.a || '?') + '</div>'
      + (o.p ? '<div class="who">' + esc(o.p) + '</div>' : '')
      + '<div class="de">' + esc(o.c) + (o.n ? ': ' + esc(o.n) : '') + '</div></li>';
  }

  function render(){
    if (!$('list')) return;
    var q = ($('q').value || '').trim().toLowerCase();
    var day = $('day').value, sort = $('sort').value;
    here = parseAddr($('loc').value);
    speed = +($('mode').value) || 12;
    var rows = [];
    for (var i = 0; i < EV.length; i++){
      var e = EV[i];
      if (active.size && !e.g.some(function(t){ return active.has(t); })) continue;
      if (q && (e.t + ' ' + e.c + ' ' + e.p + ' ' + e.d).toLowerCase().indexOf(q) === -1) continue;
      var slot = null;
      if (day){ for (var j=0;j<e.s.length;j++){ if (e.s[j][0].indexOf(day)===0){ slot=e.s[j]; break; } } }
      else slot = e.s[0];
      if (!slot) continue;
      rows.push({ t:e.t, c:e.c, a:e.a, p:e.p, n:e.d, src:e.src,
                  w: slot[0] + '–' + slot[1], key: slot[0], d: minsTo(e.a) });
    }
    if (sort === 'near' && here) rows.sort(function(a,b){
      return (a.d==null?999:a.d) - (b.d==null?999:b.d); });
    else rows.sort(function(a,b){ return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });

    // always surface our camp's Thursday cabaret
    var html = '';
    if (PIN && !q && (!day || day === '09-03')){
      var pin = { t:PIN.t, c:PIN.c, a:PIN.a, w:PIN.w, n:PIN.n, pin:true, d:minsTo(PIN.a) };
      html += card(pin);
    }
    $('count').textContent = rows.length + ' events'
      + (here ? ' · distances from ' + $('loc').value : ' · add your location for distances');
    html += rows.slice(0, shown).map(card).join('');
    $('list').innerHTML = html || '<li>Nothing matches. Clear a filter.</li>';
    var more = $('more');
    if (more) more.style.display = rows.length > shown ? '' : 'none';
    savePrefs();
  }

  function renderPicks(){
    if (!$('picklist')) return;
    $('picklist').innerHTML = PICKS.map(function(p){
      return card({ t:p.t, c:p.c, a:p.a, w:p.w, n:p.n, d:minsTo(p.a) });
    }).join('');
  }

  function init(){
    if ($('chips')){
      $('chips').innerHTML = TAGS.map(function(t){
        return '<button class="chip" data-t="' + t + '" aria-pressed="false">' + t + '</button>'; }).join('');
    }
    loadPrefs();
    if ($('chips')){
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
    ['q','loc','day','sort','mode'].forEach(function(id){
      var el = $(id); if (!el) return;
      el.addEventListener('input', function(){ shown = 60; render(); renderPicks(); });
      el.addEventListener('change', function(){ shown = 60; render(); renderPicks(); });
    });
    var m = $('more');
    if (m) m.addEventListener('click', function(){ shown += 60; render(); });
    wireShare();
    // mark current tab
    var path = location.pathname.replace(/\/$/,'');
    Array.prototype.forEach.call(document.querySelectorAll('nav.tabs a'), function(a){
      if (a.getAttribute('href').replace(/\/$/,'') === path) a.setAttribute('aria-current','page');
    });
    render(); renderPicks();
    if (window.initMap) window.initMap(MAP, parseAddr, esc);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.__BPG = { parseAddr: parseAddr, esc: esc, toast: toast };
})();
