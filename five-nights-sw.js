/* Five Nights at Monkes - offline copy for home-screen play (iPad / iPhone / Android).
   Registered by five-nights-at-monkes.html with scope "five-nights-at-monkes", so it only ever
   handles that one game's page; the rest of the arcade is untouched.
   Online: always fetches fresh files (and refreshes the saved copy). Offline: uses the saved copy. */
const CACHE = 'fnam-v1';
const CORE = ['five-nights-at-monkes.html', 'sfx/five-nights-at-monkes-sfx.m4a', 'glitchbox-config.js',
  'glitchbox-save.js', 'glitchbox-menu.js', 'thumbs/five-nights-at-monkes-icon.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('fnam-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  const fonts = /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (u.origin !== self.location.origin && !fonts) return;          // the arcade API and rooms go straight to the network
  e.respondWith(fetch(req).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit ||
    (req.mode === 'navigate' ? caches.match('five-nights-at-monkes.html', { ignoreSearch: true }) : Response.error()))));
});
