/* Calling screen offline cache. Scope: /staff-dashboard only (see server.js).
 * Network first for everything; the cache is used only when the network fails,
 * so staff always get the latest code when online. API calls are never cached:
 * the screen keeps its own queue of offline calls and outcomes. */
'use strict';
var CACHE = 'makaug-calling-v1';
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('makaug-calling-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.indexOf('/api/') === 0) return;
  var page = req.mode === 'navigate';
  var asset = /^\/assets\/.+\.(js|css|woff2?|png|svg|ico)$/.test(url.pathname);
  if (!page && !asset) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(page ? '/staff-dashboard' : req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(page ? '/staff-dashboard' : req).then(function (hit) { return hit || new Response('Offline', { status: 503, statusText: 'Offline' }); });
  }));
});
