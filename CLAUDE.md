# SwiftCopy.Drive — CLAUDE.md

Đọc file này trước khi làm bất cứ điều gì. Đây là brief kỹ thuật đầy đủ cho dự án.

---

## Dự án là gì

Web app cho phép sao chép thư mục Google Drive (kể cả Shared Drive) sang Drive khác — không cần tải về máy rồi tải lên lại. Chạy 100% trên trình duyệt, không có backend riêng.

**Mô hình kinh doanh:** Mua 1 lần dùng trọn đời. Khách thanh toán ngoài hệ thống (Zalo/email), admin vào `admin.html` bấm "Kích hoạt" thủ công.

---

## Stack kỹ thuật — KHÔNG thay đổi trừ khi được yêu cầu rõ ràng

| Lớp | Công nghệ |
|---|---|
| UI | Tailwind CSS qua CDN (`cdn.tailwindcss.com`) — KHÔNG dùng build/compile |
| Auth | Firebase Authentication v10.12.0 (CDN ESM), Google OAuth |
| Database | Firebase Firestore v10.12.0 |
| File operations | Google Drive API v3, gọi thẳng bằng `fetch`, KHÔNG dùng SDK |
| Email | Google Apps Script Web App — `gas-email.js` deploy lên script.google.com |
| Font | Google Fonts — Nunito + Nunito Sans |
| Deploy | Vercel (auto-deploy khi push lên GitHub), sắp mua domain .com |
| Build tool | Không có — zero-build |

---

## Cấu trúc file

```
SwiftCopy.Drive/
├── index.html          ← App chính (~585 dòng): landing + dashboard người dùng (HTML thuần)
├── style.css           ← Toàn bộ CSS tùy biến (tách từ index.html)
├── app.js              ← Firebase, Drive API, copy logic (ES module, ~1159 dòng)
├── ui.js               ← Modal, FAQ, review, preview animation (~330 dòng)
├── admin.html          ← Trang quản trị (~510 dòng): duyệt user, kick, re-add
├── legal.html          ← Trang chính sách — 1 file xử lý 3 route: /dieu-khoan, /bao-mat, /hoan-tien
├── legal/
│   ├── dieu-khoan.txt  ← Nội dung "Điều khoản sử dụng" (plain text)
│   ├── bao-mat.txt     ← Nội dung "Chính sách bảo mật" (plain text)
│   └── hoan-tien.txt   ← Nội dung "Chính sách hoàn tiền" (plain text)
├── gas-email.js        ← Code Google Apps Script — deploy lên script.google.com để gửi email
├── vercel.json         ← Rewrite rules: /copy-drive → index.html; 3 legal routes → legal.html
├── zalo-qr.png         ← Ảnh QR Zalo hỗ trợ (400×400px, đã crop sạch)
├── favicon.svg         ← Logo SVG gốc
├── favicon-32.png      ← Favicon 32×32
├── favicon.ico         ← Favicon multi-size
├── apple-touch-icon.png ← Icon iOS 180×180
└── CLAUDE.md           ← File này
```

**Khi cập nhật nội dung chính sách:** chỉ cần sửa file `.txt` tương ứng trong `legal/` — KHÔNG đụng vào code `legal.html`.

**`index.html` và `admin.html` độc lập hoàn toàn** — không import lẫn nhau, không share component. Nếu sửa config chung (firebaseConfig, ADMIN_EMAIL) phải sửa ở CẢ HAI file.

---

## Cấu trúc bên trong index.html (sau khi tách file)

### HTML (~585 dòng — chỉ còn HTML thuần)
- `<head>`: Tailwind CDN, favicon, `<link rel="stylesheet" href="style.css">`
- SVG sprite: icon dùng lại qua `<use href="#ic-...">`
- 4 section: `#s-land` (landing), `#s-check` (đang kiểm tra auth), `#s-pend` (chờ duyệt), `#s-app` (dashboard thật)
- Các modal overlay: `#modalOv`, `#vidWarnOv`, `#complOv`, `#langModal`, `#supportModal`, `#earnModal`, `#addReviewModal` (gộp list + form), `#reviewListModal` (giữ lại nhưng không dùng), `#faqModal`, `#policyModal` (dùng chung cho 3 chính sách), `#policyAndReviewModal` (hub từ header), `#pvFullscreenOverlay`
- Preview Dashboard: `id="pvCard"` — animation minh hoạ cho khách chưa đăng nhập
- Cuối body: `<script type="module" src="app.js"></script>` + `<script src="ui.js"></script>`

