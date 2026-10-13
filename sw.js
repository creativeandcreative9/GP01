// オフライン対応: ネットワーク優先、失敗時にキャッシュ
const CACHE = "morse-v5";
const FILES = ["./", "index.html", "style.css", "app.js", "morse.js", "muse.js", "flow.js", "manifest.json", "icons/icon.svg"];
self.addEventListener("install", (e) => {
  self.skipWaiting(); // 新版を待たせず即有効化
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => e.respondWith(
  fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request))));
