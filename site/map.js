/* Interactive BRC map — inline SVG from Burning Man's 2026 GIS. No tiles, works offline. MIT. */
window.initMap = function(MAP, parseAddr, esc){
  var box = document.getElementById('mapbox');
  if (!box || !MAP.streets) return;
  var MAN = MAP.man, FLAT = MAP.flat, FLON = MAP.flon;
  // world extent in feet from the Man
  var R = 6600, VB = [-R, -R, R*2, R*2];
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
  (MAP.landmarks||[]).forEach(function(l){
    g.appendChild(el('circle', { cx:l.c[0], cy:l.c[1], r:70, fill:'#d8a54b' }));
    var t = el('text', { x:l.c[0], y:l.c[1]-120, 'text-anchor':'middle',
      'font-size':170, fill:'#3a2b28', 'font-family':'Montserrat,sans-serif' });
    t.textContent = l.n.replace(/\s*\(.*\)/,'');
    g.appendChild(t);
  });
  // you
  var you = el('circle', { cx:0, cy:0, r:0, fill:'#6d0813', stroke:'#fff3e5', 'stroke-width':40 });
  g.appendChild(you);
  box.appendChild(svg);

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

  /* pan + zoom */
  var vb = VB.slice(), drag = null;
  function apply(){ svg.setAttribute('viewBox', vb.join(' ')); }
  function pt(e){ var t = e.touches ? e.touches[0] : e; return { x:t.clientX, y:t.clientY }; }
  svg.addEventListener('pointerdown', function(e){ drag = pt(e); svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', function(e){
    if (!drag) return;
    var p = pt(e), rect = box.getBoundingClientRect();
    vb[0] -= (p.x - drag.x) * vb[2] / rect.width;
    vb[1] -= (p.y - drag.y) * vb[3] / rect.height;
    drag = p; apply();
  });
  ['pointerup','pointercancel','pointerleave'].forEach(function(ev){
    svg.addEventListener(ev, function(){ drag = null; });
  });
  svg.addEventListener('wheel', function(e){
    e.preventDefault();
    var k = e.deltaY > 0 ? 1.12 : 0.89;
    var cx = vb[0] + vb[2]/2, cy = vb[1] + vb[3]/2;
    vb[2] *= k; vb[3] *= k;
    vb[0] = cx - vb[2]/2; vb[1] = cy - vb[3]/2;
    apply();
  }, { passive:false });
};
