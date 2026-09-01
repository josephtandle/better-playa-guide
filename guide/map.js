/* Interactive BRC map: inline SVG from Burning Man's 2026 GIS. No tiles, works offline. MIT. */
window.initMap = function(MAP, parseAddr, esc, extras){
  extras = extras || {};
  var box = document.getElementById('mapbox');
  if (!box || !MAP.streets) return;
  var MAN = MAP.man, FLAT = MAP.flat, FLON = MAP.flon;
  // world extent in feet from the Man; fit to the real city so the drawing
  // fills the box instead of floating in dead margin
  var R = 6600, VB = [-R, -R, R*2, R*2];
  (function fitToCity(){
    var pts = [];
    (MAP.fence || []).forEach(function(p){ pts.push(p); });
    if (!pts.length) (MAP.streets || []).forEach(function(s){ s.p.forEach(function(p){ pts.push(p); }); });
    if (pts.length < 3) return;
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    pts.forEach(function(p){
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    });
    var pad = 350;
    var w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
    var side = Math.max(w, h);   /* keep the square aspect of the box */
    VB = [minX - pad - (side - w) / 2, minY - pad - (side - h) / 2, side, side];
  })();
  var NS = 'http://www.w3.org/2000/svg';
  function el(n, a){ var e = document.createElementNS(NS, n);
    for (var k in a) e.setAttribute(k, a[k]); return e; }

  var svg = el('svg', { viewBox: VB.join(' '), width:'100%', height:'100%' });
  var g = el('g', {});
  svg.appendChild(g);

  // trash fence
  if (MAP.fence && MAP.fence.length > 2){
    g.appendChild(el('polygon', { points: MAP.fence.map(function(p){ return p.join(','); }).join(' '),
      fill:'none', stroke:'#d8a54b', 'stroke-width':22, 'stroke-dasharray':'70 50', opacity:.55 }));
  }
  // streets
  MAP.streets.forEach(function(s){
    g.appendChild(el('polyline', { points: s.p.map(function(p){ return p.join(','); }).join(' '),
      fill:'none', stroke: s.k==='ann' ? '#6d0813' : '#3a2b28',
      'stroke-width': s.k==='ann' ? 16 : 10, opacity: s.k==='pat' ? .22 : .40,
      'stroke-linecap':'round' }));
  });
  // plazas
  (MAP.plazas||[]).forEach(function(p){
    g.appendChild(el('circle', { cx:p.c[0], cy:p.c[1], r:80, fill:'#f2b9b6', opacity:.55 }));
  });
  // landmarks
  /* Label declutter: at the default zoom only the majors get text, so the
     center-city cluster is dots, not an illegible clump. Zooming past 2x
     reveals the minor labels. */
  var MAJOR_NAMES = ['the man', 'the temple', 'center camp', 'airport', 'greeters', 'deep playa music zone'];
  function isMajor(name){
    var n = String(name).toLowerCase().replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
    /* exact match only: "Artica Center Camp" is NOT Center Camp */
    return MAJOR_NAMES.indexOf(n) !== -1;
  }
  var minorLabels = [];
  (MAP.landmarks||[]).forEach(function(l){
    g.appendChild(el('circle', { cx:l.c[0], cy:l.c[1], r:90, fill:'#d8a54b' }));
    var name = l.n.replace(/\s*\(.*\)/,'');
    var t = el('text', { x:l.c[0], y:l.c[1]-150, 'text-anchor':'middle',
      'font-size':280, 'font-weight':600, fill:'#3a2b28', 'font-family':'Montserrat,sans-serif' });
    t.textContent = name;
    if (!isMajor(name)) {
      t.setAttribute('display', 'none');
      minorLabels.push(t);
    }
    g.appendChild(t);
  });
  /* porta potties: blue dots from the official GIS toilet-bank centroids.
     Hidden until Potty mode so the base map stays clean. */
  function toXY(lat, lon){ return [(lon - MAN[1]) * FLON, -(lat - MAN[0]) * FLAT]; }
  var pottyG = el('g', { display: 'none' });
  (extras.toilets || []).forEach(function(c){
    var xy = toXY(c[0], c[1]);
    pottyG.appendChild(el('circle', { cx: xy[0], cy: xy[1], r: 130, fill: '#2563a8', stroke: '#fff3e5', 'stroke-width': 30 }));
  });
  g.appendChild(pottyG);

  /* recognizable anchors so you can orient: corner camps and majors, drawn in
     Potty mode. Greedy declutter: a label whose box would overlap an already
     placed one is dropped (dot stays). */
  var ANCHORS = [
    { n: 'Muse Cafe', a: '8:15 & E' },
    { n: 'Opulent Temple', a: '10:00 & Esplanade' },
    { n: '3 & G Plaza', a: '3:00 & G' },
    { n: '9 & G Plaza', a: '9:00 & G' },
    { n: '4:30 Plaza', a: '4:30 & G' },
    { n: '7:30 Plaza', a: '7:30 & G' },
    { n: 'Camp Mystic', a: '3:45 & C' },
    { n: 'PlayAlchemist', a: '9:00 & Esplanade' },
  ];
  var anchorG = el('g', { display: 'none' });
  var placedBoxes = [];
  ANCHORS.forEach(function(an){
    var pt = parseAddr(an.a);
    if (!pt) return;
    var xy = toXY(pt.lat, pt.lon);
    anchorG.appendChild(el('circle', { cx: xy[0], cy: xy[1], r: 70, fill: '#6d0813', opacity: .8 }));
    /* estimated label box: 165 units/char wide at font-size 300 */
    var wBox = an.n.length * 165, hBox = 340;
    var bx = { x: xy[0] - wBox / 2, y: xy[1] - 120 - hBox, w: wBox, h: hBox };
    var hit = placedBoxes.some(function(b){
      return bx.x < b.x + b.w && bx.x + bx.w > b.x && bx.y < b.y + b.h && bx.y + bx.h > b.y;
    });
    if (hit) return;
    placedBoxes.push(bx);
    var tt = el('text', { x: xy[0], y: xy[1] - 160, 'text-anchor': 'middle',
      'font-size': 300, 'font-weight': 700, fill: '#6d0813', stroke: '#fff3e5', 'stroke-width': 55,
      'paint-order': 'stroke', 'font-family': 'Montserrat,sans-serif' });
    tt.textContent = an.n;
    anchorG.appendChild(tt);
  });
  g.appendChild(anchorG);

  // you
  var you = el('circle', { cx:0, cy:0, r:0, fill:'#6d0813', stroke:'#fff3e5', 'stroke-width':40 });
  g.appendChild(you);
  box.appendChild(svg);

  var pottyOn = false;
  function setPotty(on){
    pottyOn = on;
    pottyG.setAttribute('display', on ? '' : 'none');
    anchorG.setAttribute('display', on ? '' : 'none');
    var pb = document.getElementById('map-potty-btn');
    if (pb) pb.classList.toggle('solid', on);
    if (on) zoomToYou();
  }
  function zoomToYou(){
    var cx = +you.getAttribute('cx') || 0, cy = +you.getAttribute('cy') || 0;
    if (+you.getAttribute('r') > 0){
      var side = 3600; /* ~0.7 mile square around you: your block + nearest banks */
      vb[0] = cx - side / 2; vb[1] = cy - side / 2; vb[2] = side; vb[3] = side;
      apply();
    }
  }
  function mapNote(msg){
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg; el.classList.add('on');
    setTimeout(function(){ el.classList.remove('on'); }, 3500);
  }
  function gpsToMap(){
    if (!extras.gps) return;
    extras.gps(function(addr, err, pos){
      if (addr && addr.indexOf('open playa') === -1){
        var li2 = document.getElementById('loc');
        if (li2){
          li2.value = addr;
          /* the 'input' dispatch runs place() synchronously, which snaps the
             dot to the street corner; the raw fix below then overwrites it,
             so the dot shows where you actually stand */
          try {
            li2.dispatchEvent(new Event('input', { bubbles: true }));
            li2.dispatchEvent(new Event('change', { bubbles: true }));
          } catch(e){}
        }
        mapNote('You are at ' + addr);
      } else if (addr){
        mapNote('You are in open playa (' + addr.replace(' & open playa', '') + ' side)');
      } else if (err){
        mapNote(err);
      }
      if (pos){
        you.setAttribute('cx', (pos.coords.longitude - MAN[1]) * FLON);
        you.setAttribute('cy', -(pos.coords.latitude - MAN[0]) * FLAT);
        you.setAttribute('r', 150);
      }
      if (pottyOn) zoomToYou();
    });
  }

  function place(){
    var v = document.getElementById('loc');
    var p = parseAddr(v ? v.value : '');
    if (!p){ you.setAttribute('r', 0); return; }
    you.setAttribute('cx', (p.lon - MAN[1]) * FLON);
    you.setAttribute('cy', -(p.lat - MAN[0]) * FLAT);
    you.setAttribute('r', 150);
  }
  var li = document.getElementById('loc');
  if (li){ li.addEventListener('input', place); place(); }
  var pbtn = document.getElementById('map-potty-btn');
  if (pbtn) pbtn.addEventListener('click', function(){
    if (!pottyOn && extras.gps && navigator.geolocation) gpsToMap();
    setPotty(!pottyOn);
  });
  var gbtn = document.getElementById('map-gps-btn');
  if (gbtn) gbtn.addEventListener('click', gpsToMap);

  /* pan + zoom: one-finger drag pans, two-finger pinch zooms, wheel zooms,
     +/- buttons zoom about the centre. Zoom clamped to 0.5x - 8x of the full
     city view so nobody gets lost in deep space or a single pixel of dust. */
  var vb = VB.slice();
  var ZOOM_MIN = 0.5, ZOOM_MAX = 8;
  var pointers = {}, pointerCount = 0, drag = null, pinchDist = null;
  function zoomLevel(){ return VB[2] / vb[2]; }
  function apply(){
    svg.setAttribute('viewBox', vb.join(' '));
    var showMinor = zoomLevel() >= 2;
    for (var mi = 0; mi < minorLabels.length; mi++) {
      minorLabels[mi].setAttribute('display', showMinor ? '' : 'none');
    }
  }
  function zoomAt(k, fx, fy){
    /* k > 1 zooms in. fx/fy: focus point as a 0..1 fraction of the box. */
    var newW = vb[2] / k;
    if (VB[2] / newW > ZOOM_MAX) newW = VB[2] / ZOOM_MAX;
    if (VB[2] / newW < ZOOM_MIN) newW = VB[2] / ZOOM_MIN;
    var realK = vb[2] / newW;
    var newH = vb[3] / realK;
    vb[0] += (vb[2] - newW) * fx;
    vb[1] += (vb[3] - newH) * fy;
    vb[2] = newW; vb[3] = newH;
    apply();
  }
  function frac(clientX, clientY){
    var rect = box.getBoundingClientRect();
    return {
      x: rect.width ? (clientX - rect.left) / rect.width : .5,
      y: rect.height ? (clientY - rect.top) / rect.height : .5
    };
  }
  function activePointers(){
    var out = [];
    for (var id in pointers) { if (pointers.hasOwnProperty(id)) out.push(pointers[id]); }
    return out;
  }
  svg.addEventListener('pointerdown', function(e){
    if (e.preventDefault) e.preventDefault();
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    pointerCount++;
    if (svg.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch(err){} }
    var pts = activePointers();
    if (pts.length === 2) {
      drag = null;
      pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    } else if (pts.length === 1) {
      drag = { x: e.clientX, y: e.clientY };
    }
  });
  svg.addEventListener('pointermove', function(e){
    if (!pointers[e.pointerId]) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var pts = activePointers();
    if (pts.length === 2 && pinchDist) {
      var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (d > 0) {
        var mid = frac((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
        zoomAt(d / pinchDist, mid.x, mid.y);
        pinchDist = d;
      }
      return;
    }
    if (!drag) return;
    var rect = box.getBoundingClientRect();
    vb[0] -= (e.clientX - drag.x) * vb[2] / rect.width;
    vb[1] -= (e.clientY - drag.y) * vb[3] / rect.height;
    drag = { x: e.clientX, y: e.clientY };
    apply();
  });
  function dropPointer(e){
    if (pointers[e.pointerId]) { delete pointers[e.pointerId]; pointerCount--; }
    var pts = activePointers();
    pinchDist = null;
    drag = pts.length === 1 ? { x: pts[0].x, y: pts[0].y } : null;
  }
  ['pointerup','pointercancel','pointerleave'].forEach(function(ev){
    svg.addEventListener(ev, dropPointer);
  });
  svg.addEventListener('wheel', function(e){
    e.preventDefault();
    var f = frac(e.clientX, e.clientY);
    zoomAt(e.deltaY > 0 ? 0.89 : 1.12, f.x, f.y);
  }, { passive:false });

  /* +/- buttons (44px targets), wired if the chrome provides them */
  var zin = document.getElementById('map-zoom-in');
  var zout = document.getElementById('map-zoom-out');
  if (zin) zin.addEventListener('click', function(){ zoomAt(1.4, .5, .5); });
  if (zout) zout.addEventListener('click', function(){ zoomAt(1/1.4, .5, .5); });

  function drawRoute(fromStr, toStr) {
    if (!fromStr || !toStr || !window.__BPG || !window.__BPG.calcRoute) return;
    var modeEl = document.getElementById('mode');
    var sp = +(modeEl ? modeEl.value : 12) || 12;
    var route = window.__BPG.calcRoute(fromStr, toStr, sp);
    if (!route || !route.points || route.points.length < 2) return;

    var oldRoute = svg.querySelectorAll('.route-path, .route-marker');
    for (var ri = 0; ri < oldRoute.length; ri++) {
      oldRoute[ri].parentNode.removeChild(oldRoute[ri]);
    }

    var svgPts = route.points.map(function(pt){
      var x = (pt.lon - MAN[1]) * FLON;
      var y = -(pt.lat - MAN[0]) * FLAT;
      return [x, y];
    });

    var polyline = el('polyline', {
      'class': 'route-path',
      points: svgPts.map(function(p){ return p.join(','); }).join(' '),
      fill: 'none',
      stroke: '#d8a54b',
      'stroke-width': 60,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      opacity: 0.9
    });
    g.appendChild(polyline);

    var startCircle = el('circle', {
      'class': 'route-marker',
      cx: svgPts[0][0], cy: svgPts[0][1],
      r: 120, fill: '#6d0813', stroke: '#fff3e5', 'stroke-width': 30
    });
    g.appendChild(startCircle);

    var endCircle = el('circle', {
      'class': 'route-marker',
      cx: svgPts[svgPts.length - 1][0], cy: svgPts[svgPts.length - 1][1],
      r: 120, fill: '#d8a54b', stroke: '#3a2b28', 'stroke-width': 30
    });
    g.appendChild(endCircle);

    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    svgPts.forEach(function(p){
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    });
    var pad = 400;
    var w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
    var side = Math.max(w, h, 2000);
    var newW = side, newH = side;
    if (VB[2] / newW > ZOOM_MAX) newW = VB[2] / ZOOM_MAX;
    if (VB[2] / newW < ZOOM_MIN) newW = VB[2] / ZOOM_MIN;
    var realK = VB[2] / newW;
    newH = VB[3] / realK;

    vb[0] = minX - pad - (side - (maxX - minX)) / 2;
    vb[1] = minY - pad - (side - (maxY - minY)) / 2;
    vb[2] = newW;
    vb[3] = newH;
    apply();
  }

  function checkNavHash() {
    var hash = (window.location && window.location.hash) || '';
    var m = /#nav=([^;]+);(.+)/.exec(hash);
    if (m) {
      try {
        var f = decodeURIComponent(m[1]);
        var t = decodeURIComponent(m[2]);
        drawRoute(f, t);
      } catch(e){}
    }
  }
  checkNavHash();
  window.addEventListener('hashchange', checkNavHash);

  /* #potty deep link (from the Find page's potty note): runs after vb/apply
     exist so the zoom-to-you actually works */
  if (/#potty/.test((window.location && window.location.hash) || '')){
    setPotty(true);
    if (extras.gps && navigator.geolocation) gpsToMap();
  }

  /* test surface */
  window.__BPG_MAP = { zoomAt: zoomAt, zoomLevel: zoomLevel, getViewBox: function(){ return vb.slice(); }, drawRoute: drawRoute, setPotty: setPotty, pottyCount: function(){ return pottyG.childNodes.length; }, anchorLabels: function(){ var out=[]; anchorG.querySelectorAll('text').forEach(function(n){ out.push(n.textContent); }); return out; } };
};
