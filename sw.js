/* Service worker: permite instalar la app y abrirla aunque la red falle un momento.
   Estrategia: red primero, caché como respaldo (solo archivos del propio sitio). */
const CACHE = "ke-combustible-v7";
const SHELL = [
  "./", "./index.html", "./admin.html", "./conductor.html",
  "./css/styles.css", "./js/config.js", "./js/common.js", "./js/admin.js", "./js/conductor.js", "./js/ocr.js", "./js/biometria.js",
  "./manifest.webmanifest", "./assets/icon-192.png", "./assets/icon-512.png", "./assets/logo-kernel.png", "./assets/isotipo.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
