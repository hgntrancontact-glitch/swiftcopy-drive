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
const SITE_URL    = 'https://swiftcopydrive.vercel.app';  // ← URL web thật (dùng làm fallback)

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
      case 'register_free_success':       handleRegisterFreeSuccess(data);       break;
      case 'register_paid_pending':        handleRegisterPaidPending(data);        break;
      case 'account_deleted_permanently':  handleAccountDeletedPermanently(data);  break;
      case 'plan_upgraded_by_admin':       handlePlanUpgradedByAdmin(data);        break;
      case 'plan_downgraded_by_admin':     handlePlanDowngradedByAdmin(data);      break;
      // ── CTV emails ─────────────────────────────────────────────────
      case 'admin_ctv_applied':            handleAdminCTVApplied(data);            break;
      case 'ctv_welcome':                  handleCTVWelcome(data);                 break;
      case 'ctv_new_signup':               handleCTVNewSignup(data);               break;
      case 'ctv_commission_earned':        handleCTVCommissionEarned(data);        break;
      case 'ctv_client_kicked':            handleCTVClientKicked(data);            break;
      case 'ctv_client_deleted':           handleCTVClientDeleted(data);           break;
      case 'ctv_urgent_payment':           handleCTVUrgentPayment(data);           break;
      case 'ctv_kicked':                   handleCTVKicked(data);                  break;
      case 'ctv_deleted_permanently':      handleCTVDeletedPermanently(data);      break;
      case 'ctv_readded':                  handleCTVReadded(data);                 break;
      case 'ctv_kick_alert':               handleCTVKickAlert(data);               break;
      case 'upgrade_request_received':     handleUpgradeRequestReceived(data);     break;
      case 'admin_self_delete_notice':     handleAdminSelfDeleteNotice(data);      break;
      case 'trial_used_up':               handleTrialUsedUp(data);                break;
      case 'credit_used_up':              handleCreditUsedUp(data);               break;
      case 'credit_purchase_request':     handleCreditPurchaseRequest(data);      break;
      case 'credit_added':               handleCreditAdded(data);                break;
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

