/* GuitarCoach service worker: offline app shell + cached static assets.
   Song data lives in IndexedDB, so it is available offline regardless.
   Link import (/api/*) always needs the network and is never cached. */
const VERSION = "gc-v2";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const ROUTES = ["/", "/songs", "/add", "/song", "/studio", "/tuner", "/calibrate", "/align", "/report", "/progress", "/settings"];
const EXTRA = ["/manifest.webmanifest", "/worklets/capture-processor.js", "/icons/icon.svg", "/icons/icon-192.png", "/vendor/pdf.worker.min.mjs"];

async function precache() {
  const shell = await caches.open(SHELL);
  const assets = await caches.open(ASSETS);
  const statics = new Set();
  for (const route of ROUTES) {
    try {
      const res = await fetch(route, { cache: "no-store" });
      if (!res.ok) continue;
      await shell.put(route, res.clone());
      const html = await res.text();
      for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) statics.add(m[1]);
    } catch {
      /* offline during install: cached later at runtime */
    }
  }
  await Promise.all([...statics, ...EXTRA].map((u) => assets.add(u).catch(() => undefined)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    // Network first so updates arrive; fall back to the cached page shell offline.
    event.respondWith(
      (async () => {
        try {
          const res = await Promise.race([fetch(req), timeout(4000)]);
          if (res.ok && ROUTES.includes(url.pathname)) (await caches.open(SHELL)).put(url.pathname, res.clone());
          return res;
        } catch {
          const cached = (await caches.match(url.pathname, { ignoreSearch: true })) || (await caches.match("/"));
          return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })(),
    );
    return;
  }

  const immutable = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/vendor/") || url.pathname.startsWith("/icons/");
  if (immutable || url.pathname.startsWith("/worklets/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const hit = await cache.match(req);
        if (hit && immutable) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return hit || Response.error();
        }
      })(),
    );
  }
});
