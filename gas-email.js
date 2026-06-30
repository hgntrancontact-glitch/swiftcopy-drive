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
      case 'new_registration':  handleNewUser(data);        break;
      case 'kick_alert':        handleKickAlert(data);      break;
      case 'account_approved':  handleApprove(data);        break;
      case 'account_kicked':    handleKick(data);           break;
      case 'account_readded':   handleReadd(data);          break;
      case 'upgrade_request':   handleUpgradeRequest(data); break;
      case 'upgrade_approved':  handleUpgradeApproved(data);break;
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

// ═══════════════════════════════════════════════════════════════════
//  HTML EMAIL TEMPLATE — dùng chung cho cả 7 loại email
//  Style toàn bộ inline (Gmail strip <style> ngoài), logo SVG vẽ tay
//  theo favicon.svg (không dùng <img>, không load file ngoài)
// ═══════════════════════════════════════════════════════════════════
function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _nowStr() {
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'HH:mm dd/MM/yyyy');
}

function _fieldRow(label, value) {
  return '<tr>' +
    '<td style="padding:5px 0;color:#868e96;font-size:13px;width:84px;vertical-align:top;font-family:Arial,sans-serif">' + _esc(label) + '</td>' +
    '<td style="padding:5px 0;color:#212529;font-size:13px;font-weight:700;font-family:Arial,sans-serif">' + _esc(value) + '</td>' +
  '</tr>';
}

function _fieldTable(rowsHtml) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:8px">' + rowsHtml + '</table>';
}

// logo SVG — vẽ lại đúng theo favicon.svg (rect bo góc vàng + chữ "S" + dấu mũi tên đỏ)
const _LOGO_SVG =
  '<svg width="26" height="26" viewBox="0 0 64 64" style="display:block" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="2" y="2" width="60" height="60" rx="14" fill="#f5c518"/>' +
    '<text x="32" y="46" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="38" fill="#111110">S</text>' +
    '<path d="M 45 17 L 53 17 M 49 13 L 53 17 L 49 21" fill="none" stroke="#e8291c" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

function buildEmailHtml(opts) {
  return '' +
'<div style="background:#f1f3f5;padding:32px 16px;font-family:Arial,sans-serif">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden">' +
    '<tr><td style="background:#212529;padding:18px 24px">' +
      '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="vertical-align:middle">' + _LOGO_SVG + '</td>' +
        '<td style="vertical-align:middle;padding-left:10px;font-family:Arial,sans-serif;color:#ffffff;font-size:16px;font-weight:800">SwiftCopy.Drive</td>' +
      '</tr></table>' +
    '</td></tr>' +
    '<tr><td style="padding:32px 28px;text-align:center">' +
      '<div style="width:52px;height:52px;line-height:52px;border-radius:50%;background:' + opts.iconBg + ';color:' + opts.iconColor + ';font-size:24px;font-weight:800;margin:0 auto 18px;font-family:Arial,sans-serif">' + opts.iconChar + '</div>' +
      '<div style="font-size:18px;font-weight:800;color:#212529;margin-bottom:12px;font-family:Arial,sans-serif">' + _esc(opts.title) + '</div>' +
      '<div style="font-size:14px;color:#495057;line-height:1.7;text-align:left;font-family:Arial,sans-serif">' + opts.bodyHtml + '</div>' +
      '<a href="' + opts.ctaUrl + '" style="display:block;text-align:center;margin-top:24px;background:' + opts.ctaBg + ';color:' + opts.ctaColor + ';font-weight:800;font-size:14px;padding:13px;border-radius:10px;text-decoration:none;font-family:Arial,sans-serif">' + _esc(opts.ctaText) + '</a>' +
    '</td></tr>' +
    '<tr><td style="padding:16px 28px;border-top:1px solid #e9ecef;text-align:center">' +
      '<span style="font-size:11px;color:#aaa;font-family:Arial,sans-serif">SwiftCopy.Drive · Email tự động, vui lòng không reply</span>' +
    '</td></tr>' +
  '</table>' +
'</div>';
}