### app.js — ES module (~1159 dòng)
Nhóm hàm chính:
- **Firebase/Auth**: `onAuthStateChanged`, `ensureUser`, `checkApproval`, `doLogin`, `doLogout`, `reAuth`
- **Drive API wrapper**: `dget`, `dpost`, `ddel`, `fid`, `fname`, `listItems`, `existNames`, `copyFileSingle`, `mkFolder` — có retry exponential backoff cho 429/500/503
- **Auth expiry**: `isAuthExpiredErr`, `handleAuthExpired` — xử lý 401 giữa chừng, tự resume sau khi reauth
- **Checklist**: `loadChecklist`, `renderChecklist` — cây thư mục lazy-load, checkbox 3 trạng thái
- **Scan**: `startScan`, `scanNodes` — test quyền bằng copy-thử-rồi-xóa ngay
- **Copy**: `startCopy`, `_runCopyInternal`, `copyRecTree` — đa luồng (CONCUR=8 file, FOLDER_CONCUR=3)
- **Progress**: `progStart`, `progInc`, `progFinish` — indeterminate mode, không pre-scan
- **Session/resume**: `saveSession`, `checkResume`, `resumeSession` — lưu localStorage key `swiftcopy_session`
- **UI helpers**: `sec`, `setBtnMode`, `setStatus`, `addLog`, `updStats`, `toast` (expose qua `window.toast`)

### ui.js — script thường (~330 dòng)
- Dữ liệu tĩnh: `initialReviews` (8 đánh giá mẫu), `adminFaqData` (7 câu FAQ), `policyData` (3 chính sách)
- Hàm modal: `openFaqModal`, `openPolicyModal(type)`, `openPolicyAndReviewModal`, `switchToPolicyModal(type)`, `switchToReviewModal`, `renderReviewsInAddModal`, `openReviewListModal` (không còn gọi từ UI)
- Hàm đánh giá: `setReviewStars`, `updateStarUI`, `submitReviewForm`, `anonymizeUserEmail`
- IIFE animation Preview Dashboard: chạy vô hạn, STEP_MS=250ms, tự pause khi modal mở

### Trang chính sách — legal.html
- 1 file duy nhất phục vụ 3 route: `/dieu-khoan`, `/bao-mat`, `/hoan-tien`
- JS đọc `location.pathname`, map sang `const TEXT_*` được nhúng thẳng trong file, render vào `#pageContent` — **KHÔNG dùng fetch()**
- Style độc lập với index.html (không dùng Tailwind CDN) — chỉ dùng Google Fonts Nunito + màu thương hiệu #ffc107, #dc3545
- **Để cập nhật nội dung chính sách:** sửa file `.txt` tương ứng trong `legal/`, sau đó nhờ Claude Code đọc lại file txt và cập nhật 3 const `TEXT_DIEU_KHOAN`, `TEXT_BAO_MAT`, `TEXT_HOAN_TIEN` trong `legal.html`

**Cách link đến trang chính sách:**
- Footer và `#policyAndReviewModal` trong index.html dùng `<a href="/dieu-khoan">` v.v. — điều hướng thật, không mở modal

### style.css (~257 dòng)
- Toàn bộ CSS tùy biến: animation, modal, checklist, progress bar, log box, tree, toast, v.v.

---

## Email system — Google Apps Script

Email được gửi qua GAS Web App (không còn dùng EmailJS). Endpoint là URL bí mật từ script.google.com.

**File GAS:** `gas-email.js` — dán vào https://script.google.com → Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).

**Cập nhật GAS_URL khi đổi endpoint:**
- Trong `app.js`: sửa `const GAS_URL = '...'` ở đầu file (dòng 17)
- Trong `admin.html`: sửa `const GAS_URL = '...'` trong `<script type="module">` (khoảng dòng 275)
- Hai file phải dùng cùng một GAS_URL
- **KHÔNG commit GAS_URL lên GitHub** — URL là bí mật (hoạt động như API key)

**5 loại email GAS xử lý:**
| type | Người nhận | Khi nào |
|---|---|---|
| `new_user` | Admin | User lần đầu đăng ký |
| `kick_alert` | Admin | User bị kick đang cố đăng nhập lại |
| `approve` | User | Admin bấm "Kích hoạt" |
| `kick` | User | Admin bấm "Kick" |
| `readd` | User | Admin bấm "Thêm lại" |

---

## Các hằng số quan trọng

```js
// Trong index.html và admin.html (phải khớp nhau)
const ADMIN_EMAIL = "hgntran.contact@gmail.com";

// Concurrency
const CONCUR = 8;              // file song song khi copy
const FOLDER_CONCUR = 3;       // thư mục song song khi copy
const SCAN_FILE_CONCUR = 8;    // file song song khi scan
const SCAN_FOLDER_CONCUR = 4;  // thư mục song song khi scan

// Session
const SESSION_TTL = 120 * 60 * 1000; // 120 phút, tự xóa nếu cũ hơn
```

