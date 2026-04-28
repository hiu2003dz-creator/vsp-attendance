// Nâng version lên v21 để ép điện thoại nạp quy tắc mới
const CACHE_NAME = 'vsp-cc-cache-v26'; 
const urlsToCache = [
  './',
  './index.html',
  './manifest.json'
];

// Cài đặt và dọn rác bản cũ
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting(); // Ép bản mới chiếm quyền ngay lập tức
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) return caches.delete(cache); // Xóa sạch các v19, v20 cũ đi
        })
      );
    })
  );
  self.clients.claim();
});

// CHIẾN LƯỢC MỚI: NETWORK-FIRST (Ưu tiên lấy code mới trên mạng)
self.addEventListener('fetch', event => {
  // Bỏ qua các request gọi API của Google
  if (event.request.url.includes('script.google.com') || event.request.url.includes('script.googleusercontent.com')) return;

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // Nếu có mạng và lấy được file mới -> Cất bản copy vào kho rồi mới trả về màn hình
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          let responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() => {
        // NẾU MẤT MẠNG -> Lúc này mới được phép lôi bản cũ trong kho ra dùng
        return caches.match(event.request);
      })
  );
});