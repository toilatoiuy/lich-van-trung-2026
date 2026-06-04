const CACHE_NAME = 'lich-vantrung-cache-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://cdn.jsdelivr.net/npm/react-toastify@9.1.3/dist/ReactToastify.min.css'
];

// 1. Kích hoạt cài đặt và tự động lưu đệm các tài nguyên tĩnh
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting(); // Buộc Service Worker mới kích hoạt ngay lập tức khi sửa code
});

// 2. Xóa bỏ bộ nhớ đệm cũ khi anh cập nhật phiên bản ứng dụng mới
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Cơ chế chiến lược mạng: Ưu tiên lấy trong bộ nhớ đệm trước để mở app ngay lập tức, nếu mất mạng vẫn chạy bình thường
self.addEventListener('fetch', (event) => {
  // Chỉ cache các yêu cầu GET thông thường, không cache Firebase Firestore
  if (event.request.method !== 'GET' || event.request.url.includes('firestore.googleapis.com')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Trả về bản cache ngay lập tức để ứng dụng tải nhanh <0.5s
        fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {/* Bỏ qua lỗi ngầm khi offline */});
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});

// 4. LẮNG NGHE THÔNG BÁO ĐẨY CHỦ ĐỘNG BUỔI SÁNG (Push Notification)
self.addEventListener('push', (event) => {
  let data = { title: 'Lịch nhắc việc buổi sáng', body: 'Chào anh Trung, chúc anh một ngày làm việc hiệu quả! Hãy kiểm tra các lịch trình và việc cần làm hôm nay.' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="20" width="80" height="70" rx="15" fill="white" stroke="%23DC2626" stroke-width="5"/><text x="50" y="75" font-size="40" text-anchor="middle" fill="%23DC2626" font-family="sans-serif" font-weight="bold">31</text></svg>',
    badge: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="20" width="80" height="70" rx="15" fill="black"/></svg>',
    vibrate: [200, 100, 200],
    data: {
      url: self.registration.scope + '?open_reminder=true' // Gắn tham số để khi click vào thông báo sẽ mở Pop-up nổi
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// 5. XỬ LÝ SỰ KIỆN KHI NGƯỜI DÙNG BẤM VÀO THÔNG BÁO TRÊN MÀN HÌNH KHÓA
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); // Đóng thông báo ngoài màn hình khóa
  
  let targetUrl = event.notification.data ? event.notification.data.url : self.registration.scope;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Nếu app đang mở sẵn, điều hướng nó
      for (let i = 0; i < windowClients.length; i++) {
        let client = windowClients[i];
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Nếu app chưa mở, bật tab mới với tham số kích hoạt Pop-up nổi
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});