// ── 1. THÔNG BÁO ADMIN: user mới đăng ký ──────────────────────────
// Gửi khi: người dùng lần đầu đăng nhập bằng Google, tài khoản được tạo trong Firestore
// Payload: { type, userEmail, userName, plan }
function handleNewUser(data) {
  const subject = '[' + SITE_NAME + '] Người dùng mới đăng ký';
  const bodyHtml =
    '<p style="margin:0 0 4px;font-family:Arial,sans-serif">Có người dùng mới vừa đăng ký tài khoản trên ' + SITE_NAME + '.</p>' +
    _fieldTable(
      _fieldRow('Email', data.userEmail) +
      _fieldRow('Tên', data.userName || data.userEmail) +
      _fieldRow('Gói', data.plan === 'paid' ? 'Trọn đời' : 'Free')
    );
  const html = buildEmailHtml({
    iconBg: '#e7f5ff', iconColor: '#1971c2', iconChar: '+',
    title: 'Người dùng mới đăng ký',
    bodyHtml: bodyHtml,
    ctaText: 'Vào Admin Panel', ctaUrl: (data.siteUrl || SITE_URL) + '/admin.html',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(ADMIN_EMAIL, subject, '', { htmlBody: html });
}

// ── 2. CẢNH BÁO ADMIN: user bị kick đang cố đăng nhập lại ─────────
// Gửi khi: người dùng có status='kicked' trong Firestore đăng nhập thành công
// Payload: { type, userEmail, userName, reason }
function handleKickAlert(data) {
  const subject = '[' + SITE_NAME + '] ⚠️ Cảnh báo: user bị kick đăng nhập lại';
  const bodyHtml =
    '<p style="margin:0 0 4px;font-family:Arial,sans-serif">Một user đã bị kick đang cố đăng nhập lại. Vui lòng kiểm tra.</p>' +
    _fieldTable(
      _fieldRow('Email', data.userEmail) +
      _fieldRow('Tên', data.userName || data.userEmail) +
      _fieldRow('Lý do đã kick', data.reason || '(không có lý do)') +
      _fieldRow('Thời gian', _nowStr())
    );
  const html = buildEmailHtml({
    iconBg: '#fff5f5', iconColor: '#dc3545', iconChar: '⚠',
    title: 'User bị kick đăng nhập lại',
    bodyHtml: bodyHtml,
    ctaText: 'Vào Admin Panel', ctaUrl: (data.siteUrl || SITE_URL) + '/admin.html',
    ctaBg: '#dc3545', ctaColor: '#ffffff'
  });
  GmailApp.sendEmail(ADMIN_EMAIL, subject, '', { htmlBody: html });
}

// ── 3. THÔNG BÁO USER: tài khoản đã được kích hoạt ────────────────
// Gửi khi: admin nhấn "Kích hoạt" trong admin.html
// Payload: { type, toEmail, userName, siteUrl }
function handleApprove(data) {
  const subject = '[' + SITE_NAME + '] Tài khoản đã được kích hoạt';
  const bodyHtml =
    '<p style="margin:0 0 10px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.userName || data.toEmail) + '</b>,</p>' +
    '<p style="margin:0;font-family:Arial,sans-serif">Tài khoản của bạn trên ' + SITE_NAME + ' đã được kích hoạt thành công. Bạn có thể bắt đầu sao chép Drive ngay bây giờ.</p>';
  const html = buildEmailHtml({
    iconBg: '#e6fcf5', iconColor: '#099268', iconChar: '✓',
    title: 'Tài khoản đã được kích hoạt',
    bodyHtml: bodyHtml,
    ctaText: 'Bắt đầu sao chép', ctaUrl: (data.siteUrl || SITE_URL) + '/copy-drive',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html });
}

// ── 4. THÔNG BÁO USER: tài khoản bị khoá ──────────────────────────
// Gửi khi: admin nhấn "Kick" và xác nhận trong admin.html
// Payload: { type, toEmail, userName, reason, siteUrl }
function handleKick(data) {
  const subject = '[' + SITE_NAME + '] Tài khoản của bạn đã bị khoá';
  const bodyHtml =
    '<p style="margin:0 0 10px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.userName || data.toEmail) + '</b>,</p>' +
    '<p style="margin:0 0 10px;font-family:Arial,sans-serif">Tài khoản của bạn trên ' + SITE_NAME + ' đã bị khoá.</p>' +
    '<p style="margin:0;font-family:Arial,sans-serif">Lý do: ' + _esc(data.reason || '(không có lý do)') + '</p>';
  const html = buildEmailHtml({
    iconBg: '#fff5f5', iconColor: '#dc3545', iconChar: '✕',
    title: 'Tài khoản của bạn đã bị khoá',
    bodyHtml: bodyHtml,
    ctaText: 'Liên hệ hỗ trợ', ctaUrl: (data.siteUrl || SITE_URL),
    ctaBg: '#212529', ctaColor: '#ffffff'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html });
}

// ── 6. THÔNG BÁO ADMIN: user yêu cầu nâng cấp lên Trọn đời ────────
// Gửi khi: free user bấm "Tôi đã thanh toán — Chờ xác nhận" trong paymentModal
// Payload: { type, userEmail, userName }
function handleUpgradeRequest(data) {
  const subject = '[' + SITE_NAME + '] ⬆ Yêu cầu nâng cấp lên gói Trọn đời';
  const bodyHtml =
    '<p style="margin:0 0 4px;font-family:Arial,sans-serif">Có người dùng vừa yêu cầu nâng cấp lên gói Trọn đời.</p>' +
    _fieldTable(
      _fieldRow('Email', data.userEmail) +
      _fieldRow('Tên', data.userName || data.userEmail) +
      _fieldRow('Thời gian', _nowStr())
    );
  const html = buildEmailHtml({
    iconBg: '#fffbea', iconColor: '#d97706', iconChar: '↑',
    title: 'Yêu cầu nâng cấp lên Trọn đời',
    bodyHtml: bodyHtml,
    ctaText: 'Duyệt nâng cấp', ctaUrl: (data.siteUrl || SITE_URL) + '/admin.html',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(ADMIN_EMAIL, subject, '', { htmlBody: html });
}

// ── 7. THÔNG BÁO USER: đã được nâng cấp lên gói Trọn đời ──────────
// Gửi khi: admin nhấn "Duyệt nâng cấp" trong admin.html
// Payload: { type, toEmail, userName, siteUrl }
function handleUpgradeApproved(data) {
  const subject = '[' + SITE_NAME + '] 🎉 Tài khoản đã được nâng cấp lên gói Trọn đời';
  const bodyHtml =
    '<p style="margin:0 0 10px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.userName || data.toEmail) + '</b>,</p>' +
    '<p style="margin:0;font-family:Arial,sans-serif">Chúc mừng! Tài khoản của bạn trên ' + SITE_NAME + ' đã được nâng cấp thành công lên gói <b>Trọn đời</b>. Từ bây giờ bạn có thể sao chép không giới hạn, bao gồm video và lưu lịch sử đầy đủ.</p>';
  const html = buildEmailHtml({
    iconBg: '#e6fcf5', iconColor: '#099268', iconChar: '★',
    title: 'Nâng cấp lên Trọn đời thành công',
    bodyHtml: bodyHtml,
    ctaText: 'Vào dashboard', ctaUrl: (data.siteUrl || SITE_URL) + '/copy-drive',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html });
}

// ── 5. THÔNG BÁO USER: tài khoản được kích hoạt trở lại ───────────
// Gửi khi: admin nhấn "Thêm lại" với user đã bị kick
// Payload: { type, toEmail, userName, note, siteUrl }
function handleReadd(data) {
  const subject = '[' + SITE_NAME + '] Tài khoản của bạn đã được kích hoạt trở lại';
  const bodyHtml =
    '<p style="margin:0 0 10px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.userName || data.toEmail) + '</b>,</p>' +
    '<p style="margin:0' + (data.note ? ' 0 10px' : '') + ';font-family:Arial,sans-serif">Tài khoản của bạn trên ' + SITE_NAME + ' đã được khôi phục với gói <b>Trọn đời</b>.</p>' +
    (data.note ? '<p style="margin:0;font-size:13px;color:#868e96;font-family:Arial,sans-serif">Ghi chú từ admin: ' + _esc(data.note) + '</p>' : '');
  const html = buildEmailHtml({
    iconBg: '#e6fcf5', iconColor: '#099268', iconChar: '↺',
    title: 'Tài khoản đã được kích hoạt trở lại',
    bodyHtml: bodyHtml,
    ctaText: 'Đăng nhập ngay', ctaUrl: (data.siteUrl || SITE_URL),
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html });
}