// logo SVG — vẽ lại đúng theo favicon.svg (rect bo góc vàng + dấu mũi tên đỏ)
const _LOGO_SVG =
  '<svg width="26" height="26" viewBox="0 0 64 64" style="display:block" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="2" y="2" width="60" height="60" rx="14" fill="#f5c518"/>' +
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
  const subject = 'Người dùng mới đăng ký';
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
  GmailApp.sendEmail(ADMIN_EMAIL, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 2. CẢNH BÁO ADMIN: user bị kick đang cố đăng nhập lại ─────────
// Gửi khi: người dùng có status='kicked' trong Firestore đăng nhập thành công
// Payload: { type, userEmail, userName, reason }
function handleKickAlert(data) {
  const subject = 'Cảnh báo: user bị kick đăng nhập lại';
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
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(ADMIN_EMAIL, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 3. THÔNG BÁO USER: tài khoản đã được kích hoạt ────────────────
// Gửi khi: admin nhấn "Kích hoạt" trong admin.html
// Payload: { type, toEmail, userName, siteUrl }
function handleApprove(data) {
  const subject = 'Tài khoản đã được kích hoạt';
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
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 4. THÔNG BÁO USER: tài khoản bị khoá ──────────────────────────
// Gửi khi: admin nhấn "Kick" và xác nhận trong admin.html
// Payload: { type, toEmail, userName, reason, siteUrl }
function handleKick(data) {
  const subject = 'Tài khoản của bạn đã bị khoá';
  const bodyHtml =
    '<p style="margin:0 0 10px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.userName || data.toEmail) + '</b>,</p>' +
    '<p style="margin:0 0 10px;font-family:Arial,sans-serif">Tài khoản của bạn trên ' + SITE_NAME + ' đã bị khoá.</p>' +
    '<p style="margin:0;font-family:Arial,sans-serif">Lý do: ' + _esc(data.reason || '(không có lý do)') + '</p>';
  const html = buildEmailHtml({
    iconBg: '#fff5f5', iconColor: '#dc3545', iconChar: '✕',
    title: 'Tài khoản của bạn đã bị khoá',
    bodyHtml: bodyHtml,
    ctaText: 'Liên hệ hỗ trợ', ctaUrl: (data.siteUrl || SITE_URL),
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 6. THÔNG BÁO ADMIN: user yêu cầu nâng cấp lên Trọn đời ────────
// Gửi khi: free user bấm "Tôi đã thanh toán — Chờ xác nhận" trong paymentModal
// Payload: { type, userEmail, userName }
function handleUpgradeRequest(data) {
  const subject = 'Yêu cầu nâng cấp lên gói Trọn đời';
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
  GmailApp.sendEmail(ADMIN_EMAIL, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 7. THÔNG BÁO USER: đã được nâng cấp lên gói Trọn đời ──────────
// Gửi khi: admin nhấn "Duyệt nâng cấp" trong admin.html
// Payload: { type, toEmail, userName, siteUrl }
function handleUpgradeApproved(data) {
  const subject = 'Tài khoản đã được nâng cấp lên gói Trọn đời';
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
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 5. THÔNG BÁO USER: tài khoản được kích hoạt trở lại ───────────
// Gửi khi: admin nhấn "Thêm lại" với user đã bị kick
// Payload: { type, toEmail, userName, note, siteUrl }
function handleReadd(data) {
  const subject = 'Tài khoản của bạn đã được kích hoạt trở lại';
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
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });;
}

// ── 8. THÔNG BÁO USER: đăng ký gói Miễn phí thành công ────────────
// Gửi khi: user hoàn tất đăng ký gói Free (createFreeUser trong auth.js)
// Payload: { type, toEmail, userName, siteUrl }
function handleRegisterFreeSuccess(data) {
  const subject = 'Đăng ký thành công gói Dùng thử!';
  const compareRow = (label, trialVal, trialColor, paidVal) =>
    '<tr>' +
      '<td style="padding:7px 6px;color:#495057;font-size:12.5px;border-bottom:1px solid #f1f3f5;font-family:Arial,sans-serif">' + label + '</td>' +
      '<td style="padding:7px 6px;text-align:center;font-size:12.5px;color:' + trialColor + ';border-bottom:1px solid #f1f3f5;font-family:Arial,sans-serif">' + trialVal + '</td>' +
      '<td style="padding:7px 6px;text-align:center;font-size:12.5px;font-weight:700;color:#a07820;background:#fffdf5;border-bottom:1px solid #f1f3f5;font-family:Arial,sans-serif">' + paidVal + '</td>' +
    '</tr>';
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.userName || data.toEmail) + '</b>, tài khoản của bạn trên ' + SITE_NAME + ' đã sẵn sàng với gói <b>Dùng thử</b>!</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:14px">' +
      '<tr>' +
        '<td style="padding:8px 6px;border-bottom:1px solid #e9ecef"></td>' +
        '<td style="padding:8px 6px;text-align:center;font-size:12.5px;color:#495057;font-weight:700;border-bottom:1px solid #e9ecef;font-family:Arial,sans-serif">Dùng thử</td>' +
        '<td style="padding:8px 6px;text-align:center;font-size:12.5px;color:#a07820;font-weight:800;background:#fffdf5;border-bottom:1px solid #f0d060;font-family:Arial,sans-serif">Trọn đời</td>' +
      '</tr>' +
      compareRow('Sao chép file &amp; thư mục', '✓', '#495057', '✓') +
      compareRow('Dung lượng', '2 GB / 1 lần dùng', '#495057', 'Không giới hạn') +
      compareRow('Copy video', '✕', '#dc3545', '✓ Không giới hạn') +
      compareRow('File không có nút tải', '✕', '#dc3545', '✓') +
      compareRow('Tự resume mất mạng', '✕', '#dc3545', '✓') +
    '</table>' +
    '<div style="background:#fffbea;border:1px solid #f0d060;border-radius:10px;padding:12px 14px;font-size:13px;color:#856404;line-height:1.6;font-family:Arial,sans-serif">Nâng cấp lên <b>Trọn đời</b> chỉ <b>290.000đ</b> — dùng mãi mãi, không giới hạn dung lượng &amp; video.</div>';
  const html = buildEmailHtml({
    iconBg: '#e6fcf5', iconColor: '#099268', iconChar: '✓',
    title: 'Đăng ký thành công gói Dùng thử!',
    bodyHtml: bodyHtml,
    ctaText: 'Đăng nhập ngay', ctaUrl: (data.siteUrl || SITE_URL),
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 10. THÔNG BÁO USER: tài khoản bị xoá vĩnh viễn ─────────────────
// Gửi khi: admin nhấn "Xoá" trong admin.html (deleteDoc Firestore)
// Payload: { type, toEmail, userName, siteUrl }
function handleAccountDeletedPermanently(data) {
  const subject = 'Tài khoản của bạn đã bị xoá';
  const bodyHtml =
    '<p style="margin:0 0 10px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.userName || data.toEmail) + '</b>,</p>' +
    '<p style="margin:0;font-family:Arial,sans-serif">Tài khoản SwiftCopy.Drive gắn với email này đã bị xoá vĩnh viễn khỏi hệ thống, bao gồm toàn bộ lịch sử sử dụng. Nếu muốn tiếp tục sử dụng dịch vụ, bạn có thể dùng email này đăng ký lại như một tài khoản hoàn toàn mới bất kỳ lúc nào.</p>';
  const html = buildEmailHtml({
    iconBg: '#fff5f5', iconColor: '#dc3545', iconChar: '✕',
    title: 'Tài khoản của bạn đã bị xoá',
    bodyHtml: bodyHtml,
    ctaText: 'Đăng ký lại', ctaUrl: (data.siteUrl || SITE_URL),
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 11. THÔNG BÁO USER: admin nâng cấp lên Trọn đời ─────────────────
// Gửi khi: admin đổi plan từ Free → Paid qua dropdown trong admin.html
// Payload: { type, toEmail, userName, siteUrl }
function handlePlanUpgradedByAdmin(data) {
  const newPlan = data.newPlan || 'Trọn đời';
  const subject = 'Gói của bạn đã được nâng cấp lên ' + newPlan + '!';
  const isLifetime = newPlan === 'Trọn đời';
  const bodyHtml =
    '<p style="margin:0 0 10px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.userName || data.toEmail) + '</b>,</p>' +
    '<p style="margin:0;font-family:Arial,sans-serif">Tài khoản của bạn trên ' + SITE_NAME + ' vừa được admin nâng cấp lên gói <b>' + _esc(newPlan) + '</b>.' +
    (isLifetime ? ' Từ bây giờ bạn có thể sao chép không giới hạn, bao gồm video và tự tiếp tục sau mất mạng/máy tắt.' : ' Bạn đã có 3 lượt sao chép mới — vào dashboard để sử dụng ngay.') + '</p>';
  const html = buildEmailHtml({
    iconBg: '#e6fcf5', iconColor: '#099268', iconChar: '★',
    title: 'Gói của bạn đã được nâng cấp lên ' + newPlan + '!',
    bodyHtml: bodyHtml,
    ctaText: 'Đăng nhập ngay', ctaUrl: (data.siteUrl || SITE_URL) + '/copy-drive',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 12. THÔNG BÁO USER: admin hạ cấp ─────────────────────────────────
// Gửi khi: admin đổi plan qua dropdown trong admin.html (hướng xuống theo rank)
// Payload: { type, toEmail, userName, newPlan, oldPlan, siteUrl }
function handlePlanDowngradedByAdmin(data) {
  const newPlan = data.newPlan || 'Dùng thử';
  const oldPlan = data.oldPlan || 'Trọn đời';
  const subject = 'Tài khoản của bạn đã được chuyển về gói ' + newPlan;
  const compareRow = (label, trialVal, trialColor, paidVal) =>
    '<tr>' +
      '<td style="padding:7px 6px;color:#495057;font-size:12.5px;border-bottom:1px solid #f1f3f5;font-family:Arial,sans-serif">' + label + '</td>' +
      '<td style="padding:7px 6px;text-align:center;font-size:12.5px;color:' + trialColor + ';border-bottom:1px solid #f1f3f5;font-family:Arial,sans-serif">' + trialVal + '</td>' +
      '<td style="padding:7px 6px;text-align:center;font-size:12.5px;font-weight:700;color:#a07820;background:#fffdf5;border-bottom:1px solid #f1f3f5;font-family:Arial,sans-serif">' + paidVal + '</td>' +
    '</tr>';
  const bodyHtml =
    '<p style="margin:0 0 10px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.userName || data.toEmail) + '</b>,</p>' +
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Tài khoản của bạn vừa được admin hạ từ gói <b>' + _esc(oldPlan) + '</b> về gói <b>' + _esc(newPlan) + '</b>.</p>' +
    '<div style="background:#fff5f5;border:1px solid #ffe3e3;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-family:Arial,sans-serif">' +
      '<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#dc3545;font-family:Arial,sans-serif">Một số tính năng đã bị cắt giảm như:</p>' +
      '<ul style="margin:0;padding-left:16px;color:#dc3545;font-size:13px;line-height:1.8">' +
        '<li>Copy video không giới hạn</li>' +
        '<li>Không giới hạn dung lượng</li>' +
        '<li>Sao chép được file không có nút tải về</li>' +
        '<li>Tự tiếp tục sau mất mạng/máy tắt</li>' +
      '</ul>' +
    '</div>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:14px">' +
      '<tr>' +
        '<td style="padding:8px 6px;border-bottom:1px solid #e9ecef"></td>' +
        '<td style="padding:8px 6px;text-align:center;font-size:12.5px;color:#495057;font-weight:700;border-bottom:1px solid #e9ecef;font-family:Arial,sans-serif">Dùng thử</td>' +
        '<td style="padding:8px 6px;text-align:center;font-size:12.5px;color:#a07820;font-weight:800;background:#fffdf5;border-bottom:1px solid #f0d060;font-family:Arial,sans-serif">Trọn đời</td>' +
      '</tr>' +
      compareRow('Sao chép file &amp; thư mục', '✓', '#495057', '✓') +
      compareRow('Dung lượng', '2 GB / 1 lần dùng', '#495057', 'Không giới hạn') +
      compareRow('Copy video', '✕', '#dc3545', '✓ Không giới hạn') +
      compareRow('File không có nút tải', '✕', '#dc3545', '✓') +
      compareRow('Tự resume mất mạng', '✕', '#dc3545', '✓') +
    '</table>' +
    '<div style="background:#fffbea;border:1px solid #f0d060;border-radius:10px;padding:12px 14px;font-size:13px;color:#856404;line-height:1.6;font-family:Arial,sans-serif">Quay lại <b>Trọn đời</b> chỉ <b>290.000đ</b> — dùng mãi mãi, không lo giới hạn lần nữa.</div>';
  const html = buildEmailHtml({
    iconBg: '#fffbea', iconColor: '#d97706', iconChar: '↓',
    title: 'Gói của bạn đã được chuyển về ' + newPlan,
    bodyHtml: bodyHtml,
    ctaText: 'Đăng nhập ngay', ctaUrl: (data.siteUrl || SITE_URL) + '/copy-drive',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 9. THÔNG BÁO USER: đã ghi nhận đăng ký gói Trọn đời, chờ duyệt ─
// Gửi khi: user hoàn tất bước thanh toán gói Trọn đời, chờ admin duyệt (createPaidPendingUser trong auth.js)
// Payload: { type, toEmail, userName, siteUrl }
function handleRegisterPaidPending(data) {
  const subject = 'Đã ghi nhận đăng ký gói Trọn đời';
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.userName || data.toEmail) + '</b>, chúng tôi đã ghi nhận yêu cầu đăng ký gói <b>Trọn đời</b> của bạn trên ' + SITE_NAME + '. Đơn hàng đang được xác nhận thanh toán.</p>' +
    '<div style="background:#f8f9fa;border-radius:10px;padding:14px 16px;margin-bottom:14px;font-family:Arial,sans-serif">' +
      '<p style="margin:0 0 8px;font-size:13px;color:#495057"><b style="color:#212529">Thời gian xử lý:</b> thường trong vài phút, tối đa vài giờ</p>' +
      '<p style="margin:0;font-size:13px;color:#495057"><b style="color:#212529">Bạn cần làm:</b> đăng nhập lại web sau khi nhận được email kích hoạt</p>' +
    '</div>' +
    '<div style="background:#fffbea;border:1px solid #f0d060;border-radius:10px;padding:12px 14px;font-size:13px;color:#856404;line-height:1.6;font-family:Arial,sans-serif">Nếu chưa kích hoạt, vui lòng đợi thêm ít phút rồi thử đăng nhập lại — chúng tôi sẽ xử lý sớm nhất có thể.</div>';
  const html = buildEmailHtml({
    iconBg: '#fffbea', iconColor: '#d97706', iconChar: '◷',
    title: 'Đã ghi nhận đăng ký gói Trọn đời',
    bodyHtml: bodyHtml,
    ctaText: 'Đăng nhập ngay', ctaUrl: (data.siteUrl || SITE_URL),
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 13. ADMIN: Có đơn đăng ký CTV mới ──────────────────────────────────────
// Payload: { type, userName, userEmail, phone, note, siteUrl }
function handleAdminCTVApplied(data) {
  const subject = 'Có đơn đăng ký CTV mới';
  const rowsHtml =
    _fieldRow('Họ tên', _esc(data.userName || '')) +
    _fieldRow('Email', _esc(data.userEmail || '')) +
    _fieldRow('Số điện thoại', _esc(data.phone || '')) +
    (data.note ? _fieldRow('Ghi chú', _esc(data.note)) : '') +
    _fieldRow('Thời gian', _nowStr());
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Có người vừa nộp đơn đăng ký cộng tác viên (CTV). Vào trang quản trị để xem xét và duyệt đơn.</p>' +
    _fieldTable(rowsHtml);
  const html = buildEmailHtml({
    iconBg: '#fffbea', iconColor: '#d97706', iconChar: '★',
    title: 'Đơn đăng ký CTV mới',
    bodyHtml: bodyHtml,
    ctaText: 'Vào trang quản trị', ctaUrl: (data.siteUrl || SITE_URL) + '/admin.html',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(ADMIN_EMAIL, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 14. CTV: Chào mừng, đã được duyệt ──────────────────────────────────────
// Payload: { type, toEmail, ctvName, code, siteUrl }
function handleCTVWelcome(data) {
  const subject = 'Bạn đã được duyệt làm CTV — SwiftCopy.Drive';
  const affLink = data.affiliateLink || ((data.siteUrl || SITE_URL) + '?r=' + _esc(data.ctvCode || data.code || ''));
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.ctvName || data.toEmail) + '</b>, đơn đăng ký cộng tác viên của bạn đã được duyệt! Bạn sẽ nhận <b>hoa hồng 50% = 125.000đ</b> cho mỗi khách mua gói Trọn đời qua link của bạn.</p>' +
    '<div style="background:#f8f9fa;border:1px solid #e9ecef;border-radius:10px;padding:14px 16px;margin-bottom:14px;font-family:Arial,sans-serif">' +
      '<p style="margin:0 0 6px;font-size:12px;color:#868e96;text-transform:uppercase;letter-spacing:.5px">Link giới thiệu cá nhân của bạn</p>' +
      '<p style="margin:0;font-size:14px;color:#212529;font-weight:700;word-break:break-all">' + affLink + '</p>' +
    '</div>' +
    '<div style="background:#fffbea;border:1px solid #f0d060;border-radius:10px;padding:12px 14px;font-size:13px;color:#856404;line-height:1.6;font-family:Arial,sans-serif">' +
      '<b>Hướng dẫn:</b> Chia sẻ link trên — khi khách mua gói Trọn đời, hoa hồng tự động được ghi nhận trong vòng 30 ngày kể từ lần nhấp cuối cùng. Đăng nhập vào dashboard CTV để theo dõi tiến độ và yêu cầu thanh toán.' +
    '</div>';
  const html = buildEmailHtml({
    iconBg: '#e6fcf5', iconColor: '#099268', iconChar: '★',
    title: 'Chào mừng bạn gia nhập đội ngũ CTV!',
    bodyHtml: bodyHtml,
    ctaText: 'Vào dashboard CTV', ctaUrl: (data.siteUrl || SITE_URL) + '/ctv-dashboard',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 15. CTV: Có khách đăng ký qua link ──────────────────────────────────────
// Payload: { type, toEmail, ctvName, clientEmail, siteUrl }
function handleCTVNewSignup(data) {
  const subject = 'Có khách hàng mới đăng ký qua link của bạn';
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.ctvName || data.toEmail) + '</b>, có khách hàng mới vừa đăng ký tài khoản qua link giới thiệu của bạn.</p>' +
    _fieldTable(
      _fieldRow('Email khách', _esc(data.clientEmail || '')) +
      _fieldRow('Thời gian', _nowStr())
    ) +
    '<div style="background:#fffbea;border:1px solid #f0d060;border-radius:10px;padding:12px 14px;font-size:13px;color:#856404;line-height:1.6;font-family:Arial,sans-serif">Hoa hồng sẽ được ghi nhận khi khách nâng cấp lên gói <b>Trọn đời</b>. Hãy tiếp tục chia sẻ link để có thêm cơ hội!</div>';
  const html = buildEmailHtml({
    iconBg: '#e8f4fd', iconColor: '#1c7ed6', iconChar: '✦',
    title: 'Khách mới đăng ký qua link của bạn',
    bodyHtml: bodyHtml,
    ctaText: 'Xem dashboard CTV', ctaUrl: (data.siteUrl || SITE_URL) + '/ctv-dashboard',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 16. CTV: Được ghi nhận hoa hồng ─────────────────────────────────────────
// Payload: { type, toEmail, ctvName, clientEmail, amount, siteUrl }
function handleCTVCommissionEarned(data) {
  const subject = 'Bạn vừa được ghi nhận hoa hồng';
  const amtStr = data.amount ? Number(data.amount).toLocaleString('vi-VN') + 'đ' : '';
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.ctvName || data.toEmail) + '</b>, khách hàng của bạn vừa mua gói <b>Trọn đời</b>. Hoa hồng đã được ghi nhận vào tài khoản CTV của bạn.</p>' +
    _fieldTable(
      _fieldRow('Email khách', _esc(data.clientEmail || '')) +
      (amtStr ? _fieldRow('Hoa hồng', '<b style="color:#099268">' + amtStr + '</b>') : '') +
      _fieldRow('Trạng thái', 'Đang chờ thanh toán') +
      _fieldRow('Thời gian', _nowStr())
    ) +
    '<div style="background:#e6fcf5;border:1px solid #b2f2dd;border-radius:10px;padding:12px 14px;font-size:13px;color:#0f6e56;line-height:1.6;font-family:Arial,sans-serif">Vào dashboard CTV để xem lịch sử hoa hồng và yêu cầu thanh toán khi cần.</div>';
  const html = buildEmailHtml({
    iconBg: '#e6fcf5', iconColor: '#099268', iconChar: '✓',
    title: 'Hoa hồng đã được ghi nhận!',
    bodyHtml: bodyHtml,
    ctaText: 'Xem dashboard CTV', ctaUrl: (data.siteUrl || SITE_URL) + '/ctv-dashboard',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 17. CTV: Khách bị tạm khóa ──────────────────────────────────────────────
// Payload: { type, toEmail, ctvName, clientEmail, siteUrl }
function handleCTVClientKicked(data) {
  const subject = 'Thông báo: Khách hàng của bạn bị tạm khóa';
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.ctvName || data.toEmail) + '</b>, tài khoản của một khách hàng bạn giới thiệu đã bị tạm khóa.</p>' +
    _fieldTable(
      _fieldRow('Email khách', _esc(data.clientEmail || '')) +
      _fieldRow('Thời gian', _nowStr())
    ) +
    '<div style="background:#fff5f5;border:1px solid #ffe3e3;border-radius:10px;padding:12px 14px;font-size:13px;color:#c92a2a;line-height:1.6;font-family:Arial,sans-serif">Hoa hồng đã được duyệt trước đó (nếu có) <b>vẫn được giữ nguyên</b>. Nếu có thắc mắc, vui lòng liên hệ bộ phận hỗ trợ.</div>';
  const html = buildEmailHtml({
    iconBg: '#fff5f5', iconColor: '#dc3545', iconChar: '!',
    title: 'Khách hàng của bạn bị tạm khóa',
    bodyHtml: bodyHtml,
    ctaText: 'Xem dashboard CTV', ctaUrl: (data.siteUrl || SITE_URL) + '/ctv-dashboard',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 18. CTV: Khách bị xóa vĩnh viễn ────────────────────────────────────────
// Payload: { type, toEmail, ctvName, clientEmail, siteUrl }
function handleCTVClientDeleted(data) {
  const subject = 'Thông báo: Khách hàng của bạn đã bị xóa';
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.ctvName || data.toEmail) + '</b>, tài khoản của một khách hàng bạn giới thiệu đã bị xóa vĩnh viễn khỏi hệ thống.</p>' +
    _fieldTable(
      _fieldRow('Email khách', _esc(data.clientEmail || '')) +
      _fieldRow('Thời gian', _nowStr())
    ) +
    '<div style="background:#fff5f5;border:1px solid #ffe3e3;border-radius:10px;padding:12px 14px;font-size:13px;color:#c92a2a;line-height:1.6;font-family:Arial,sans-serif">Hoa hồng đã được duyệt trước đó (nếu có) <b>vẫn được giữ nguyên</b>. Nếu có thắc mắc, vui lòng liên hệ bộ phận hỗ trợ.</div>';
  const html = buildEmailHtml({
    iconBg: '#fff5f5', iconColor: '#dc3545', iconChar: '✕',
    title: 'Khách hàng của bạn đã bị xóa',
    bodyHtml: bodyHtml,
    ctaText: 'Xem dashboard CTV', ctaUrl: (data.siteUrl || SITE_URL) + '/ctv-dashboard',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 19. ADMIN: CTV yêu cầu thanh toán gấp ───────────────────────────────────
// Payload: { type, ctvName, toCTVEmail, amount, code, siteUrl }
function handleCTVUrgentPayment(data) {
  const subject = 'CTV yêu cầu thanh toán gấp';
  const amtStr = data.amount ? Number(data.amount).toLocaleString('vi-VN') + 'đ' : '';
  const rowsHtml =
    _fieldRow('Họ tên CTV', _esc(data.ctvName || '')) +
    _fieldRow('Email CTV', _esc(data.toCTVEmail || '')) +
    _fieldRow('Mã CTV', _esc(data.code || '')) +
    (amtStr ? _fieldRow('Số tiền chờ TT', '<b>' + amtStr + '</b>') : '') +
    _fieldRow('Thời gian', _nowStr());
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Có CTV vừa gửi yêu cầu thanh toán khẩn cấp. Vui lòng xử lý trong vòng 24 giờ.</p>' +
    _fieldTable(rowsHtml);
  const html = buildEmailHtml({
    iconBg: '#fffbea', iconColor: '#d97706', iconChar: '◷',
    title: 'Yêu cầu thanh toán gấp từ CTV',
    bodyHtml: bodyHtml,
    ctaText: 'Vào trang quản trị', ctaUrl: (data.siteUrl || SITE_URL) + '/admin.html',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(ADMIN_EMAIL, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 20. CTV: Tài khoản bị kick ──────────────────────────────────────────────
// Payload: { type, toEmail, ctvName, reason, siteUrl }
function handleCTVKicked(data) {
  const subject = 'Thông báo: Tài khoản CTV của bạn đang bị tạm khoá';
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.ctvName || data.toEmail) + '</b>, tài khoản CTV của bạn đã bị tạm khoá bởi quản trị viên.</p>' +
    (data.reason ? _fieldTable(_fieldRow('Lý do', _esc(data.reason))) : '') +
    '<div style="background:#fff5f5;border:1px solid #ffe3e3;border-radius:10px;padding:12px 14px;font-size:13px;color:#c92a2a;line-height:1.6;font-family:Arial,sans-serif">Hoa hồng đã phát sinh trước đó <b>vẫn được giữ nguyên và thanh toán đầy đủ</b>. Nếu bạn cho rằng đây là sự nhầm lẫn, vui lòng liên hệ bộ phận hỗ trợ.</div>';
  const html = buildEmailHtml({
    iconBg: '#fff5f5', iconColor: '#dc3545', iconChar: '!',
    title: 'Tài khoản CTV của bạn đang bị tạm khoá',
    bodyHtml: bodyHtml,
    ctaText: 'Liên hệ hỗ trợ', ctaUrl: (data.siteUrl || SITE_URL),
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 21. CTV: Tài khoản bị xoá vĩnh viễn ────────────────────────────────────
// Payload: { type, toEmail, ctvName, siteUrl }
function handleCTVDeletedPermanently(data) {
  const subject = 'Thông báo: Tài khoản CTV của bạn đã bị xoá';
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.ctvName || data.toEmail) + '</b>, tài khoản CTV của bạn đã bị xoá vĩnh viễn khỏi hệ thống.</p>' +
    '<div style="background:#fff5f5;border:1px solid #ffe3e3;border-radius:10px;padding:12px 14px;font-size:13px;color:#c92a2a;line-height:1.6;font-family:Arial,sans-serif">Hoa hồng đã được duyệt và thanh toán trước đó <b>không bị ảnh hưởng</b>. Bạn có thể đăng ký lại chương trình CTV nếu muốn tiếp tục hợp tác.</div>';
  const html = buildEmailHtml({
    iconBg: '#fff5f5', iconColor: '#dc3545', iconChar: '✕',
    title: 'Tài khoản CTV của bạn đã bị xoá',
    bodyHtml: bodyHtml,
    ctaText: 'Đăng ký lại CTV', ctaUrl: (data.siteUrl || SITE_URL) + '/ctv',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 22. CTV: Tài khoản được thêm lại ────────────────────────────────────────
// Payload: { type, toEmail, ctvName, ctvCode, affiliateLink, note, siteUrl }
function handleCTVReadded(data) {
  const subject = 'Tài khoản CTV của bạn đã được kích hoạt lại';
  const link = data.affiliateLink || ((data.siteUrl || SITE_URL) + '?r=' + _esc(data.ctvCode || ''));
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.ctvName || data.toEmail) + '</b>, tài khoản CTV của bạn đã được kích hoạt lại. Bạn có thể tiếp tục sử dụng dashboard và chia sẻ link giới thiệu.</p>' +
    (data.note ? '<div style="background:#f8f9fa;border-left:3px solid #c9a84c;border-radius:0 8px 8px 0;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#495057;font-family:Arial,sans-serif"><b>Ghi chú từ admin:</b> ' + _esc(data.note) + '</div>' : '') +
    _fieldTable(_fieldRow('Mã CTV', '<span style="font-family:monospace;font-weight:900;font-size:15px;color:#d97706">' + _esc(data.ctvCode || '') + '</span>') + _fieldRow('Link giới thiệu', '<a href="' + link + '" style="color:#2563eb">' + link.replace('https://','') + '</a>'));
  const html = buildEmailHtml({
    iconBg: '#e6fcf5', iconColor: '#099268', iconChar: '★',
    title: 'Tài khoản CTV đã được kích hoạt lại',
    bodyHtml: bodyHtml,
    ctaText: 'Đăng nhập ngay', ctaUrl: (data.siteUrl || SITE_URL) + '/ctv',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 24. THÔNG BÁO USER: đã nhận yêu cầu nâng cấp ───────────────────────────
// Gửi khi: user free bấm "Tôi đã thanh toán" (_doUpgradeRequestInternal trong auth.js)
// Payload: { type, toEmail, userName, siteUrl }
function handleUpgradeRequestReceived(data) {
  const subject = 'Đã nhận yêu cầu nâng cấp của bạn';
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.userName || data.toEmail) + '</b>,</p>' +
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Chúng tôi đã nhận được yêu cầu nâng cấp lên gói <b>Trọn đời</b> của bạn. Admin sẽ xác nhận trong vòng <b>24 giờ</b> và gửi email thông báo khi tài khoản được kích hoạt.</p>' +
    '<div style="background:#fffbea;border:1px solid #f0d060;border-radius:10px;padding:12px 14px;font-size:13px;color:#856404;line-height:1.6;font-family:Arial,sans-serif">Bạn có thể theo dõi trạng thái ngay trên trang tài khoản — đăng nhập và nhìn vào phần trạng thái gói dịch vụ phía trên màn hình.</div>';
  const html = buildEmailHtml({
    iconBg: '#fffbea', iconColor: '#d97706', iconChar: '◷',
    title: 'Đã nhận yêu cầu nâng cấp của bạn',
    bodyHtml: bodyHtml,
    ctaText: 'Xem trạng thái tài khoản', ctaUrl: (data.siteUrl || SITE_URL) + '/copy-drive',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── MỚI: THÔNG BÁO USER: đã dùng hết lượt Dùng thử ─────────────────────────
// Gửi khi: showComplModal() với plan=trial (sau 1 lần copy hoàn tất)
// Payload: { type, toEmail, userName, siteUrl }
function handleTrialUsedUp(data) {
  const subject = 'Bạn đã dùng hết lượt Dùng thử';
  const bodyHtml =
    '<p style="margin:0 0 10px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.userName || data.toEmail) + '</b>,</p>' +
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Bạn vừa hoàn thành lượt sao chép Dùng thử trên ' + SITE_NAME + '. Tài khoản của bạn đã được khoá sau 1 lần sử dụng — theo đúng điều khoản gói Dùng thử.</p>' +
    '<div style="background:#fff5f5;border:1px solid #ffe3e3;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-family:Arial,sans-serif">' +
      '<p style="margin:0;font-size:13px;color:#c0392b;line-height:1.6">Để tiếp tục sao chép dữ liệu Drive, bạn cần nâng cấp tài khoản.</p>' +
    '</div>' +
    '<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#495057">Chọn gói phù hợp với nhu cầu của bạn trong trang dashboard — <b>Ngắn hạn</b> (39.000đ/3 lượt) hoặc <b>Trọn đời</b> (290.000đ, không giới hạn mãi mãi).</p>';
  const html = buildEmailHtml({
    iconBg: '#fffbea', iconColor: '#d97706', iconChar: '◷',
    title: 'Lượt Dùng thử đã hết',
    bodyHtml: bodyHtml,
    ctaText: 'Xem gói nâng cấp', ctaUrl: (data.siteUrl || SITE_URL) + '/copy-drive',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── MỚI: THÔNG BÁO USER: đã dùng hết lượt Ngắn hạn ─────────────────────────
// Gửi khi: showComplModal() với plan=credit và creditsRemaining==0 sau khi trừ
// Payload: { type, toEmail, userName, siteUrl }
function handleCreditUsedUp(data) {
  const subject = 'Bạn đã dùng hết lượt Ngắn hạn';
  const bodyHtml =
    '<p style="margin:0 0 10px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.userName || data.toEmail) + '</b>,</p>' +
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Bạn vừa dùng hết toàn bộ lượt sao chép trong gói <b>Ngắn hạn</b> trên ' + SITE_NAME + '.</p>' +
    '<div style="background:#fff5f5;border:1px solid #ffe3e3;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-family:Arial,sans-serif">' +
      '<p style="margin:0;font-size:13px;color:#c0392b;line-height:1.6">Nút "Bắt đầu sao chép" sẽ bị khoá cho đến khi bạn mua thêm lượt hoặc nâng cấp lên Trọn đời.</p>' +
    '</div>' +
    '<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#495057">Mua thêm <b>3 lượt (39.000đ)</b> hoặc nâng lên <b>Trọn đời (290.000đ)</b> để tiếp tục sử dụng không giới hạn.</p>';
  const html = buildEmailHtml({
    iconBg: '#fff5f5', iconColor: '#dc3545', iconChar: '!',
    title: 'Hết lượt Ngắn hạn',
    bodyHtml: bodyHtml,
    ctaText: 'Mua thêm lượt', ctaUrl: (data.siteUrl || SITE_URL) + '/copy-drive',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── MỚI: THÔNG BÁO ADMIN: user yêu cầu mua lượt Ngắn hạn ───────────────────
// Gửi khi: user bấm "Tôi đã chuyển khoản" trong #planLockedModal (credit flow)
// Payload: { type, toEmail (admin), userName, userEmail, plan, siteUrl }
function handleCreditPurchaseRequest(data) {
  const subject = 'Yêu cầu mua lượt Ngắn hạn mới';
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Có yêu cầu mua lượt Ngắn hạn mới từ một user:</p>' +
    _fieldTable([
      { label: 'Email', value: data.userEmail || data.userName || '—' },
      { label: 'Tên', value: data.userName || '—' },
      { label: 'Gói hiện tại', value: data.plan || 'credit' },
    ]) +
    '<p style="margin:14px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#495057">Vào trang quản trị để duyệt yêu cầu và thêm 3 lượt cho user này.</p>';
  const html = buildEmailHtml({
    iconBg: '#fffbea', iconColor: '#d97706', iconChar: '◷',
    title: 'Yêu cầu mua lượt Ngắn hạn',
    bodyHtml: bodyHtml,
    ctaText: 'Vào trang quản trị', ctaUrl: (data.siteUrl || SITE_URL) + '/admin.html',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(ADMIN_EMAIL, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── MỚI: THÔNG BÁO USER: admin đã thêm lượt Ngắn hạn ───────────────────────
// Gửi khi: admin bấm "Duyệt +3 lượt" hoặc "+3 Lượt" trong admin.html
// Payload: { type, toEmail, userName, creditsAdded, creditsTotal, siteUrl }
function handleCreditAdded(data) {
  const added = data.creditsAdded || 3;
  const total = data.creditsTotal;
  const subject = 'Đã thêm ' + added + ' lượt sao chép vào tài khoản của bạn';
  const bodyHtml =
    '<p style="margin:0 0 10px;font-family:Arial,sans-serif">Xin chào <b>' + _esc(data.userName || data.toEmail) + '</b>,</p>' +
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">Admin vừa thêm <b>' + added + ' lượt</b> sao chép vào tài khoản <b>Ngắn hạn</b> của bạn trên ' + SITE_NAME + '.</p>' +
    (total != null ? '<div style="background:#e6fcf5;border:1px solid #c3fae8;border-radius:10px;padding:12px 14px;margin-bottom:14px;text-align:center;font-family:Arial,sans-serif">' +
      '<p style="margin:0;font-size:24px;font-weight:800;color:#099268">' + total + ' lượt</p>' +
      '<p style="margin:4px 0 0;font-size:12.5px;color:#0f6e56">Lượt còn lại trong tài khoản</p>' +
    '</div>' : '') +
    '<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#495057">Vào dashboard để bắt đầu sao chép ngay.</p>';
  const html = buildEmailHtml({
    iconBg: '#e6fcf5', iconColor: '#099268', iconChar: '✓',
    title: 'Đã thêm ' + added + ' lượt sao chép',
    bodyHtml: bodyHtml,
    ctaText: 'Vào dashboard', ctaUrl: (data.siteUrl || SITE_URL) + '/copy-drive',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(data.toEmail, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── 23. ADMIN: CTV đã bị kick vẫn cố đăng nhập ──────────────────────────────
// Payload: { type, ctvName, ctvEmail, ctvCode, siteUrl }
function handleCTVKickAlert(data) {
  const subject = 'CTV đã bị kick vẫn cố đăng nhập';
  const rowsHtml =
    _fieldRow('Họ tên CTV', _esc(data.ctvName || '')) +
    _fieldRow('Email CTV', _esc(data.ctvEmail || '')) +
    _fieldRow('Mã CTV', _esc(data.ctvCode || '')) +
    _fieldRow('Thời gian', _nowStr());
  const bodyHtml =
    '<p style="margin:0 0 14px;font-family:Arial,sans-serif">CTV dưới đây đang bị khoá nhưng vừa cố đăng nhập vào hệ thống.</p>' +
    _fieldTable(rowsHtml);
  const html = buildEmailHtml({
    iconBg: '#fff5f5', iconColor: '#dc3545', iconChar: '!',
    title: 'CTV đã bị kick vẫn cố đăng nhập',
    bodyHtml: bodyHtml,
    ctaText: 'Vào trang quản trị', ctaUrl: (data.siteUrl || SITE_URL) + '/admin.html',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(ADMIN_EMAIL, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}

// ── THÔNG BÁO ADMIN: user tự xoá tài khoản ──────────────────────────
// Gửi khi: user bấm "Xoá vĩnh viễn" trong dashboard.html
// Payload: { type, userEmail, userName, plan, siteUrl }
function handleAdminSelfDeleteNotice(data) {
  const subject = 'Một người dùng vừa tự xoá tài khoản';
  const bodyHtml =
    '<p style="margin:0 0 10px;font-family:Arial,sans-serif">Người dùng dưới đây đã tự thực hiện xoá tài khoản của họ ngay trên dashboard, không thông qua admin.</p>' +
    _fieldTable(
      _fieldRow('Họ tên', data.userName || data.userEmail) +
      _fieldRow('Email', data.userEmail) +
      _fieldRow('Gói đang dùng', data.plan === 'paid' ? 'Trọn đời' : 'Miễn phí') +
      _fieldRow('Thời gian xoá', _nowStr())
    ) +
    '<div style="margin-top:16px;background:#fff5f5;border:1px solid #ffe3e3;border-radius:8px;padding:12px 14px;font-size:12.5px;color:#a32d2d;font-family:Arial,sans-serif;line-height:1.6">Lưu lại email này để đối chiếu nếu sau này người dùng liên hệ hỏi về việc tài khoản bị mất quyền truy cập.</div>';
  const html = buildEmailHtml({
    iconBg: '#fff5f5', iconColor: '#a32d2d', iconChar: '!',
    title: 'Một người dùng vừa tự xoá tài khoản',
    bodyHtml: bodyHtml,
    ctaText: 'Vào trang quản trị', ctaUrl: (data.siteUrl || SITE_URL) + '/admin.html',
    ctaBg: '#ffc107', ctaColor: '#212529'
  });
  GmailApp.sendEmail(ADMIN_EMAIL, subject, '', { htmlBody: html, name: 'SwiftCopy.Drive' });
}
