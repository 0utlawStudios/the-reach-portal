// Ten80Ten SMM service worker.
//
// History:
// v2 (prior): intercepted EVERY GET including HTML navigation, and on network
// failure could return `undefined` from caches.match(), which Chrome treats as
// a navigation failure and shows "This page couldn't load". This bit users
// during the deploy swap window of cf20bbd on 2026-05-13.
//
// v3 (this version): four hardening changes.
//   1. Skip HTML page navigation entirely. The browser handles it directly,
//      no SW interception. Eliminates the deploy-swap race.
//   2. Skip /api/* — API calls always hit the network so auth + RLS + rate
//      limits get evaluated server-side every time.
//   3. The fetch catch ALWAYS returns a valid Response object. Never undefined.
//   4. Stable cache name `ten80ten-smm-v3`. Old `ten80ten-smm-v${Date.now()}`
//      caches get garbage-collected by the activate handler.

const CACHE_NAME = "ten80ten-smm-v3";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);

  // Bypass conditions — let the browser handle these natively.
  if (
    url.pathname === "/sw.js" ||
    url.pathname.startsWith("/_next/") ||
    url.pathname.startsWith("/api/") ||
    e.request.mode === "navigate"
  ) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(e.request, clone))
            .catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(e.request);
        // Must never return undefined — that becomes a navigation failure.
        return (
          cached ||
          new Response("", {
            status: 504,
            statusText: "Offline",
            headers: { "Content-Type": "text/plain" },
          })
        );
      }),
  );
});
