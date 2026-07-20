const CACHE_NAME = "workout-plan-2-v2";
const BASE = new URL(".", self.location).href;
const ASSET_PATHS = [
  "index.html",
  "manifest.webmanifest",
  "css/styles.css",
  "js/app.js",
  "js/exercises.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "assets/exercises/goblet-squat.png",
  "assets/exercises/floor-press.png",
  "assets/exercises/overhead-press.png",
  "assets/exercises/reverse-lunge.png",
  "assets/exercises/farmer-carry.png",
  "assets/exercises/one-arm-row.png",
  "assets/exercises/chest-supported-row.png",
  "assets/exercises/romanian-deadlift.png",
  "assets/exercises/hammer-curl.png",
  "assets/exercises/tricep-extension.png"
];
const ASSETS = ASSET_PATHS.map((path) => new URL(path, BASE).href);
const OFFLINE_URL = new URL("index.html", BASE).href;

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).catch(() => {
        if (event.request.mode === "navigate") return caches.match(OFFLINE_URL);
        return caches.match(event.request);
      });
    })
  );
});
