/* Service worker: caches everything so the guide works with no signal. MIT. */
var CACHE = 'bpg-v117';
var FALLBACK = '/guide/';
var ASSETS = ['/guide/','/guide','/guide/map','/guide/how-it-was-made','/guide/submit','/guide/offline','/guide/friends','/guide/friends.js',
  '/guide/geo.js',
  '/guide/guide.css','/guide/guide.js','/guide/map.js',
  '/guide/data.js','/guide/manifest.webmanifest'];
var CORE = ['/guide/','/guide/guide.css','/guide/guide.js','/guide/data.js'];
self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      // core assets are all-or-nothing: a failed install keeps the old cache
      // alive (activate never runs), so a flaky playa connection can never
      // strand a phone with a shell but no data.
      return Promise.all(CORE.map(function(u){ return c.add(u); })).then(function(){
        return Promise.all(ASSETS.map(function(u){
          return CORE.indexOf(u) !== -1 ? null : c.add(u).catch(function(){});
        }));
      });
    })
  );
});
self.addEventListener('message', function(e){
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.filter(function(k){ return k !== CACHE; })
      .map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e){
  if (e.request.method !== 'GET') return;
  var u = new URL(e.request.url);
  if (u.pathname.indexOf('/api/') === 0) return;   // never cache API responses (private exports, live stats)
  if (u.pathname === '/guide/version.json') return; // freshness marker must always hit the network
  e.respondWith(
    caches.match(e.request).then(function(hit){
      var net = fetch(e.request).then(function(res){
        if (res && res.status === 200 && res.type === 'basic'){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
        }
        return res;
      }).catch(function(){ return null; });
      if (hit) return hit;                    // offline-first: cached wins for this load
      return net.then(function(r){ return r || caches.match(FALLBACK); });
    })
  );
});
