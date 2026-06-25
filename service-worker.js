// Mỗi lần update app, tăng số version này
const CACHE_NAME = 'vsp-cc-cache-v51';

const urlsToCache = [
  './',
  './index.html',
  './manifest.json'
];

// Cài service worker mới
self.addEventListener('install', event => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

// Kích hoạt và xóa cache cũ
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Network-first: có mạng lấy bản mới, mất mạng dùng cache
self.addEventListener('fetch', event => {
  const reqUrl = event.request.url;

  // Không cache API Google Script
  if (
    reqUrl.includes('script.google.com') ||
    reqUrl.includes('script.googleusercontent.com')
  ) {
    return;
  }

  // Chỉ xử lý GET
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          networkResponse.type === 'basic'
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }

        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then(cachedResponse => {
          // Nếu là request mở trang mà không có cache riêng, trả về index
          return cachedResponse || caches.match('./index.html');
        });
      })
  );
});