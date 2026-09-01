/* Self-contained GPS -> playa address for pages that do not load guide.js
 * (friends.html). Mirrors guide.js latLonToAddr; the 2026 geometry constants
 * are duplicated deliberately so this file has zero dependencies. MIT. */
(function(){
  'use strict';
  if (window.__bpgGps) return; /* guide.js already provides it */
  var MAN = [40.783247448, -119.207884096], FLAT = 364000, FLON = 275615.7313;
  var RINGS = [["ESP",2492.7],["A",2926],["B",3205.4],["C",3484.6],["D",3763.8],["E",4048],["F",4531.7],["G",4810.9],["H",5090.1],["I",5369.5],["J",5549.1],["K",5738.5]];
  function latLonToAddr(lat, lon){
    var cy = (MAN[0] - lat) * FLAT;
    var cx = (lon - MAN[1]) * FLON;
    var r = Math.hypot(cx, cy);
    if (r > 9000) return null;
    var compass = Math.atan2(cx, -cy) * 180 / Math.PI;
    var clock = ((compass / 30) + 10.5) % 12;
    if (clock < 0) clock += 12;
    var q = Math.round(clock * 4) / 4;
    if (q === 0) q = 12;
    var hh = Math.floor(q);
    var mmMap = { 0: '00', 0.25: '15', 0.5: '30', 0.75: '45' };
    var addrClock = hh + ':' + mmMap[q - hh];
    var best = null, bestDiff = 1e9;
    for (var i = 0; i < RINGS.length; i++){
      var diff = Math.abs(r - RINGS[i][1]);
      if (diff < bestDiff){ bestDiff = diff; best = RINGS[i][0]; }
    }
    if (r < 2100 || q < 2 || q > 10) return addrClock + ' & open playa';
    return addrClock + ' & ' + (best === 'ESP' ? 'Esplanade' : best);
  }
  function gpsLocate(cb){
    if (!navigator.geolocation){ cb(null, 'This phone has no GPS access in the browser.'); return; }
    navigator.geolocation.getCurrentPosition(function(pos){
      var addr = latLonToAddr(pos.coords.latitude, pos.coords.longitude);
      if (!addr){ cb(null, 'GPS fix is outside Black Rock City.', pos); return; }
      cb(addr, null, pos);
    }, function(err){
      cb(null, err && err.code === 1 ? 'Location permission denied. Allow it in your browser settings.' : 'No GPS fix yet. Step away from metal and try again.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }
  window.__bpgGps = gpsLocate;
  window.__bpgLatLonToAddr = latLonToAddr;
})();
