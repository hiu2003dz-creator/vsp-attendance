// Mỗi lần cập nhật ứng dụng, tăng số phiên bản này.
const CACHE_NAME = "vsp-cc-cache-v58";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );

  // Cho phép worker mới chuyển sang trạng thái kích hoạt ngay.
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      ))
      .then(() => self.clients.claim())
  );
});

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Network timeout")), timeoutMs);

    fetch(request)
      .then(response => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const requestUrl = request.url;

  // API Apps Script luôn đi thẳng ra mạng, không lưu cache.
  if (
    requestUrl.includes("script.google.com") ||
    requestUrl.includes("script.googleusercontent.com")
  ) {
    return;
  }

  if (request.method !== "GET") return;

  event.respondWith((async () => {
    try {
      // Trang điều hướng luôn kiểm tra GitHub để nhận giao diện mới.
      const networkRequest = request.mode === "navigate"
        ? new Request(request, { cache: "no-store" })
        : request;

      const networkResponse = await fetchWithTimeout(networkRequest, 8000);

      if (
        networkResponse &&
        networkResponse.status === 200 &&
        networkResponse.type === "basic"
      ) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, networkResponse.clone());

        // Lưu thêm bản index ổn định để dùng khi mất mạng.
        if (request.mode === "navigate") {
          await cache.put("./index.html", networkResponse.clone());
        }
      }

      return networkResponse;
    } catch (error) {
      const cachedResponse = await caches.match(request);
      if (cachedResponse) return cachedResponse;

      if (request.mode === "navigate") {
        const cachedIndex = await caches.match("./index.html");
        if (cachedIndex) return cachedIndex;
      }

      return new Response("Bạn đang ngoại tuyến và tài nguyên này chưa được lưu.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});
