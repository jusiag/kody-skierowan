/* Service worker: aplikacja otwiera się także bez internetu.
 * Pliki strony: najpierw sieć, a gdy jej brak, kopia z urządzenia.
 * Słowniki (folder data/: icd9.json, icd10.json) obsługuje sama strona (Cache API), więc tutaj ich nie przechwytujemy. */
const SHELL = "icd9-shell"; /* nazwa zostaje, żeby nie kasować kopii u lekarzy */
const FILES = ["./", "index.html", "app.js", "search.js", "resort.js", "theme.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(FILES)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/data/")) return;

  event.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined))
      )
  );
});
