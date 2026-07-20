const CACHE_NAME = "workout-plan-2-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/app.js",
  "./js/exercises.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./assets/exercises/goblet-squat.png",
  "./assets/exercises/floor-press.png",
  "./assets/exercises/overhead-press.png",
  "./assets/exercises/reverse-lunge.png",
  "./assets/exercises/farmer-carry.png",
  "./assets/exercises/one-arm-row.png",
  "./assets/exercises/chest-supported-row.png",
  "./assets/exercises/romanian-deadlift.png",
  "./assets/exercises/hammer-curl.png",
  "./assets/exercises/tricep-extension.png"
];

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
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).catch(() => caches.match("./index.html"))));
});
