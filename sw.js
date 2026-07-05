/* ============================================================
   Kütüphane Service Worker — TEK GÖREV, TAM GEÇİRGEN.
   Yalnız "?m=<id>" içeren SAYFA NAVİGASYONLARINI yakalar ve
   kütüphane sayfasının Cache Storage'a koyduğu medya HTML'ini döner.
   BAŞKA HİÇBİR İSTEĞE DOKUNMAZ (respondWith çağrılmaz → tarayıcı
   native davranır): index.html, manifest.json, manifests/*,
   Cloudflare worker istekleri, güncelleme HEAD'i, PWA akışı,
   Range/ses — hepsi bugünkü gibi ağdan/native akar.
   GÜVENLİK AĞI: cache'te yoksa fetch(index) → kütüphane açılır,
   ?m= parametresini görüp BLOB yoluyla açar → kırık link imkansız.
   Geri dönüş düğmesi: tarayıcıda SW kaydını sil → her şey bugünkü hale döner.
   ============================================================ */
'use strict';
const MEDIA_CACHE = 'lib_media_sw_v1';

self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;          // her şey geçirgen
  if (e.request.mode !== 'navigate') return;       // yalnız sayfa navigasyonu
  var u;
  try { u = new URL(e.request.url); } catch (err) { return; }
  if (!u.searchParams.has('m')) return;            // yalnız medya adresi
  e.respondWith(
    caches.open(MEDIA_CACHE)
      .then(function (c) { return c.match(e.request.url); })
      .then(function (r) { return r || fetch(e.request); }) // cache yoksa → kütüphane (blob fallback zinciri)
      .catch(function () { return fetch(e.request); })
  );
});
