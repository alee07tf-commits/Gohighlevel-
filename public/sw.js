// LeadFlow service worker.
// Strategy: pre-cache the app shell; cache-first for static assets with
// background refresh; network-only for API calls (never cache business data)
// with a friendly offline fallback page for navigations.
const VERSION = 'leadflow-v3';
const SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/ui.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const OFFLINE_PAGE = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión — LeadFlow</title>
<style>body{font-family:system-ui;background:#111827;color:#e5e7eb;display:flex;align-items:center;justify-content:center;
min-height:100vh;margin:0;text-align:center}div{max-width:320px}h1{font-size:44px;margin:0}</style></head>
<body><div><h1>⚡</h1><h2>Sin conexión</h2><p>LeadFlow necesita internet para cargar tus datos.
Reintentaremos automáticamente cuando vuelva la conexión.</p></div>
<script>addEventListener('online',()=>location.reload())</script></body></html>`;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  // API and public dynamic pages: network only (fresh data), offline fallback for navigations.
  const dynamic = ['/api/', '/f/', '/book/', '/pay/', '/review/', '/r/'].some((p) => url.pathname.startsWith(p));
  if (dynamic) {
    if (event.request.mode === 'navigate') {
      event.respondWith(
        fetch(event.request).catch(() => new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html' } }))
      );
    }
    return;
  }

  // App shell + static assets: NETWORK-FIRST so deploys are picked up
  // immediately; fall back to cache only when offline. (Cache-first was
  // serving stale JS/CSS after each redeploy.)
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request).then(
          (cached) =>
            cached ||
            (event.request.mode === 'navigate'
              ? new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html' } })
              : Response.error())
        )
      )
  );
});
