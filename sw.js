const CACHE_NAME = 'lich-van-trung-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://cdn.jsdelivr.net/npm/react-toastify@9.1.3/dist/ReactToastify.min.css',
  'https://esm.sh/react@18.2.0',
  'https://esm.sh/react-dom@18.2.0/client',
  'https://esm.sh/lucide-react@0.294.0',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js',
  'https://esm.sh/react-toastify@9.1.3?external=react,react-dom'
];

// Cài đặt và ép kích hoạt ngay
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Dọn dẹp bộ nhớ đệm phiên bản cũ
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Chiến lược Network-First: Ưu tiên lấy dữ liệu mới nhất từ GitHub/Firebase trước, mất mạng mới dùng Cache Offline
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        // Nếu lấy dữ liệu trực tuyến thành công, cập nhật lại vào cache
        if (networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseClone));
        }
        return networkResponse;
      })
      .catch(() => {
        // Khi mất kết nối internet hoàn toàn, lấy tài nguyên từ cache ra dùng
        return caches.match(e.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Dự phòng trường hợp không tìm thấy file phù hợp trong cache
          return new Response('Ứng dụng hiện đang ngoại tuyến và tài nguyên này chưa được lưu đệm.', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
  );
});