---

## Quy tắc KHÔNG được vi phạm

1. **KHÔNG chuyển sang React, Vue, hay bất kỳ framework JS nào** — đây là quyết định kiến trúc cố ý, không thay đổi.
2. **KHÔNG thêm build step hay package.json** — deploy phải là `git push` thuần, không cần `npm install`.
3. **KHÔNG dùng Tailwind CLI hay PostCSS** — chỉ dùng Tailwind CDN.
4. **KHÔNG tự ý sửa firebaseConfig hoặc ADMIN_EMAIL** — đây là credentials thật đang chạy production.
5. **KHÔNG xóa hoặc đổi tên các hàm Drive API wrapper** (`dget`, `dpost`, `ddel`...) — chúng được gọi ở nhiều chỗ.
6. **KHÔNG tự ý sửa Firestore Security Rules** — phải có yêu cầu rõ ràng từ owner.
7. **Khi sửa CSS, ưu tiên inline style hoặc class Tailwind có sẵn** — tránh thêm class mới vào `<style>` trừ khi thật sự cần.
8. **Khi render HTML động bằng JS** (FAQ, review...), dùng **inline style** cho các thuộc tính ảnh hưởng đến kích thước/vị trí — KHÔNG dùng Tailwind class động vì Tailwind CDN có thể compile chậm hơn JS chạy, gây đo sai chiều cao.
9. **Quy tắc link bắt buộc — áp dụng cho mọi code mới:**
   - **Route nội bộ có URL thật** (ví dụ `/copy-drive`, `/dieu-khoan`, `/bao-mat`, `/hoan-tien`, `/admin`): dùng `<a href="/route">` — KHÔNG dùng `<span onclick>` hay `<div onclick>` để điều hướng.
   - **Link ra ngoài** (Facebook, Gmail, domain khác): dùng `<a href="..." target="_blank" rel="noopener">`.
   - **Mở modal popup** (FAQ, Đánh giá, Affiliate...): vẫn dùng `<button onclick>` hoặc `<span onclick>` — vì modal không có URL riêng, không cần `<a href>`.

---

## Các lỗi đã gặp — không lặp lại

- **Chiều cao modal FAQ/review không ổn định**: do đo `offsetTop` khi container chưa có `position:relative`, hoặc đo trước khi Tailwind CDN kịp compile class. Fix: dùng `position:relative` trên container + `requestAnimationFrame` double-tick + inline style thay vì Tailwind class cho padding/margin của item.
- **Tràn ngang layout**: Grid item thiếu `min-w-0`. Luôn thêm `min-w-0` vào grid children.
- **Animation Preview Dashboard lag khi mở modal**: fix bằng `anyModalOpen()` check trong `tick()`, và STEP_MS=250 (không để 90).
- **Stats hiển thị dữ liệu phiên cũ sau Reset**: fix bằng gọi `updStats()` ngay sau `stats=ns()` trong `doReset()` và đầu `startScan()`.

---

## Trạng thái hiện tại (để tiếp tục đúng chỗ)

- **Đang deploy**: Vercel — domain tạm thời là URL Vercel, sắp mua domain .com
- **CI/CD**: Vercel tự động deploy khi push lên GitHub (repo vẫn giữ nguyên)
- **Firestore Security Rules**: CHƯA siết — đây là rủi ro bảo mật cao nhất, cần làm trước khi mở rộng user base
- **Cổng thanh toán**: chưa có, duyệt thủ công qua admin.html
- **Đa ngôn ngữ VI/EN**: chưa implement, bấm VI/EN hiện popup "Tính năng chưa hỗ trợ"
- **Review/FAQ**: dữ liệu tĩnh trong JS, chưa nối Firestore thật
- **zalo-qr.png**: ảnh thật (đã crop), phải nằm cùng thư mục với index.html khi deploy

---

## Khi nhận task mới

1. Đọc CLAUDE.md này trước (đã xong nếu bạn đang đọc đây).
2. Đọc phần code liên quan (`index.html`, `app.js`, `ui.js`, `style.css`) trước khi sửa.
3. Sau khi sửa: kiểm tra JS syntax, kiểm tra duplicate ID, kiểm tra tag balance `<div>`.
4. Không giải trình dài dòng — làm xong báo cáo ngắn gọn những gì đã thay đổi và tại sao.
5. Nếu task ảnh hưởng đến cả `admin.html`, nêu rõ và sửa cả hai file.
