// ══════════════════════════════════════════════════════════
// Service Worker — Aman Walia Assistant
// Strategy: NETWORK-FIRST for the app shell (always fresh),
// cache only as an offline fallback. This fixes the stale-cache
// problem where updates didn't appear until manual cache clear.
// ══════════════════════════════════════════════════════════

const CACHE = "awa-cache-v2";           // bump this string to force a full refresh
const OFFLINE_URLS = ["/", "/index.html"];

// Install: pre-cache the shell, activate immediately
self.addEventListener("install", (e) => {
  self.skipWaiting();                    // new SW takes over right away
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(OFFLINE_URLS).catch(() => {}))
  );
});

// Activate: delete old caches, take control of open pages
self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// Fetch: NETWORK-FIRST for navigations & the HTML/JS shell.
self.addEventListener("fetch", (e) => {
  const req = e.request;

  // Only handle GET requests from our own origin.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // let Firebase/IndiaMart/etc pass through untouched

  // Network-first: try the live server, fall back to cache if offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        // Save a fresh copy for offline use
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match("/index.html"))
      )
  );
});

// Allow the page to tell the SW to update immediately
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});
