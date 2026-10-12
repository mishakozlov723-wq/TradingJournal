// SYTER service worker.
// Only makes the site installable as an app. It caches nothing: every request
// goes to the network, so each `firebase deploy` reaches users right away.
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(e) {
  if (e.request.mode !== 'navigate') return; // everything else: browser default
  e.respondWith(fetch(e.request).catch(function() {
    return new Response('<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SYTER</title></head>' +
      '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#91a0b7;font:600 15px system-ui,sans-serif;text-align:center">' +
      '<div>No internet connection<br><span style="opacity:.6;font-weight:400">The journal will open when you are back online.</span><br><br>' +
      '<button onclick="location.reload()" style="background:#0d0f14;color:#fff;border:1px solid #2a2f3a;border-radius:10px;padding:9px 18px;font:inherit;cursor:pointer">Retry</button></div></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }));
});
