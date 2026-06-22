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
| Email | EmailJS `@emailjs/browser` v3 (CDN) |
| Font | Google Fonts — Nunito + Nunito Sans |
| Deploy | GitHub Pages (static), sắp chuyển sang Vercel |
| Build tool | Không có — zero-build |

---

## Cấu trúc file

```
SwiftCopy.Drive/
├── index.html          ← App chính (~2280 dòng): landing + dashboard người dùng
├── admin.html          ← Trang quản trị (~515 dòng): duyệt user, kick, re-add
├── zalo-qr.png         ← Ảnh QR Zalo hỗ trợ (400×400px, đã crop sạch)
├── favicon.svg         ← Logo SVG gốc
├── favicon-32.png      ← Favicon 32×32
├── favicon.ico         ← Favicon multi-size
├── apple-touch-icon.png ← Icon iOS 180×180
└── CLAUDE.md           ← File này
```

**`index.html` và `admin.html` độc lập hoàn toàn** — không import lẫn nhau, không share component. Nếu sửa config chung (firebaseConfig, ADMIN_EMAIL) phải sửa ở CẢ HAI file.

---

## Cấu trúc bên trong index.html

### HTML (dòng ~1–820)
- `<head>`: Tailwind CDN, Google Fonts, favicon, toàn bộ `<style>` tùy biến
- SVG sprite: icon dùng lại qua `<use href="#ic-...">`
- 4 section: `#s-land` (landing), `#s-check` (đang kiểm tra auth), `#s-pend` (chờ duyệt), `#s-app` (dashboard thật)
- Các modal overlay: `#modalOv`, `#vidWarnOv`, `#complOv`, `#langModal`, `#supportModal`, `#earnModal`, `#addReviewModal`, `#reviewListModal`, `#faqModal`, `#pvFullscreenOverlay`
- Preview Dashboard: `id="pvCard"` — animation minh hoạ cho khách chưa đăng nhập

### JavaScript module (dòng ~820–1980)
Nhóm hàm chính:
- **Firebase/Auth**: `onAuthStateChanged`, `ensureUser`, `checkApproval`, `doLogin`, `doLogout`, `reAuth`
- **Drive API wrapper**: `dget`, `dpost`, `ddel`, `fid`, `fname`, `listItems`, `existNames`, `copyFileSingle`, `mkFolder` — có retry exponential backoff cho 429/500/503
- **Auth expiry**: `isAuthExpiredErr`, `handleAuthExpired` — xử lý 401 giữa chừng, tự resume sau khi reauth
- **Checklist**: `loadChecklist`, `renderChecklist` — cây thư mục lazy-load, checkbox 3 trạng thái
- **Scan**: `startScan`, `scanNodes` — test quyền bằng copy-thử-rồi-xóa ngay
- **Copy**: `startCopy`, `_runCopyInternal`, `copyRecTree` — đa luồng (CONCUR=8 file, FOLDER_CONCUR=3)
- **Progress**: `progStart`, `progInc`, `progFinish` — indeterminate mode, không pre-scan
- **Session/resume**: `saveSession`, `checkResume`, `resumeSession` — lưu localStorage key `swiftcopy_session`
- **UI helpers**: `sec`, `setBtnMode`, `setStatus`, `addLog`, `updStats`, `toast`

### JavaScript thường (dòng ~1980–2280)
- Dữ liệu tĩnh: `initialReviews` (8 đánh giá mẫu), `adminFaqData` (7 câu FAQ)
- Hàm demo UI: modal, FAQ accordion, đánh giá, preview animation
- IIFE animation Preview Dashboard: chạy vô hạn, STEP_MS=250ms, tự pause khi modal mở

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

---

## Các lỗi đã gặp — không lặp lại

- **Chiều cao modal FAQ/review không ổn định**: do đo `offsetTop` khi container chưa có `position:relative`, hoặc đo trước khi Tailwind CDN kịp compile class. Fix: dùng `position:relative` trên container + `requestAnimationFrame` double-tick + inline style thay vì Tailwind class cho padding/margin của item.
- **Tràn ngang layout**: Grid item thiếu `min-w-0`. Luôn thêm `min-w-0` vào grid children.
- **Animation Preview Dashboard lag khi mở modal**: fix bằng `anyModalOpen()` check trong `tick()`, và STEP_MS=250 (không để 90).
- **Stats hiển thị dữ liệu phiên cũ sau Reset**: fix bằng gọi `updStats()` ngay sau `stats=ns()` trong `doReset()` và đầu `startScan()`.

---

## Trạng thái hiện tại (để tiếp tục đúng chỗ)

- **Đang deploy**: GitHub Pages tại `https://hgntrancontact-glitch.github.io/swiftcopy-drive/`
- **Sắp chuyển**: Vercel (từ repo private)
- **Firestore Security Rules**: CHƯA siết — đây là rủi ro bảo mật cao nhất, cần làm trước khi mở rộng user base
- **Cổng thanh toán**: chưa có, duyệt thủ công qua admin.html
- **Đa ngôn ngữ VI/EN**: chưa implement, bấm VI/EN hiện popup "Tính năng chưa hỗ trợ"
- **Review/FAQ**: dữ liệu tĩnh trong JS, chưa nối Firestore thật
- **zalo-qr.png**: ảnh thật (đã crop), phải nằm cùng thư mục với index.html khi deploy

---

## Khi nhận task mới

1. Đọc CLAUDE.md này trước (đã xong nếu bạn đang đọc đây).
2. Đọc phần code liên quan trong `index.html` trước khi sửa.
3. Sau khi sửa: kiểm tra JS syntax, kiểm tra duplicate ID, kiểm tra tag balance `<div>`.
4. Không giải trình dài dòng — làm xong báo cáo ngắn gọn những gì đã thay đổi và tại sao.
5. Nếu task ảnh hưởng đến cả `admin.html`, nêu rõ và sửa cả hai file.
