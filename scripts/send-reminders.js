// scripts/send-reminders.js
//
// Chạy định kỳ (do GitHub Actions gọi, miễn phí, không cần máy chủ riêng).
// Công việc: quét Firestore tìm các "Sự kiện / Việc cần làm / Ghi chú" đã đến giờ
// nhắc mà CHƯA gửi thông báo, rồi gửi Thông báo đẩy (Web Push) tới các thiết bị
// đã bật thông báo của đúng người dùng đó — hoạt động cả khi họ đã tắt hẳn trình duyệt.
//
// Các biến môi trường bắt buộc (được truyền vào từ GitHub Actions Secrets):
//   FIREBASE_SERVICE_ACCOUNT  - nội dung JSON của Service Account Key (dạng chuỗi)
//   VAPID_PUBLIC_KEY          - khóa công khai VAPID (giống trong index.html)
//   VAPID_PRIVATE_KEY         - khóa riêng tư VAPID (KHÔNG được để lộ ra ngoài)
//   VAPID_SUBJECT             - email liên hệ dạng "mailto:ten@email.com"
//   FIREBASE_PROJECT_ID       - (tuỳ chọn) mặc định "lich-van-trung"

const admin = require('firebase-admin');
const webpush = require('web-push');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'lich-van-trung';
const APP_URL = process.env.APP_URL || './';

function fail(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

if (!process.env.FIREBASE_SERVICE_ACCOUNT) fail('Thiếu biến môi trường FIREBASE_SERVICE_ACCOUNT');
if (!process.env.VAPID_PUBLIC_KEY) fail('Thiếu biến môi trường VAPID_PUBLIC_KEY');
if (!process.env.VAPID_PRIVATE_KEY) fail('Thiếu biến môi trường VAPID_PRIVATE_KEY');
if (!process.env.VAPID_SUBJECT) fail('Thiếu biến môi trường VAPID_SUBJECT');

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (e) {
  fail('FIREBASE_SERVICE_ACCOUNT không phải JSON hợp lệ: ' + e.message);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: PROJECT_ID
});
const db = admin.firestore();

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const TYPE_META = {
  todos: { label: '✅ Việc cần làm', titleField: 'text' },
  notes: { label: '📝 Ghi chú', titleField: 'title' },
  events: { label: '📅 Sự kiện', titleField: 'title' }
};

async function getSubscriptions(uid) {
  const snap = await db.collection('artifacts').doc(PROJECT_ID)
    .collection('users').doc(uid)
    .collection('pushSubscriptions').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function sendToUser(uid, payload) {
  const subs = await getSubscriptions(uid);
  if (subs.length === 0) return { sent: 0, total: 0 };
  let sent = 0;
  for (const sub of subs) {
    if (!sub.endpoint || !sub.keys) continue;
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err) {
      const code = err.statusCode;
      if (code === 404 || code === 410) {
        // Subscription hết hạn/không còn hợp lệ -> dọn dẹp
        await db.collection('artifacts').doc(PROJECT_ID)
          .collection('users').doc(uid)
          .collection('pushSubscriptions').doc(sub.id).delete().catch(() => {});
      } else {
        console.warn(`  ⚠️ Gửi lỗi cho subscription ${sub.id}:`, err.message);
      }
    }
  }
  return { sent, total: subs.length };
}

async function processCollection(colName) {
  const meta = TYPE_META[colName];
  const now = admin.firestore.Timestamp.now();
  const lowerBound = admin.firestore.Timestamp.fromMillis(now.toMillis() - 3 * 24 * 60 * 60 * 1000);

  const snap = await db.collectionGroup(colName)
    .where('reminderTime', '>=', lowerBound)
    .where('reminderTime', '<=', now)
    .get();

  console.log(`🔎 [${colName}] tìm thấy ${snap.size} mục trong khoảng thời gian cần xét.`);

  let notified = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (data.pushSent === true) continue;
    if (data.completed === true) continue;

    // Chỉ xử lý những document thực sự nằm trong cấu trúc artifacts/{appId}/users/{uid}/...
    const usersDocRef = docSnap.ref.parent.parent; // artifacts/{appId}/users/{uid}
    if (!usersDocRef) continue;
    const uid = usersDocRef.id;

    const title = data[meta.titleField] || data.title || data.text || 'Nhắc nhở chưa đặt tên';
    let body = '';
    if (colName === 'notes' && data.content) body = String(data.content).slice(0, 120);
    if (colName === 'todos' && data.deadlineTime) {
      body = 'Hạn chót: ' + new Date(data.deadlineTime.toDate()).toLocaleString('vi-VN');
    }
    if (!body) body = 'Đã đến giờ nhắc bạn.';

    const payload = {
      title: `🔔 ${meta.label}: ${title}`,
      body,
      tag: `${colName}_${docSnap.id}`,
      url: APP_URL
    };

    const result = await sendToUser(uid, payload);
    console.log(`  → [${colName}/${docSnap.id}] uid=${uid} gửi ${result.sent}/${result.total} thiết bị.`);

    // Đánh dấu đã gửi để không gửi lặp lại (dù có gửi được hay không, tránh quét đi quét lại mãi).
    await docSnap.ref.update({ pushSent: true }).catch(err => {
      console.warn(`  ⚠️ Không thể cập nhật pushSent cho ${docSnap.ref.path}:`, err.message);
    });
    notified++;
  }
  return notified;
}

async function main() {
  console.log('🚀 Bắt đầu quét nhắc nhở lúc', new Date().toISOString());
  let totalNotified = 0;
  let hadError = false;
  for (const colName of Object.keys(TYPE_META)) {
    try {
      totalNotified += await processCollection(colName);
    } catch (err) {
      hadError = true;
      console.error(`❌ Lỗi khi xử lý collection "${colName}":`, err.message);
      // Firestore thường trả kèm 1 đường link để tự tạo Index còn thiếu — in rõ ra để dễ thấy.
      const urlMatch = String(err.message).match(/https:\/\/[^\s]+/);
      if (urlMatch) {
        console.error('👉 THIẾU INDEX FIRESTORE. Mở link sau, đăng nhập, bấm "Create Index" (hoặc "Save"), đợi vài phút cho index build xong rồi chạy lại workflow:');
        console.error('   ' + urlMatch[0]);
      }
    }
  }
  console.log(`✅ Hoàn tất. Đã gửi thông báo cho ${totalNotified} mục.`);
  if (hadError) {
    console.error('⚠️ Có lỗi xảy ra ở ít nhất 1 collection (xem chi tiết phía trên). Đánh dấu lần chạy này là THẤT BẠI để anh dễ nhận ra, dù các collection khác có thể vẫn chạy tốt.');
    process.exitCode = 1;
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error('❌ Lỗi không mong muốn:', err);
  process.exit(1);
});
