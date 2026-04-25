const CACHE_NAME = 'vsp-cc-cache-v16';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json'
];

// Cài đặt và lưu giao diện vào máy
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// Trả về giao diện từ máy khi mất mạng thay vì báo lỗi
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});