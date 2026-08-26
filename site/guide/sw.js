/* Service worker: caches everything so the guide works with no signal. MIT. */
var CACHE = 'bpg-v45';
var FALLBACK = '/guide/';
var ASSETS = ['/guide/','/guide','/guide/map','/guide/how-it-was-made',
  '/guide/guide.css','/guide/guide.js','/guide/map.js',
  '/guide/data.js','/guide/manifest.webmanifest'];
self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      return Promise.all(ASSETS.map(function(u){
        return c.add(u).catch(function(){});   // a missing alias must not fail the whole install
      }));
    }).then(function(){
      return caches.open(CACHE).then(function(c){ return c.match(FALLBACK); });
    }).then(function(res){
      if (!res) {
        return Promise.reject(new Error('FALLBACK asset missing from cache'));
      }
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
