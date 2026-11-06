/* ============================================================
   Kütüphane Service Worker — İKİ GÖREV, BAŞKA HİÇBİR ŞEY.
   1) MEDYA (__SW_MODE__, DEĞİŞMEDİ): "?m=<id>" içeren SAYFA GEZİNMELERİ, kütüphane
      sayfasının Cache Storage'a koyduğu medya HTML'inden döner (lib_media_sw_v1).
      Önbellekte yoksa → kütüphane sayfası açılır, ?m= parametresini görüp BLOB yoluyla
      açar → kırık link imkânsız.
   2) ÇEVRİMDIŞI KABUK (__OFFLINE_SHELL__ v1, 2026-11-06): kütüphane sayfasının KENDİSİ
      (./ ve ./index.html — sorgu dizgesi ne olursa olsun: ?t= ?_v= ?m= ıskası) AĞ-ÖNCE:
        · internet varken sayfa HER ZAMAN ağdan gelir (bugünkü gibi — eski sürümde takılma
          yok) ve kopyası cihaza yazılır; sürüm (ETag / Last-Modified) aynıysa yazılmaz
        · ağ hatası ya da sunucu 5xx → son kopya
        · 4 sn içinde yanıt yoksa ("Wi-Fi var, internet yok") → son kopya; ağ yanıtı sonradan
          gelirse kopya arkada tazelenir
          ZAMAN AŞIMI YOK: kopya hiç yoksa (ilk ziyaret) ve "Yenile" (?_v=) — taze sürüm beklenir
        · 4xx olduğu gibi döner (bugünkü gibi — yanlış yükleme gizlenmez)
        · kopya kurulumda hemen alınır → ilk internetli açılıştan sonra çevrimdışı da açılır
   BAŞKA HİÇBİR İSTEĞE DOKUNMAZ (respondWith çağrılmaz → tarayıcı native davranır):
   manifest.json, ikonlar, manifests/*, Cloudflare worker istekleri, güncelleme HEAD'i,
   kapsamdaki BAŞKA HTML dosyaları, Range/ses — hepsi bugünkü gibi ağdan/native akar.
   GÜVENLİK AĞI: kabuk yolunda herhangi bir iç hata → düz ağ isteği (bugünkü davranış).
   GERİ DÖNÜŞ: eski sw.js'i yüklemek yeter — SW kendi güncellemesini engelleyemez, cihazlar
   ilk internetli açılışta alır. Kopya (lib_shell_v1, ~0,8 MB) o durumda kullanılmadan kalır.
   ============================================================ */
'use strict';
const MEDIA_CACHE = 'lib_media_sw_v1';
const SHELL_CACHE = 'lib_shell_v1';
const SHELL_WAIT = 4000;       /* ms — ağ bu sürede yanıt vermezse son kopya */
const PRECACHE_WAIT = 15000;   /* ms — kurulumdaki ön-kopya kurulumu bundan uzun bekletmez */

function bekle(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function kabukAnahtari() { return self.registration.scope; }   /* kanonik adres: ./ */
function kabukGezinmesi(u) {
  var s = new URL(self.registration.scope);
  return u.origin === s.origin && (u.pathname === s.pathname || u.pathname === s.pathname + 'index.html');
}
function iyiKabuk(r) {
  if (!r || r.status !== 200 || r.type !== 'basic') return false;
  return (r.headers.get('content-type') || '').indexOf('text/html') >= 0;
}
function ayniSurum(a, b) {
  var ea = a.headers.get('etag'), eb = b.headers.get('etag');
  if (ea && eb) return ea === eb;
  var la = a.headers.get('last-modified'), lb = b.headers.get('last-modified');
  if (la && lb) return la === lb;
  return false;   /* bilinmiyorsa yaz (güvenli taraf) */
}
/* Kopyayı yaz: yalnız sağlam 200 HTML; yönlendirme izi taşımayan TEMİZ yanıt olarak
   (tarayıcılar "redirected" yanıtı gezinmede reddeder). */
function kabukYaz(r) {
  if (!iyiKabuk(r)) return Promise.resolve();
  return caches.open(SHELL_CACHE).then(function (c) {
    return c.match(kabukAnahtari()).then(function (eski) {
      if (eski && ayniSurum(eski, r)) return;
      return r.blob().then(function (b) {
        var h = new Headers();
        ['content-type', 'etag', 'last-modified'].forEach(function (n) { var v = r.headers.get(n); if (v) h.set(n, v); });
        h.set('x-kabuk-yazildi', new Date().toUTCString());
        return c.put(kabukAnahtari(), new Response(b, { status: 200, statusText: 'OK', headers: h }));
      });
    });
  });
}
function kabukKopyasi() {
  return caches.open(SHELL_CACHE)
    .then(function (c) { return c.match(kabukAnahtari()); })
    .catch(function () { return undefined; });
}
/* AĞ-ÖNCE kütüphane sayfası */
function kabukGezin(e, u) {
  var req = e.request, yazim = null;
  var ag = Promise.resolve().then(function () { return fetch(req); }).then(function (r) {
    if (iyiKabuk(r)) yazim = kabukYaz(r.clone()).catch(function () {});
    return r;
  });
  /* ağ yanıtı zaman aşımından SONRA gelse de kopya tazelensin → SW o ana kadar ayakta kalır */
  try { e.waitUntil(ag.then(function () { return yazim; }, function () {})); } catch (err) {}
  return kabukKopyasi().then(function (kopya) {
    if (!kopya) return ag;                                   /* ilk ziyaret: yalnız ağ (bugünkü gibi) */
    var agYaDaKopya = ag.then(function (r) { return (r && r.status >= 500) ? kopya : r; },
                              function () { return kopya; });
    if (u.searchParams.has('_v')) return agYaDaKopya;        /* "Yenile": taze sürüm beklenir */
    return Promise.race([agYaDaKopya, bekle(SHELL_WAIT).then(function () { return kopya; })]);
  }).catch(function () { return fetch(req); });             /* son çare: düz ağ (bugünkü) */
}

self.addEventListener('install', function (e) {
  self.skipWaiting();
  /* ön-kopya — en iyi çaba: başarısız olursa kurulum DURMAZ, kopya ilk başarılı gezinmede alınır */
  e.waitUntil(Promise.race([
    fetch(new Request(kabukAnahtari(), { cache: 'reload' })).then(kabukYaz).catch(function () {}),
    bekle(PRECACHE_WAIT)
  ]));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k.indexOf('lib_shell_') === 0 && k !== SHELL_CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).catch(function () {}).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;          // her şey geçirgen
  if (e.request.mode !== 'navigate') return;       // yalnız sayfa gezinmesi
  var u;
  try { u = new URL(e.request.url); } catch (err) { return; }
  if (u.searchParams.has('m')) {                   // 1) MEDYA — eski mantık; ıskada kütüphane sayfası
    e.respondWith(
      caches.open(MEDIA_CACHE)
        .then(function (c) { return c.match(e.request.url); })
        .then(function (r) { return r || (kabukGezinmesi(u) ? kabukGezin(e, u) : fetch(e.request)); })
        .catch(function () { return fetch(e.request); })
    );
    return;
  }
  if (!kabukGezinmesi(u)) return;                  // kapsamdaki başka sayfa → dokunma (bugünkü gibi)
  e.respondWith(kabukGezin(e, u));                 // 2) KÜTÜPHANE SAYFASI — ağ-önce + çevrimdışı kopya
});
