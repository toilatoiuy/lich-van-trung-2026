// sw.js - Service Worker cho "Lịch đa năng - Văn Trung"
// File này BẮT BUỘC phải nằm cùng thư mục gốc với index.html khi đưa lên GitHub Pages
// (ví dụ: cùng nằm trong repo, ngang hàng với index.html).
//
// Nhiệm vụ:
// 1. Nhận thông báo đẩy (push) gửi từ hệ thống nhắc nhở nền (chạy trên GitHub Actions,
//    hoàn toàn miễn phí) và hiển thị ra ngay cả khi trình duyệt đã đóng hẳn.
// 2. Khi người dùng bấm vào thông báo, mở lại (hoặc focus) ứng dụng.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Nhắc nhở', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || '🔔 Nhắc nhở - Lịch Văn Trung';
  const options = {
    body: data.body || '',
    icon: './favicon.ico',
    badge: './favicon.ico',
    tag: data.tag || ('reminder_' + Date.now()),
    requireInteraction: true,
    data: { url: data.url || './' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
