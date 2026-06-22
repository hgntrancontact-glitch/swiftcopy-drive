// ═══════════════════════════════════════════════════════════════════
//  SwiftCopy.Drive — Email Backend via Google Apps Script
//  File: gas-email.js  (dán toàn bộ vào Google Apps Script editor)
//
//  ── CÁCH DEPLOY LẦN ĐẦU ────────────────────────────────────────
//  1. Vào https://script.google.com → Nhấn "+ New project"
//  2. Xoá toàn bộ code mặc định trong editor
//  3. Dán toàn bộ file này vào
//  4. Sửa ADMIN_EMAIL và SITE_URL bên dưới cho đúng
//  5. Nhấn biểu tượng Save (Ctrl+S)
//  6. Click menu Deploy → New deployment
//       - Type: Web app
//       - Execute as: Me (tài khoản Google của bạn)
//       - Who has access: Anyone
//  7. Nhấn Deploy → Copy đường link "Web app URL" nhận được
//  8. Dán URL đó vào const GAS_URL trong app.js và admin.html
//
//  ── KHI SỬA CODE VÀ CẦN DEPLOY LẠI ───────────────────────────
//  1. Sửa code trong editor
//  2. Deploy → Manage deployments → chọn deployment hiện có → Edit (bút chì)
//  3. Version: "New version" → nhấn Deploy
//  4. URL không đổi — không cần cập nhật GAS_URL trong web app
//
//  ── LƯU Ý BẢO MẬT ─────────────────────────────────────────────
//  URL GAS hoạt động như API key — giữ bí mật, không commit lên GitHub
//  Thay vào đó: sau khi deploy, chỉ paste URL vào GAS_URL trong code local
// ═══════════════════════════════════════════════════════════════════

const ADMIN_EMAIL = 'hgntran.contact@gmail.com'; // ← Email nhận thông báo admin
const SITE_NAME   = 'SwiftCopy.Drive';
const SITE_URL    = 'https://your-domain.com';    // ← URL web thật (dùng làm fallback)

// ── ENTRY POINT ────────────────────────────────────────────────────
// GAS gọi doPost() mỗi khi web app nhận POST request
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    switch (data.type) {
      case 'new_user':   handleNewUser(data);   break;
      case 'kick_alert': handleKickAlert(data); break;
      case 'approve':    handleApprove(data);   break;
      case 'kick':       handleKick(data);      break;
      case 'readd':      handleReadd(data);     break;
      default:
        throw new Error('Unknown type: ' + data.type);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    // Không để lỗi làm crash — trả về JSON error để dễ debug
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── 1. THÔNG BÁO ADMIN: user mới đăng ký ──────────────────────────
// Gửi khi: người dùng lần đầu đăng nhập bằng Google, tài khoản được tạo trong Firestore
// Payload: { type, userEmail, userName }
function handleNewUser(data) {
  const subject = '[' + SITE_NAME + '] Người dùng mới đăng ký';
  const body = [
    'Có người dùng mới vừa đăng ký tài khoản trên ' + SITE_NAME + '.',
    '',
    'Email : ' + data.userEmail,
    'Tên   : ' + (data.userName || data.userEmail),
    '',
    'Vào admin panel để duyệt:',
    (data.siteUrl || SITE_URL) + '/admin.html'
  ].join('\n');
  GmailApp.sendEmail(ADMIN_EMAIL, subject, body);
}

// ── 2. CẢNH BÁO ADMIN: user bị kick đang cố đăng nhập lại ─────────
// Gửi khi: người dùng có status='kicked' trong Firestore đăng nhập thành công
// Payload: { type, userEmail, userName, reason }
function handleKickAlert(data) {
  const subject = '[' + SITE_NAME + '] ⚠️ Cảnh báo: user bị kick đăng nhập lại';
  const body = [
    'Cảnh báo: một user đã bị kick đang cố đăng nhập lại.',
    '',
    'Email  : ' + data.userEmail,
    'Tên    : ' + (data.userName || data.userEmail),
    'Lý do đã kick: ' + (data.reason || '(không có lý do)'),
    '',
    'Xem chi tiết tại admin panel:',
    (data.siteUrl || SITE_URL) + '/admin.html'
  ].join('\n');
  GmailApp.sendEmail(ADMIN_EMAIL, subject, body);
}

// ── 3. THÔNG BÁO USER: tài khoản đã được kích hoạt ────────────────
// Gửi khi: admin nhấn "Kích hoạt" trong admin.html
// Payload: { type, toEmail, userName, siteUrl }
function handleApprove(data) {
  const subject = '[' + SITE_NAME + '] Tài khoản đã được kích hoạt';
  const body = [
    'Xin chào ' + (data.userName || data.toEmail) + ',',
    '',
    'Tài khoản của bạn trên ' + SITE_NAME + ' đã được kích hoạt.',
    'Truy cập ngay: ' + (data.siteUrl || SITE_URL),
    '',
    'Trân trọng,',
    'Đội ngũ ' + SITE_NAME
  ].join('\n');
  GmailApp.sendEmail(data.toEmail, subject, body);
}

// ── 4. THÔNG BÁO USER: tài khoản bị khoá ──────────────────────────
// Gửi khi: admin nhấn "Kick" và xác nhận trong admin.html
// Payload: { type, toEmail, userName, reason, siteUrl }
function handleKick(data) {
  const subject = '[' + SITE_NAME + '] Tài khoản của bạn đã bị khoá';
  const body = [
    'Xin chào ' + (data.userName || data.toEmail) + ',',
    '',
    'Tài khoản của bạn trên ' + SITE_NAME + ' đã bị khoá.',
    '',
    'Lý do: ' + (data.reason || '(không có lý do)'),
    '',
    'Nếu bạn có thắc mắc, vui lòng liên hệ chúng tôi.',
    '',
    'Trân trọng,',
    'Đội ngũ ' + SITE_NAME,
    data.siteUrl || SITE_URL
  ].join('\n');
  GmailApp.sendEmail(data.toEmail, subject, body);
}

// ── 5. THÔNG BÁO USER: tài khoản được kích hoạt trở lại ───────────
// Gửi khi: admin nhấn "Thêm lại" với user đã bị kick
// Payload: { type, toEmail, userName, note, siteUrl }
function handleReadd(data) {
  const noteText = data.note ? '\n\nGhi chú từ admin: ' + data.note : '';
  const subject = '[' + SITE_NAME + '] Tài khoản của bạn đã được kích hoạt trở lại';
  const body = [
    'Xin chào ' + (data.userName || data.toEmail) + ',',
    '',
    'Tài khoản của bạn trên ' + SITE_NAME + ' đã được kích hoạt trở lại.' + noteText,
    '',
    'Truy cập ngay: ' + (data.siteUrl || SITE_URL),
    '',
    'Trân trọng,',
    'Đội ngũ ' + SITE_NAME
  ].join('\n');
  GmailApp.sendEmail(data.toEmail, subject, body);
}
