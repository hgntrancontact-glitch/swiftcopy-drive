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
├── index.html          ← Landing page (~621 dòng): #s-land + #s-maintenance + toàn bộ auth modals
├── dashboard.html      ← Dashboard app (~684 dòng): #s-pend, #s-kicked, #s-app, #s-maintenance + copy modals
├── style.css           ← Toàn bộ CSS tùy biến (tách từ index.html)
├── state.js            ← Shared state object (st), constants, ns(), pausePoint() (~63 dòng)
├── drive-api.js        ← Drive API wrappers + video copy + semaphore (~185 dòng)
├── auth.js             ← Firebase init, auth flow, plan/payment, maintenance (~400 dòng)
├── app.js              ← Checklist, scan, copy, progress, UI helpers (ES module, ~1380 dòng)
├── ui.js               ← Modal, FAQ, review, preview animation (~330 dòng)
├── admin.html          ← Trang quản trị: duyệt user, kick, re-add; nút "Bảo trì" → admin-maintenance.html
├── admin-maintenance.html ← Trang bảo trì riêng: chọn mode, allowedEmails, lưu Firestore
├── legal.html          ← Trang chính sách — 1 file xử lý 3 route: /dieu-khoan, /bao-mat, /hoan-tien
├── legal/
│   ├── dieu-khoan.txt  ← Nội dung "Điều khoản sử dụng" (plain text)
│   ├── bao-mat.txt     ← Nội dung "Chính sách bảo mật" (plain text)
│   └── hoan-tien.txt   ← Nội dung "Chính sách hoàn tiền" (plain text)
├── api/
│   ├── email.js        ← Vercel serverless function — proxy email từ browser đến GAS (GAS_URL ẩn)
│   └── maintenance.js  ← Vercel serverless function — đọc settings/maintenance từ Firestore bằng service account (bypass Security Rules)
├── firestore.rules     ← Firestore Security Rules — paste vào Firebase Console → Firestore → Rules
├── gas-email.js        ← Code Google Apps Script — deploy lên script.google.com để gửi email
├── vercel.json         ← Rewrite rules: /copy-drive → dashboard.html; 3 legal routes → legal.html
├── zalo-qr.png         ← Ảnh QR Zalo hỗ trợ (400×400px, đã crop sạch)
├── og-image.png        ← Open Graph image 1200×630px — tạo bằng Python Pillow (gen script lưu ở scratchpad Claude, không commit vào repo)
├── favicon.svg         ← Logo SVG gốc
├── favicon-32.png      ← Favicon 32×32
├── favicon.ico         ← Favicon multi-size
├── apple-touch-icon.png ← Icon iOS 180×180 — cũng dùng làm logo badge trong og-image.png
└── CLAUDE.md           ← File này
```

**Khi cập nhật nội dung chính sách:** chỉ cần sửa file `.txt` tương ứng trong `legal/` — KHÔNG đụng vào code `legal.html`.

**`index.html` và `dashboard.html` đều load `app.js` + `ui.js`** — `IS_DASHBOARD = !!document.getElementById('s-app')` trong `state.js`.
- **index.html** xử lý toàn bộ auth flow: loginModal, planSelectModal, paymentModal, paymentConfirmModal, readdWelcomeModal đều nằm ở đây. Không có noAuthBackdrop/s-check/s-app.
- **dashboard.html** chỉ chứa app sections (#s-pend/kicked/app/maintenance), copy modals (modalOv/complOv/videoWarnModal/freeLimitModal), và paymentModal/paymentConfirmModal (cho upgrade flow từ freeBanner). Không có loginModal/planSelectModal/readdWelcomeModal.
- Nếu sửa config chung (firebaseConfig, ADMIN_EMAIL) phải sửa ở `index.html`, `dashboard.html`, `admin.html`, `admin-maintenance.html`.
- **KHÔNG sửa trực tiếp biến trong state.js** — các hàm đọc/ghi qua object `st` (xem phần state.js bên dưới).

**Luồng điều hướng giữa 2 trang:**
- Landing "Đăng ký/Đăng nhập" → `openLoginModal(mode)` → mở loginModal NGAY TRÊN index.html, URL vẫn là `/`
- Google OAuth xong → onAuthStateChanged trên landing → planSelectModal (nếu user mới) hoặc redirect /copy-drive (nếu đã có doc)
- Chỉ sau khi hoàn tất flow (doc Firestore tạo xong) → redirect `/copy-drive`
- User đã login truy cập landing → redirect `/copy-drive`
- Dashboard không có user → redirect `/`
- Logout từ dashboard → onAuthStateChanged(null) → redirect `/`

---

## Luồng Auth mới (sau khi implement 7 task)

```
Landing → openLoginModal(mode) → #loginModal (2 view: loginView + loginWarnView)
  _loginMode='register' (nút "Đăng ký dùng thử") → handleLoginContinue() → showLoginWarn() → #loginWarnView
    → tick checkbox → doLogin() → signInWithPopup (với login_hint nếu đã nhập email) → onAuthStateChanged
  _loginMode='login' (nút "Đăng nhập") → handleLoginContinue() → doLogin() TRỰC TIẾP (không qua cảnh báo)
    → check Firestore doc exists?
      NO  → showPlanSelect() → #planSelectModal
              "Dùng miễn phí"     → createFreeUser()        → approved=true, plan='free' → sec('app')
              "Đăng ký Trọn đời" → openPlanSelectPaid()    → _paymentContext='new'
                                   → #paymentModal → showPaymentConfirm()
                                   → #paymentConfirmModal → confirmPayment()
                                   → createPaidPendingUser() → approved=false, status='pending' → sec('pend')
      YES → checkApproval()
              status='kicked' → notifyAdminKicked() + sec('kicked') + hiện kickedReasonText
              approved=true   → sec('app') + updateFreeBanner() + checkReaddWelcome()
              approved=false  → sec('pend')

Nâng cấp Free → Paid (đã đăng nhập):
  freeBanner → openUpgradeModal() → _paymentContext='upgrade' → #paymentModal
  → showPaymentConfirm() → #paymentConfirmModal → confirmPayment()
  → _doUpgradeRequestInternal() → updateDoc(upgradeRequestedAt) → updateFreeBanner() → hiện "Chờ xác nhận"

pollKickStatus() (30s interval khi đang ở sec='app'):
  → nếu status !== 'approved' → clearInterval → sec('kicked') — KHÔNG signOut()
  → User phải bấm "Đăng xuất" trong #s-kicked để về landing
```

---

## Cấu trúc bên trong index.html và dashboard.html

### index.html (~621 dòng — landing + toàn bộ auth modals)
- `<head>`: Tailwind CDN, favicon, `<link rel="stylesheet" href="style.css">`
- SVG sprite: icon dùng lại qua `<use href="#ic-...">`
- Header: navGuest (bell, help, earn, VI/EN) — navRight ẩn (chỉ show khi IS_DASHBOARD)
- 2 section: `#s-land` (landing page với hero + pvCard + footer), `#s-maintenance`
- **Utility modals**: `#langModal`, `#supportModal`, `#earnModal`, `#addReviewModal`, `#reviewListModal`, `#faqModal`, `#policyModal`, `#policyAndReviewModal`, `#pvFullscreenOverlay`
- **Auth/plan modals** (xử lý full registration flow trên landing): `#loginModal`, `#planSelectModal`, `#paymentModal`, `#paymentConfirmModal`, `#readdWelcomeModal`
- Cuối body: `<script type="module" src="app.js"></script>` + `<script src="ui.js"></script>`

**KHÔNG có** trong index.html: noAuthBackdrop, s-check, s-app, s-pend, s-kicked, complOv, freeLimitModal, videoWarnModal.

### dashboard.html (~684 dòng — app page thuần)
- `<head>`: giống index.html
- SVG sprite (giống index.html)
- **noAuthBackdrop + noAuthPanel + authSuccessToast** — overlay reauth Drive (chỉ cần trong dashboard)
- Header (giống index.html — navGuest và navRight đều present, JS quản lý visibility)
- 4 section: `#s-pend`, `#s-kicked`, `#s-app`, `#s-maintenance` — `#s-check` đã bị xóa hoàn toàn. `#s-pend`, `#s-kicked`, `#s-maintenance` có `style="display:none"` mặc định; `#s-app` hiện mặc định (JS sẽ ẩn nếu cần).
- **Modals copy**: `#modalOv`, `#vidWarnOv` (dead code), `#videoWarnModal`, `#complOv`, `#freeLimitModal`
- **Modals upgrade** (free → paid từ dashboard): `#paymentModal`, `#paymentConfirmModal`
- **Utility modals** (duplicate từ index.html — cần cho header dashboard): `#langModal`, `#supportModal`, `#earnModal`, `#addReviewModal`, `#reviewListModal`, `#faqModal`, `#policyModal`, `#policyAndReviewModal`
- **Banner/badge dashboard** (trong #s-app): `#freeBanner`, `#premiumBadge`
- Cuối body: `<script type="module" src="app.js"></script>` + `<script src="ui.js"></script>`

**KHÔNG có** trong dashboard.html: `#loginModal`, `#planSelectModal`, `#readdWelcomeModal`.

**Lưu ý `#startModal` đã bị xóa hoàn toàn** — thay bằng `#loginModal` + `#planSelectModal`.

### state.js — shared state (~63 dòng)
- `IS_DASHBOARD`, `FREE_MB_LIMIT`, `FREE_RESET_MS`, `FMIME` — constants dùng chung
- `ns()` — factory trả object stats rỗng `{copied, failed, folders, topFolders, ...}`
- `export const st = {...}` — **object mutable dùng chung toàn bộ code**. Tất cả file import cùng object reference → mutation ở file nào đều visible ngay lập tức.
- `pausePoint()` — export để cả `drive-api.js` và `app.js` dùng
- **KHÔNG thêm logic vào state.js** — chỉ khai báo state + constants. Logic thuộc về `auth.js` hoặc `app.js`.

### drive-api.js — Drive API (~185 dòng)
- Import: `{ st, FMIME, pausePoint }` từ `state.js`
- Export: `dget`, `dpost`, `ddel`, `isAuthExpiredErr`, `fid`, `fname`, `listItems`, `existNames`, `mkFolder`, `isVideoItem`, `copyFileSingle`, `copyVideoReUpload`, `testFileCopy`
- Có retry exponential backoff (500ms base) cho 429/500/503
- **Video semaphore** `VIDEO_CONCUR=6`: Promise-based (không polling), `st._videoActive` + `st._videoWaiters`
- `copyFileSingle(item, destId)` — non-video dùng `files.copy` (server-side), video gọi `copyVideoReUpload` (download+re-upload để transcode ngay)
- **KHÔNG gọi hàm từ app.js hoặc auth.js** — chỉ dùng `st.*` callbacks và `st.*` state

### auth.js — Firebase + Auth + Plan (~400 dòng)
- Import: Firebase SDK + `{ st, IS_DASHBOARD, FREE_MB_LIMIT, FREE_RESET_MS }` từ `state.js`
- Export: `db` (Firestore instance), `handleAuthExpired` (alias `_handleAuthExpired`), `sendRegEmail`, `sendUpgradeRequestEmail`
- **Tất cả auth functions** gắn lên `window.*`: `doLogin`, `showLoginWarn`, `hideLoginWarn`, `openLoginModal`, `handleLoginContinue`, `doLogout`, `reAuth`, `closePlanSelect`, `createFreeUser`, `openPlanSelectPaid`, `showPaymentConfirm`, `backToPaymentModal`, `copyText`, `confirmPayment`, `closeReaddWelcome`, `openUpgradeModal`, `openUpgradeFromLimit`, `doUpgradeRequest`
- **Maintenance**: `getMaintenance()` gọi `/api/maintenance` (Vercel function + service account, cache promise), `getMaintenanceResult()` logic. **KHÔNG đọc Firestore trực tiếp** — người chưa đăng nhập bị Security Rules chặn.
- `handleAuthExpired()` — xử lý 401 giữa chừng, set stopFlag, gọi `st.showNoAuth?.()`. App.js import: `{ _handleAuthExpired as handleAuthExpired }`.
- Cross-module calls qua `st.*` callbacks được `app.js` set: `st.sec?.()`, `st.toast?.()`, `st.setNavUser?.()`, `st.updateFreeBanner?.()`, `st.checkResume?.()`, `st.showNoAuth?.()`.

### app.js — Checklist/Scan/Copy/UI (~1380 dòng)
- Import: `state.js` + `drive-api.js` + `{ db, _handleAuthExpired as handleAuthExpired }` từ `auth.js` + Firebase Firestore CDN
- **Ngay sau import**: set callbacks `st.addLog = addLog; st.sec = sec; st.toast = toast; ...` (hàm được hoisting nên safe)
- **Checklist**: `loadChecklist`, `renderChecklist`, `deepLoadAllFolders` (BFS background), `clToggleExpand`, `updateClInfo`, `calcSelectedBytes`, `collectSelectedExtensions`
- **Scan**: `startScan`, `scanNodes`, `scanFileNodes`, `renderScanResult`, `_setupScanDetailTree`
- **Copy**: `startCopy`, `_runCopyInternal`, `copyRecTree`, `copyRecTreeFiltered`, `videoGate`
- **Progress**: `progStart`, `progInc`, `progFinish`, `_updateProgBar`, `updateProgInfo` — asymptotic growth, `_maxPct` ratchet, `_totalDeepCount` làm mẫu số ổn định
- **Session/resume**: `saveSession`, `checkResume`, `resumeSession` — lưu localStorage key `swiftcopy_session`
- **UI helpers**: `sec`, `setBtnMode`, `setStatus`, `addLog`, `updStats`, `updateFreeBanner`, `toast` (expose qua `window.toast` và `window.setStatus`)
- **Free plan**: `checkFreeLimit`, `updateFreeUsedMB`, `showFreeLimitModal`, `updateFreeLimitCountdown`

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

## Email system — Google Apps Script + Vercel Proxy

**Luồng gửi email:** Browser → `POST /api/email` (Vercel serverless) → `GAS_URL` (env var bí mật) → Google Apps Script → GmailApp.sendEmail

**Tại sao có Vercel proxy (`api/email.js`):**
- GAS_URL là bí mật, không được để lộ ra browser hay commit lên GitHub
- Vercel function đọc `GAS_URL` từ environment variable, browser chỉ biết endpoint `/api/email`
- Nếu `GAS_URL` chưa set, function trả `{ ok: true }` im lặng (không crash)

**File GAS:** `gas-email.js` — dán vào https://script.google.com → Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).

**Cập nhật GAS_URL khi đổi endpoint:**
- Vào **Vercel Dashboard** → Project → Settings → Environment Variables → sửa `GAS_URL`
- Sau khi sửa env var: **phải Redeploy** (Deployments → latest → "..." → Redeploy) — env var mới không tự áp dụng cho deployment cũ
- **KHÔNG** lưu GAS_URL trong `app.js`, `admin.html`, hay bất kỳ file nào commit lên GitHub

**⚠️ Bẫy hay gặp:** Thêm env var vào Vercel xong nhưng quên Redeploy → email vẫn không gửi được dù config đúng.

---

## Maintenance system — Vercel Proxy (api/maintenance.js)

**Luồng đọc maintenance:** Browser → `GET /api/maintenance` (Vercel serverless) → Firestore REST API (dùng service account JWT) → trả `{ mode, allowedEmails }`

**Tại sao KHÔNG đọc Firestore trực tiếp từ browser:**
- Firestore Security Rules chặn người chưa đăng nhập đọc collection `settings`
- Nếu đọc trực tiếp: người chưa đăng nhập bị lỗi permission → catch trả `{ mode:'off' }` → Bảo trì 1 và 2 không bao giờ hoạt động với incognito/tài khoản mới
- `api/maintenance.js` chạy server-side, dùng service account → bypass Security Rules hoàn toàn

**Vercel env vars bắt buộc cho maintenance:**
| Var | Lấy từ đâu |
|---|---|
| `FIREBASE_CLIENT_EMAIL` | Firebase Console → Project Settings → Service accounts → Generate new private key → field `client_email` |
| `FIREBASE_PRIVATE_KEY` | Cùng file JSON → field `private_key` (paste nguyên chuỗi kể cả `\n` bên trong) |

**Nếu env vars chưa set:** `/api/maintenance` trả `{ mode:'off' }` im lặng (maintenance tắt, app hoạt động bình thường — không crash).

**⚠️ Bẫy hay gặp:** Thêm `FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` vào Vercel xong nhưng quên Redeploy → maintenance vẫn không hoạt động.

**File service account JSON:** KHÔNG commit lên GitHub, KHÔNG để trong thư mục project. Chỉ dùng để lấy 2 giá trị trên, xong xóa đi.

**7 loại email GAS xử lý (type string phải khớp chính xác):**
| type | Người nhận | Khi nào |
|---|---|---|
| `new_registration` | Admin | User lần đầu đăng ký (free — tự approved) |
| `kick_alert` | Admin | User bị kick đang cố đăng nhập lại |
| `account_approved` | User | Admin bấm "Kích hoạt" (duyệt tài khoản mới pending) |
| `account_kicked` | User | Admin bấm "Kick" |
| `account_readded` | User | Admin bấm "Thêm lại" |
| `upgrade_request` | Admin | Free user bấm "Tôi đã thanh toán" trong paymentModal |
| `upgrade_approved` | User | Admin bấm "Duyệt nâng cấp" trong admin.html |

**SITE_URL trong email:** `admin.html` khai báo `const SITE_URL = "https://swiftcopydrive.com"` và truyền qua payload `siteUrl`. GAS dùng `data.siteUrl || SITE_URL` (SITE_URL trong GAS chỉ là fallback).

**Template HTML email (`gas-email.js`):** Cả 7 loại đều dùng chung `buildEmailHtml(opts)` — header `#212529` chứa logo SVG vẽ tay theo `favicon.svg` (`_LOGO_SVG` const, không dùng `<img>`) + chữ "SwiftCopy.Drive", body trắng padding 28px với icon tròn 52px (ký tự Unicode đơn giản, colorable qua CSS — không dùng emoji nhiều-codepoint vì email client không áp được màu), tiêu đề, nội dung, nút CTA `<a>` `display:block`, footer `border-top:1px solid #e9ecef` text `#aaa`. Toàn bộ style inline (Gmail strip `<style>` ngoài). Gửi qua `GmailApp.sendEmail(to, subject, '', { htmlBody })` — plain text body để trống. `_esc()` escape HTML cho mọi field lấy từ user input (userName/reason/note) để tránh injection vào email HTML. `_fieldRow`/`_fieldTable` dựng bảng Email/Tên/Gói/Lý do/Thời gian cho 3 email gửi Admin (`new_registration`, `kick_alert`, `upgrade_request`) — `kick_alert` và `upgrade_request` không có field thời gian trong payload từ client nên GAS tự sinh bằng `_nowStr()` (`Utilities.formatDate`, timezone `Asia/Ho_Chi_Minh`), không cần sửa payload ở `auth.js`/`admin.html`. Màu icon/nút CTA theo từng loại: xem bảng 7 loại trên — `new_registration` xanh dương nhạt, `kick_alert`/`account_kicked` đỏ, `account_approved`/`account_readded`/`upgrade_approved` xanh lá, `upgrade_request` cam vàng.

---

## Firestore schema — users collection

Mỗi document trong collection `users` có các field sau:

| Field | Type | Mô tả |
|---|---|---|
| `email` | string | Email Google |
| `displayName` | string | Tên hiển thị |
| `photoURL` | string | Ảnh đại diện |
| `approved` | boolean | true = được vào app |
| `status` | string | `'approved'` / `'pending'` / `'kicked'` |
| `plan` | string | `'free'` hoặc `'paid'` |
| `freeUsedMB` | number | MB đã dùng trong window hiện tại (chỉ tính cho plan=free) |
| `freeResetAt` | Timestamp | Mốc thời gian bắt đầu window 5h hiện tại |
| `upgradeRequestedAt` | Timestamp \| null | null nếu chưa yêu cầu nâng cấp |
| `createdAt` | Timestamp | Lần đầu tạo tài khoản |
| `approvedAt` | Timestamp | (optional) Thời điểm admin duyệt |
| `upgradedAt` | Timestamp | (optional) Thời điểm admin duyệt nâng cấp |
| `readdedAt` | Timestamp | (optional) Set bởi admin.html `doReadd()` — trigger `#readdWelcomeModal` 1 lần duy nhất |
| `readdNote` | string | (optional) Ghi chú admin khi thêm lại |
| `kickReason` | string | (optional) Lý do kick — hiện trong `#s-kicked` và email |

### Firestore schema — settings/maintenance

```
{
  mode: 'off' | 'all' | 'auth' | 'dashboard',
  allowedEmails: string[]   // bypass trong app.js; ADMIN_EMAIL tự thêm vào đây nếu muốn bypass
}
```

| mode | Tên hiển thị | Chưa đăng nhập | Đã đăng nhập |
|---|---|---|---|
| `off` | Tắt bảo trì | landing | dashboard |
| `all` | Bảo trì 1 — Toàn bộ | maintenance | maintenance |
| `auth` | Bảo trì 2 — Trang chủ | maintenance | dashboard |
| `dashboard` | Bảo trì 3 — Dashboard | landing | maintenance |

Chỉ `allowedEmails` bypass trong `app.js` (index.html). ADMIN_EMAIL không có bypass đặc biệt trong app.js — muốn bypass thì thêm email vào allowedEmails. ADMIN_EMAIL chỉ gate `admin.html` và `admin-maintenance.html`.

**Hàm `getMaintenanceResult(mode, allowedEmails, userEmail)`** — trả về:
- `'maintenance'` → hiện `#s-maintenance`
- `'landing'` → hiện `#s-land` (không đi sâu hơn)
- `null` → không chặn, chạy luồng bình thường

Backward compat: doc cũ có `enabled:bool` thay vì `mode:string` → `mode = data.mode || (data.enabled ? 'all' : 'off')`

**Quy tắc tạo user mới (qua `#planSelectModal` sau login):**
- **Gói Free** (bấm "Dùng miễn phí"): `createFreeUser()` → `approved=true, status='approved', plan='free'` — vào app ngay
- **Gói Trọn đời** (bấm "Đăng ký Trọn đời" → xác nhận thanh toán): `createPaidPendingUser()` → `approved=false, status='pending', plan='free', upgradeRequestedAt=serverTimestamp()` — chờ admin xác nhận
- **Readd** bởi admin: `doReadd()` → `approved=true, status='approved', plan='paid', readdedAt=serverTimestamp()` — plan luôn là paid khi được thêm lại

---

## Free/Paid system

### Giới hạn gói Free
- **500 MB / 5 giờ** — tự reset sau 5 giờ kể từ `freeResetAt`
- **Không copy video** — file video bị bỏ qua hoàn toàn (addLog + skip), không báo lỗi
- **Không lưu lịch sử** — `saveHist()` bị gate bởi `gUserData?.plan !== 'free'`
- Khi hết hạn mức: hiện `#freeLimitModal` với countdown đến khi reset

### Hằng số Free plan (trong app.js)
```js
const FREE_MB_LIMIT = 500;                    // MB tối đa mỗi window
const FREE_RESET_MS = 5 * 60 * 60 * 1000;    // 5 giờ
```

### Luồng nâng cấp Free → Paid (đã đăng nhập)
1. User bấm "Nâng cấp lên Trọn đời →" trong `#freeBanner`
2. `openUpgradeModal()` → `_paymentContext='upgrade'` → mở `#paymentModal`
3. User bấm "Tôi đã thanh toán — Xác nhận" → `showPaymentConfirm()` → mở `#paymentConfirmModal`
4. User bấm "Xác nhận — Đã chuyển khoản" → `confirmPayment()` → gọi `_doUpgradeRequestInternal()`
5. `_doUpgradeRequestInternal()` → set `upgradeRequestedAt=serverTimestamp()` → gửi email `upgrade_request` → `updateFreeBanner()` hiện trạng thái "Chờ xác nhận"
6. Admin vào admin.html, thấy badge "⬆ Chờ nâng cấp", bấm "Duyệt nâng cấp" → `approveUpgrade()` → set `plan='paid', upgradeRequestedAt=null` → gửi email `upgrade_approved` cho user

### `updateFreeBanner()` — 3 trạng thái (render innerHTML động)
| Trạng thái | Điều kiện | Hiện |
|---|---|---|
| `plan='paid'` | gUserData.plan === 'paid' | `#premiumBadge` (vàng, crown icon), ẩn `#freeBanner` |
| Chờ xác nhận | plan='free' + upgradeRequestedAt set | freeBanner: "⏳ Gói Trọn đời — Đang chờ admin xác nhận..." |
| Free bình thường | plan='free', không có upgradeRequestedAt | freeBanner: dung lượng còn lại + nút "Nâng cấp" |

**Lưu ý:** `#freeBanner` không có con HTML tĩnh — toàn bộ nội dung được render bởi `updateFreeBanner()`. Không tạo child element tĩnh trong `#freeBanner`.

### Biến quan trọng trong `st` object (state.js)
Tất cả đều truy cập qua `st.<tên>`. KHÔNG khai báo lại dưới dạng biến local.

| `st.*` | File chủ yếu dùng | Mô tả |
|---|---|---|
| `st.gUser` | auth.js | Firebase User object hiện tại |
| `st.gToken` | auth.js | Google OAuth access token cho Drive API |
| `st.gUserData` | auth.js | Full Firestore user document |
| `st._loginMode` | auth.js | `'register'` hoặc `'login'` |
| `st._paymentContext` | auth.js | `'new'` hoặc `'upgrade'` — `confirmPayment()` dùng để quyết định flow |
| `st._kickPollTimer` | auth.js | setInterval ID cho `pollKickStatus()` |
| `st.stopFlag` | app.js/drive-api.js | Hủy tất cả workers ngay |
| `st.pauseFlag` | app.js/drive-api.js | Tạm dừng (chờ `doResume()`) |
| `st.runMode` | app.js | `'idle'` / `'scan'` / `'copy'` |
| `st.abortCtrl` | app.js/drive-api.js | AbortController cho fetch in-flight |
| `st.stats` | app.js | Object `{copied, failed, folders, topFolders, ...}` |
| `st._videoActive` / `st._videoWaiters` | drive-api.js | Semaphore video (VIDEO_CONCUR=6) |
| `st.clItems` | app.js | Cây checklist đã load |
| `st._deepScanId` | app.js | Token hủy background deep scan |
| `st._totalDeepCount` | app.js | Tổng items từ deep scan — dùng làm Y trong progress |
| `st._sessionCopiedMB` | app.js | MB đã copy trong phiên → cộng vào freeUsedMB sau khi xong |
| `st.progDone` / `st._progTotal` / `st._maxPct` | app.js | Progress tracking |
| `st._videoFilesCount` | app.js | Số video đã copy — show trong complModal |
| `st._pendingCopyResume` | app.js | Arg `isResume` pending khi videoWarn chặn |

**Cross-module callbacks** — `app.js` set sau import:
```js
st.addLog = addLog; st.sec = sec; st.toast = toast;
st.setNavUser = setNavUser; st.updateFreeBanner = updateFreeBanner;
st.checkResume = checkResume; st.showNoAuth = showNoAuth;
```
`auth.js` và `drive-api.js` gọi qua `st.addLog?.()`, `st.sec?.()` v.v. — optional chaining đảm bảo safe nếu callback chưa set (không xảy ra trong thực tế vì module-level code auth.js chạy đồng bộ trước async callbacks).

---

## Các hằng số quan trọng

```js
// Trong index.html và admin.html (phải khớp nhau)
const ADMIN_EMAIL = "hgntran.contact@gmail.com";

// Concurrency — trong app.js
const CONCUR = 16;             // file song song khi copy
const FOLDER_CONCUR = 8;       // thư mục song song khi copy
const SCAN_FILE_CONCUR = 12;   // file song song khi scan
const SCAN_FOLDER_CONCUR = 6;  // thư mục song song khi scan

// Video — trong drive-api.js
const VIDEO_CONCUR = 6;        // max concurrent video download+reupload

// Session — trong app.js
const SESSION_TTL = 120 * 60 * 1000; // 120 phút, tự xóa nếu cũ hơn

// Free plan — trong state.js (export để auth.js và app.js cùng dùng)
export const FREE_MB_LIMIT = 500;
export const FREE_RESET_MS = 5 * 60 * 60 * 1000; // 5 giờ
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

## Design system — dashboard & admin

### Tokens chung (áp dụng cho cả index.html và admin.html)
| Token | Giá trị | Dùng cho |
|---|---|---|
| Amber | `#ffc107` | CTA chính, border premium, accent |
| Red | `#dc3545` / `#fa5252` | Lỗi, danger, kick |
| Dark | `#212529` | Nền header modal, nút dark, text heading |
| Success | `#099268` / `#20c997` | Thành công, approved |
| Border | `#e9ecef` / `#f1f3f5` | Card border, divider |
| Font | Nunito (heading 800) + Nunito Sans (body) — chỉ áp dụng cho `legal.html`; `index.html` dùng Tailwind `font-sans` (system font); `admin.html` dùng system font stack (đồng bộ với user) |

### Dashboard user (#s-app)
- **Cards**: `rounded-2xl` + `p-5 md:p-6` + `shadow-sm hover:shadow-md transition-shadow`
- **Card headers**: icon badge (icon trong ô màu nhỏ 28×28) thay vì emoji — config card dùng folder icon nền fffbea, progress card dùng bolt icon nền fff9db
- **Input section**: source→dest flow với arrow SVG divider ở giữa + icon màu nhỏ ở label (green=source, blue=dest)
- **Action buttons**: `py-2.5 text-[12px] rounded-xl border-2` — scan=đỏ outline, start=amber fill+shadow, pause=vàng outline, resume=xanh outline, reset=dark fill
- **Stats cards**: `rounded-xl h-[70px] text-2xl md:text-3xl` font numbers, 3 gaps `gap-3`
- **Premium badge**: dark `#111110` bg + gold `#c9a84c` border 1.5px + box-shadow amber nhẹ + icon badge + divider dọc + feature summary

### Admin panel (admin.html)
- **Nav**: height 60px, logo SVG 40×40px `border-radius:12px` (giống index.html), badge "ADMIN" vàng
- **Font**: system font stack (không dùng Google Fonts Nunito) — đồng bộ với user side; OG tags có đầy đủ
- **Stats boxes**: `padding:20px 14px`, số `font-size:32px`
- **Table**: `padding:13px 18px`, avatar 38×38px + border 2px, u-name 13.5px
- **Badges**: có `.badge-dot` tròn 6×6 màu tương ứng ở trước text
- **Action buttons**: `padding:5px 13px border-radius:8px` + `.act-btn:active` scale(.96)
- **Modals**: `border-radius:18px` + backdrop-filter:blur(3px)
- **Card**: `border-radius:16px`

### Quy tắc KHÔNG vi phạm khi sửa UI
- Không đổi ID hoặc functional CSS class (`fi`, `log-box`, `prog-track`, `cl-row`, v.v.)
- Không thêm con tĩnh vào `#freeBanner` — JS render toàn bộ innerHTML
- Không đổi `style.display` logic cho `#premiumBadge` — JS chỉ set display:flex/none

---

## Các lỗi đã gặp — không lặp lại

- **Chiều cao modal FAQ/review không ổn định**: do đo `offsetTop` khi container chưa có `position:relative`, hoặc đo trước khi Tailwind CDN kịp compile class. Fix: dùng `position:relative` trên container + `requestAnimationFrame` double-tick + inline style thay vì Tailwind class cho padding/margin của item.
- **Tràn ngang layout**: Grid item thiếu `min-w-0`. Luôn thêm `min-w-0` vào grid children.
- **Animation Preview Dashboard lag khi mở modal**: fix bằng `anyModalOpen()` check trong `tick()`, và STEP_MS=250 (không để 90).
- **Stats hiển thị dữ liệu phiên cũ sau Reset**: fix bằng gọi `updStats()` ngay sau `stats=ns()` trong `doReset()` và đầu `startScan()`.
- **Email không gửi được dù GAS_URL đã set trong Vercel**: env var mới không áp dụng cho deployment cũ — phải Redeploy thủ công sau khi thêm/sửa env var. Kiểm tra bằng GAS "Nhật ký thực thi": nếu không có log mới → Vercel chưa reach GAS → chưa Redeploy.
- **pollKickStatus gọi signOut() làm mất token giữa chừng**: đã fix — `pollKickStatus()` chỉ gọi `sec('kicked')` và clear interval, KHÔNG gọi `signOut()`. User được đẩy về `#s-kicked` và phải bấm "Đăng xuất" để thật sự logout.
- **Readd user không set plan='paid'**: đã fix trong `admin.html` — `doReadd()` luôn kèm `plan:'paid'` khi updateDoc.
- **`serverTimestamp()` trong gUserData gây crash khi read `.toMillis()`**: Firestore FieldValue không có `.toMillis()` ngay khi optimistic write. Luôn dùng optional chaining `gUserData.freeResetAt?.toMillis?.()` hoặc fallback `Date.now()`.
- **Google Docs/Sheets/Slides không có `size` field → NaN trong tổng dung lượng**: Drive API trả `undefined` cho native format. Fix: luôn dùng `parseInt(item.size) || 0` thay vì `parseFloat(item.size || 0)` — áp dụng ở cả 3 điểm lưu size vào clItems và 1 điểm tính tổng trong `calcSelectedBytes()`.
- **Race condition: modal mở → Firebase resolve → sec('app') nhưng modal vẫn active**: Fix bằng cách gọi `document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'))` ngay trước `sec('app')` trong `onAuthStateChanged`.
- **Admin email bị reset doc sau logout → về planSelectModal dù đã approved**: Lỗi do có logic `deleteDoc` trong `onAuthStateChanged` và `doLogout`. Đã xóa hoàn toàn — admin email không có xử lý đặc biệt nào trong app.js.
- **Email nhập vào loginModal bị bỏ qua**: Đã fix bằng `provider.setCustomParameters({ login_hint: email })` trong `doLogin()` — Google sẽ pre-fill đúng tài khoản.
- **Cảnh báo Google chưa xác minh làm user thoát**: Đã fix bằng `#loginWarnView` — màn hình trung gian giải thích + hướng dẫn 2 bước + checkbox xác nhận trước khi popup Google mở.
- **Lag/delay dài sau "Kiểm tra trước" trước khi copy thật sự bắt đầu (và hành vi khác nhau tùy account)**: Nguyên nhân: `countVideoFiles()` được gọi ở đầu `_runCopyInternal()` cho paid user — hàm này traverse toàn bộ cây thư mục bằng listItems recursively, tốn thời gian tỉ lệ với số file/folder (tài khoản có nhiều folder lồng nhau → rất chậm). Fix: xóa bỏ pre-scan `countVideoFiles` hoàn toàn; thay bằng biến `_videoFilesCount` module-level, tăng tại điểm copy thành công trong cả 3 hàm (top-level loop, `copyRecTree`, `copyRecTreeFiltered`). Số video vẫn hiện trong completion modal chính xác.
- **Nút "Dừng sao chép" không phản hồi ngay khi vừa bấm Bắt đầu**: Nguyên nhân: `startCopy()` không set `runMode='copy'` trước khi await `checkFreeLimit()` → nếu user nhấn Dừng trong khoảng này, `handleStartBtn` thấy `runMode='idle'` → gọi `startCopy()` lần hai thay vì `doStopCopy()`. Fix: thêm `stopFlag=false; setBtnMode('copy')` ngay đầu `startCopy()` (trước mọi await), reset về `setBtnMode('idle')` nếu `checkFreeLimit()` từ chối.
- **Danh sách thư mục cũ không xóa khi đổi link nguồn**: Nguyên nhân: `onInputChange` có điều kiện `!clLoaded` → checklist chỉ load lần đầu, không reload khi link thay đổi. Fix: xóa điều kiện `!clLoaded`; reset `clItems=[], clLoaded=false` và ẩn `checklistWrap` ngay khi input thay đổi (trước debounce 600ms), load mới sau khi folder ID resolve thành công.
- **Thứ tự file/thư mục không khớp với Google Drive nguồn**: Nguyên nhân: `listItems()` không truyền `orderBy` → Drive API trả kết quả thứ tự tùy ý. Fix: thêm `orderBy:'folder,name'` vào params — folders lên trước, files theo thứ tự tên alphabetical, khớp với view mặc định của Drive.
- **Thanh tiến trình chạy LED vô hạn, không đóng băng khi Dừng, bị co sang trái khi Reset**: Nguyên nhân: `progStart()` thêm class `indeterminate` lên `.prog-track` → CSS `sweep` animation chạy mãi. `doStopScan/Copy()` chỉ set `stopFlag=true` mà không đụng CSS → bar tiếp tục animate. `doReset()` không xóa class `indeterminate` → `.prog-track.indeterminate .prog-fill` vẫn áp dụng `position:absolute; left:0; width:35% !important` → bar kẹt ở 35% thay vì biến mất. Fix: (1) Bỏ toàn bộ `indeterminate`/`sweep` mode; dùng asymptotic growth (`progDone / (progDone + K) * 100`) — bar tăng thực tế, không loop; (2) `doStopScan/Copy()` đặt `f.className='prog-fill paused'` ngay lập tức; (3) `doReset()` set `f.style.transition='none'`, xóa `width`, xóa class `indeterminate`, rồi `requestAnimationFrame` bật lại transition.
- **Dòng số mục và tên file hiện ở sai vị trí (dưới nút Reset thay vì dưới progress bar)**: Nguyên nhân: `setStatus()` update cả `statusLbl` (progress card) lẫn `actionStatus` (config card) với format `"(N mục) filename"`. Fix: thêm `#progInfo` div ngay dưới `.prog-track` trong HTML; thêm hàm `updateProgInfo(fileName, isDone)` hiển thị `[X] / [Y] mục filename` — X=progDone (đen→xanh khi xong), Y=max(progDone, checklist count) (đỏ→xanh khi xong), filename màu xám. Ẩn `actionStatus` wrapper (`display:none`). Module-level `_progTotal` set từ `top.length` sau khi list xong, trước `progStart()`, để bar biết ngưỡng tối đa trước khi asymptotic.
- **`Đã chọn: X MB` hiện 0 hoặc NaN với drive hỗn hợp Google Docs/Sheets/Slides + file thường**: Google native format không có `size` field trong Drive API → `parseInt(undefined) = NaN → NaN || 0 = 0` → tổng bytes = 0 → hiện "0 MB". Fix: thêm NaN guard `const mb = isNaN(rawMb) ? 0 : rawMb`. Google native type được map thành đuôi `doc`/`sheet`/`slide` trong `collectSelectedExtensions()`.
- **Dòng "Thư mục nguồn: ~0.7 MB · 9 thư mục" gây nhầm lẫn**: Chỉ hiện size file ở gốc (depth-0), khiến user nghĩ cả drive chỉ có 0.7 MB trong khi thực tế 13 GB nằm trong các subfolder. Đã xóa — bỏ gọi `updateSrcTotalInfo()` trong `loadChecklist()`; `#srcTotalSize` giữ `display:none` mặc định. Hàm `updateSrcTotalInfo()` còn trong file nhưng không được gọi.
- **Đăng nhập Google không hiện account picker, cấp quyền Drive không hiện consent screen**: `doLogin()` gọi `setCustomParameters({})` (hoặc chỉ có `login_hint`) → Firebase dùng phiên Google đang đăng nhập mà không cho chọn tài khoản. `reAuth()` không set params → Google bỏ qua consent screen nếu đã cấp quyền trước đó. Fix: `doLogin()` thêm `prompt: 'select_account'` vào params; `reAuth()` gọi `provider.setCustomParameters({ prompt: 'consent' })` trước `signInWithPopup` để luôn hiện màn hình phê duyệt quyền Drive chi tiết.
- **Video sau khi copy hiển thị 360p, không phát được, hoặc mất vài ngày/tuần/tháng mới xử lý xong**: Nguyên nhân: `files.copy` (Drive API server-side copy) tạo bản sao nhưng đưa video vào hàng đợi transcoding ưu tiên THẤP của Google → chỉ có 360p cho đến khi Google process xong (có thể vài ngày đến vài tháng). Tools khác "copy xong hiện ngay" vì chúng download + re-upload → Google coi là file mới → transcode ngay lập tức với ưu tiên cao. Fix: tách `copyFileSingle(item, destId)` thành 2 nhánh — (1) non-video: vẫn dùng `files.copy` (nhanh); (2) video: gọi `copyVideoReUpload(item, destId)` — download blob qua `GET /files/{id}?alt=media`, rồi re-upload qua `POST /upload/drive/v3/files?uploadType=multipart`. Signature thay đổi từ `copyFileSingle(fileId, destId)` → `copyFileSingle(item, destId)` (cần `item.id`, `item.name`, `item.mimeType`). `testFileCopy` trong Scan vẫn dùng server-side copy (chỉ test quyền, delete ngay).
- **Modal kết quả sao chép (openModal) không hiện**: Nguyên nhân: `openModal()` dùng `classList.add('on')` nhưng CSS chỉ có `.modal-overlay.active` — không có `.modal-overlay.on`. Fix: đổi sang `classList.add('active')` / `classList.remove('active')`. Đồng thời đổi hành vi mặc định tree: trước đây mở tất cả folder (gây rối với thư mục nhiều tầng); giờ chỉ auto-open folder cha đầu tiên làm mẫu, các folder còn lại đóng — user click để mở/đóng từng folder.
- **User bấm "Đăng ký" nhưng email đã có tài khoản → vẫn vào dashboard**: Sai về UX. Fix: trong `onAuthStateChanged`, sau khi check `docSnap.exists()`, nếu `_loginMode === 'register'` → `signOut(auth)` ngay + `sec('land')` + `toast('...Vui lòng nhấn Đăng nhập...')` + shake animation (class `shake-hint`) trên nút `#btnGoLogin`. Chỉ khi `_loginMode === 'login'` mới cho user có doc vào dashboard.
- **Admin denied screen bị override về login ngay lập tức (loop vô tận)**: Nguyên nhân: `onAuthStateChanged` phát hiện non-admin → gọi `sec('denied')` + `signOut(auth)` → signOut kích hoạt `onAuthStateChanged(null)` → `sec('login')` ghi đè denied screen → user không đọc được thông báo lỗi → bấm đăng nhập lại → lặp. Fix: thêm flag `let _denied = false`; khi non-admin phát hiện đặt `_denied=true` trước khi signOut; trong handler `if (!u){ if (_denied) return; sec('login'); }`; thêm `window.tryAnotherAccount` đặt lại `_denied=false` và gọi `sec('login')`. Màn hình denied hiện email đã dùng sai và nút "Thử tài khoản khác".
- **gToken null sau khi navigate từ index → dashboard — scan/copy abort, modal không hiện**: Sau khi tách 2 file, mỗi lần navigate sang dashboard.html là page load mới → `gToken` reset về null. `startScan/startCopy` check `if (!gToken) { showNoAuth(); return; }` → abort ngay → scan result / completion modal / video warning modal không bao giờ chạy đến. Fix: lưu `gToken` vào `sessionStorage` (`swiftcopy_gtok`) trong `doLogin()` và `reAuth()`; dashboard's `onAuthStateChanged` (sau `gUser=u;`) restore bằng `if (!gToken) { const t=sessionStorage.getItem('swiftcopy_gtok'); if(t) gToken=t; }`. Xóa khi logout (`sessionStorage.removeItem('swiftcopy_gtok')` trong branch `!u`).
- **reAuth() với `prompt: 'consent'` hiện "Google chưa xác minh" mỗi lần cấp quyền Drive**: `prompt: 'consent'` force hiện màn hình consent kể cả đã cấp quyền → Google luôn show cảnh báo "ứng dụng chưa xác minh" → user sợ. Fix: đổi `prompt: 'consent'` → `prompt: 'select_account'` trong `reAuth()`. User đã từng grant Drive → Google chỉ hiện account picker, không cần consent lại, không hiện warning.
- **Checklist "Đã chọn: X MB" hiện sai sau expand folder**: `clToggleExpand` load children vào `item.children` nhưng chỉ gọi `renderChecklist()`, không gọi `updateClInfo()` → size không cập nhật. Fix: thêm `updateClInfo()` ngay sau `renderChecklist()` cuối `clToggleExpand`.
- **"Đã chọn: X MB" hiện sai (0 MB hoặc số thấp hơn thực tế) khi load checklist lần đầu**: Root cause: lazy-load + size calculation là mâu thuẫn — `calcSelectedBytes()` chỉ đếm file trong các folder đã expand (`children !== null`). Folder có file ở depth-2+ sẽ trả về 0 hoặc thiếu. **KHÔNG fix bằng pre-load cố định depth** (pre-load depth-1 vẫn sai với cấu trúc sâu hơn, ví dụ file nằm ở depth-2 → hiện "76 MB" thay vì "10 GB"). Fix đúng: sau khi `loadChecklist()` render xong, khởi chạy `deepLoadAllFolders(scanId)` trong background (không await) — hàm này dùng BFS queue để load TẤT CẢ subfolder đệ quy với concurrency 4, gọi `updateClInfo()` sau mỗi batch. Trong `updateClInfo()`, nếu `countUnloadedSelectedFolders() > 0` → hiện `"đang tính dung lượng..."` (không hiện số sai). Khi background scan xong → `unloaded = 0` → `updateClInfo()` hiện đúng (ví dụ "10.33 GB"). `_deepScanId` module-level tăng mỗi lần paste link mới để cancel scan cũ. Không dùng text hướng dẫn "nhấn ▶ mở thư mục" — scan tự động hoàn toàn.
- **Progress bar nhảy 90% ngay với folder có nhiều file lồng nhau**: `_progTotal` set = số item top-level (ví dụ 1 folder), nhưng `progInc()` gọi cho toàn bộ nested items (1000 items) → `progDone > _progTotal` gần như ngay → vào asymptotic excess path → bar lên 97% khi mới xử lý 2 mục. Fix: grow `_progTotal` dynamically — trong `scanNodes` sau `listItems`: `_progTotal += children.length`; trong `copyRecTree` và `copyRecTreeFiltered` sau `listItems`: `if(_totalDeepCount===0) _progTotal += items.length`. Chỉ grow khi chưa có deep scan total — khi đã có `_totalDeepCount`, `_progTotal` giữ cố định để bar không thụt lùi.
- **Auth flow redirect sai sau tách index.html/dashboard.html**: `openLoginModal()` trên landing redirect sang `/copy-drive?m=register` ngay lập tức — trước khi auth xong → loginModal hiện trên `/copy-drive`, nền mất landing, nhấn X → trang trắng. Fix: `openLoginModal()` trên landing mở loginModal tại chỗ (không redirect); toàn bộ auth flow (loginModal → planSelectModal → paymentModal → paymentConfirmModal) chạy trên `index.html` với URL vẫn là `/`; chỉ redirect sang `/copy-drive` sau khi có Firestore doc. Dashboard không có user → redirect `/` (không show loginModal). `createFreeUser()` và `createPaidPendingUser()` trên landing → `window.location.href='/copy-drive'` sau khi tạo doc. `readdWelcomeModal` nằm trong `index.html`; `closeReaddWelcome()` redirect sang `/copy-drive` khi trên landing.
- **Tiêu đề #loginModal luôn hiện "Đăng ký" dù user bấm "Đăng nhập"**: Tiêu đề hardcode trong HTML, không cập nhật theo `_loginMode`. Fix: thêm `id="loginModalTitle"` vào div tiêu đề trong `index.html`; trong `openLoginModal(mode)` ở `app.js`, sau khi set `_loginMode`, cập nhật `titleEl.textContent = mode==='login' ? 'Đăng nhập' : 'Đăng ký'`.
- **Stats dashboard hiển thị sai — THÀNH CÔNG chỉ đếm file, THƯ MỤC đếm tất cả cấp, Y trong progress không phản ánh tổng thực tế**: THÀNH CÔNG chỉ tăng khi copy file thành công (không đếm folder) → số nhỏ hơn progDone nhiều. THƯ MỤC đếm ALL folders ở mọi depth → con số lớn, khó hiểu. Y trong "X/Y mục" dùng `clSel` (số top-level item được tick) thay vì tổng thực tế → 14 thay vì 1575. Fix: (1) Thêm `_totalDeepCount` — cập nhật bởi `deepLoadAllFolders` sau mỗi batch, lưu tổng file+folder từ toàn bộ cây đã load; (2) `updateProgInfo` dùng `_totalDeepCount` làm Y; (3) `_progTotal` khởi đầu = `_totalDeepCount` (nếu đã có) thay vì chỉ `top.length`; (4) Thêm `stats.topFolders` — chỉ tăng trong `folderWorker` (depth-0); (5) `updStats`: `sCopied` hiện `stats.copied + stats.folders` (file + tất cả folder = tổng thành công), `sFolders` hiện `stats.topFolders` (chỉ folder cấp gốc, giống "14/14 tổng").
- **Extension list chỉ hiện pdf/doc/xlsx nhưng không hiện mp4 dù drive chứa nhiều video**: `collectSelectedExtensions()` sort theo số lượng file (count) → mp4 ít file nhưng rất nặng bị đẩy ra ngoài top 6, trong khi pdf/jpg/doc nhiều file hơn chiếm hết vị trí. Fix: đổi Map từ `count` sang `totalBytes` cho mỗi extension, sort theo `b[1]-a[1]` theo bytes → extension nào chiếm nhiều dung lượng nhất hiện đầu tiên.
- **Thanh tiến trình "răng cưa" — chạy lên ~90% rồi thụt về, lặp đi lặp lại (cả Kiểm tra trước lẫn Bắt đầu sao chép)**: Root cause: `_progTotal` tăng đột ngột mỗi khi khám phá subfolder mới (via `_progTotal += items.length` hoặc `_progTotal += children.length`) trong khi `progDone` tăng chậm từng item một → `progDone/_progTotal` co lại → bar thụt. Ví dụ: scan folder 1 xong (200 item) → bar lên 89% → scan folder 2 phát hiện 300 item → `_progTotal` nhảy → bar xuống 37%. Fix: thêm biến `_maxPct` (ratchet) — bar chỉ được tăng, không bao giờ giảm. `_updateProgBar()` set `_maxPct=Math.max(_maxPct,pct)` và dùng `_maxPct` làm width. Reset `_maxPct=0` trong `progStart()`. Không cần đụng công thức tính pct hay `_progTotal` logic.
- **Tốc độ sao chép/kiểm tra chậm, đặc biệt giai đoạn cuối**: Concurrency thấp hạn chế luồng song song, đặc biệt khi folder lồng nhau nhiều cấp. Fix: tăng `CONCUR` 8→12→16, `FOLDER_CONCUR` 3→5→8, `SCAN_FILE_CONCUR` 8→12, `SCAN_FOLDER_CONCUR` 4→6. Backoff exponential (`sleep(2^attempt * 800ms)`) đã có sẵn cho 429/500/503 nên tăng concurrency an toàn.
- **Thanh tiến trình quá đầy ngay đầu scan (hiện ~35% khi chỉ 1.4% thực tế)**: Root cause: `startScan()` set `_progTotal = topItems.length` (số item top-level, ví dụ 2) — rất nhỏ. Ngay khi `progDone=1`, `pct = 1/2*95 = 47%`. Ratchet `_maxPct` lock 47%. Khi deep scan xong `_totalDeepCount=1526`, pct thật = 0.07% nhưng bar kẹt ở 47%. Thêm vào đó, `scanNodes` gọi `_progTotal += children.length` không có điều kiện → `_progTotal` tăng nhưng `_maxPct` đã lock cao rồi. Fix: (1) `startScan()`: `_progTotal = _totalDeepCount > 0 ? _totalDeepCount : topItems.length` (dùng deep scan total nếu đã có); (2) `scanNodes`: `if(_totalDeepCount===0) _progTotal += children.length` — gate growth như `copyRecTree` đã làm.
- **Shortcut bị đánh sai là "lỗi" trong scan nhưng copy bỏ qua im lặng — kết quả không đồng nhất**: `scanFileNodes` tạo node `{error:'Là shortcut - bỏ qua'}` cho SMIME → `cntErr()` đếm shortcut là lỗi → scan báo "5 sẽ lỗi". Nhưng `copyRecTree` filter `i.mimeType!==SMIME` → shortcut không copy và không báo lỗi → copy báo "0 lỗi". Fix: trong `scanFileNodes`, khi gặp SMIME: `progInc(); return;` (không tạo node, không thêm error) → scan và copy đồng nhất về số lỗi.
- **Y trong "X/Y mục" chạy theo X (hiện 223/223, 224/224...) khi scan/copy đang chạy**: `y = Math.max(x, _totalDeepCount)` — khi `_totalDeepCount` (deep scan count) < `progDone`, Y bị kéo lên bằng X → cả 2 tăng cùng nhau, không còn phân biệt được "đang xử lý" vs "tổng đích". Thử fix bằng `y = _totalDeepCount > 0 ? _totalDeepCount : x` nhưng gây ra X > Y (254/169) khi deep scan chưa đếm hết. Fix đúng: giữ `Math.max(x, _totalDeepCount)` — Y luôn ≥ X, khi progDone vượt _totalDeepCount thì Y tăng theo là chấp nhận được (thể hiện "tổng tối thiểu đã biết"). **KHÔNG dùng fixed snapshot vì _totalDeepCount có thể cập nhật sau khi scan bắt đầu.**
- **Stats THÀNH CÔNG/LỖI/THƯ MỤC không được hiện trong "Kiểm tra trước"**: `#statsRow` chỉ hiện khi copy đang/đã chạy, không hiện trong scan. Fix: (1) `#statsRow` mặc định `display:none` trong HTML; (2) `startScan()` ẩn statsRow; (3) `_runCopyInternal` show statsRow khi copy bắt đầu; (4) `doReset()` và `doProgressReset()` ẩn statsRow. Scan vẫn đếm `stats.copied/failed/folders` nội bộ (dùng trong scan report) nhưng không gọi `updStats()` — không hiện ra UI.
- **Bảng báo cáo sau "Kiểm tra trước" — hiện dưới dạng modal popup**: Sau khi `startScan()` hoàn thành, `renderScanResult(tree, totalErr)` render vào `#scanRepContent` và hiện `#scanRepModal` (modal-overlay, max-width 700px). Modal: header icon+title, 2 badge layout **grid 1fr 1fr** (full-width mỗi ô 50%) với hover effect (onmouseenter/onmouseleave inline) — ô "0 sẽ lỗi" khi không có lỗi có `pointer-events:none;opacity:0.6` (disabled hoàn toàn, không click được). 2 nút dưới: "Để tôi kiểm tra lại" → `closeScanReportReview()` (đóng modal + hiện `#scanSummaryBanner`); "Bắt đầu sao chép ngay →" → `closeScanReportAndStart()` (đóng modal + ẩn banner + `startCopy()` ngay). Bấm badge → `toggleScanDetail(type)` toggle tree panel (chỉ 1 mở cùng lúc). `_setupScanDetailTree` — khởi đầu `openSet=new Set()` rỗng, render tất cả collapse, sau đó gọi `window[fnName](firstFolder.path)` để force-open folder đầu tiên. Không còn `#scanResult` div trong HTML; tất cả hide/show dùng `classList.add/remove('active')` trên `#scanRepModal`. `renderScanResult` lưu kết quả vào module-level vars (`_lastScanOkNodes`, `_lastScanErrNodes`, `_lastScanOkCount`, `_lastScanTotalErr`) để `#scanSummaryBanner` và `#scanDetailModal` dùng lại.
- **Bảng tóm tắt thu gọn `#scanSummaryBanner` + modal chi tiết 2 tab `#scanDetailModal`**: Khi user bấm "Để tôi kiểm tra lại" trong `#scanRepModal`, thay vì mất hết kết quả scan, `showScanSummaryBanner()` hiện 1 banner thu gọn ngay trong khu vực "Tiến trình đồng bộ" (`dashboard.html`, giữa `#progInfo` và `#statsRow`) — nền `#fffbf0`, viền `#f5a623`, tiêu đề "Kết quả kiểm tra trước" + icon clipboard `#ba7517`, 2 ô 50/50 (trái: số thành công nền trắng viền vàng; phải: số lỗi, mờ+disabled nếu =0), nút "Xem chi tiết" full-width vàng `#f5a623` → `window.openScanDetailModal()`. Banner **tồn tại cho đến khi** user bấm "Bắt đầu sao chép" — `hideScanSummaryBanner()` được gọi ở 4 nơi: `closeScanReportAndStart()`, `_runCopyInternal()` (đầu hàm, khi copy thật sự chạy — bắt cả nút "Bắt đầu sao chép" chính), `doReset()`, `doProgressReset()`, và `onInputChange('src')` khi `runMode==='idle'` (paste link nguồn mới). `#scanDetailModal` (2 tab "Thành công (X)" / "Lỗi (X)") tái dùng `buildTreeHTML()`/`togglePathSet()` sẵn có — `_renderScanDetailTab(tab)` tạo toggle function riêng (`_scanDtlOkToggle`/`_scanDtlErrToggle`) để không đụng namespace với `_scanRepOkToggle`/`_scanRepErrToggle` của `#scanRepModal`. `window.openScanDetailModal(tab)` mặc định mở tab `'err'` nếu có lỗi, ngược lại `'ok'`. Tab Lỗi bị disable (`pointer-events:none`) nếu `_lastScanTotalErr===0`. 3 ô THÀNH CÔNG/LỖI/THƯ MỤC (`#statsRow`) vẫn ẩn hoàn toàn trong lúc scan, chỉ hiện khi copy thật sự chạy (hành vi đã có từ trước, không đổi).
- **Icon reset nhỏ trên header "Tiến trình đồng bộ"**: Button `onclick="window.doProgressReset()"` nằm góc phải cùng hàng header, dùng `#ic-reset` (icon vòng tròn mũi tên đã có trong SVG sprite). Chức năng: reset thanh tiến trình, stats, log, đóng scanRepModal — **KHÔNG** reset inputs/checklist/session (khác `doReset()` toàn phần). Hover amber.
- **Tốc độ sao chép chậm dần về cuối — đặc biệt với drive lớn hoặc chứa video nặng**: Root cause: file loop dùng sequential batching (`for i+=CONCUR → Promise.all(batch)`) — nếu 1 file trong batch chậm (video download+reupload hàng GB), cả batch phải đợi xong mới chạy batch tiếp → throughput giảm dần. Video cũng không giới hạn concurrency → 16 video download đồng thời gây memory pressure. Fix: (1) Đổi file loop từ batch → **worker pool** (giống folder workers — mỗi slot tự lấy item tiếp theo ngay khi xong, không đợi cả batch) trong cả 3 hàm: `_runCopyInternal`, `copyRecTree`, `copyRecTreeFiltered`; (2) Thêm `const VIDEO_CONCUR=4` + `let _videoActive=0` — semaphore trong `copyVideoReUpload` giới hạn tối đa 4 video download+reupload đồng thời, tránh RAM explosion; (3) Thêm retry 429/500/503 vào `testFileCopy` (trước đây không có retry → scan báo sai lỗi khi rate limit, copy lại thành công vì có retry → số lỗi khác nhau giữa scan và copy).
- **Nút Dừng phản hồi chậm khi đang download video lớn hoặc xử lý drive nhiều file**: Root cause: `stopFlag=true` chỉ được check tại `pausePoint()` / `if(stopFlag)` giữa các await — nhưng `fetch()` đang chạy không thể bị interrupt bởi flag → phải đợi fetch hoàn thành (có thể vài phút với video GB). Fix: thêm `let abortCtrl=null` module-level; `doStopCopy()`, `doStopScan()`, `doReset()` gọi `abortCtrl?.abort(); abortCtrl=null;` ngay lập tức → tất cả in-flight fetch (dget/dpost và 2 fetch trong copyVideoReUpload) bị abort ngay. `dget`/`dpost` nhận `signal:abortCtrl?.signal`; `copyVideoReUpload`'s fetch cũng nhận signal. AbortError được catch: `copyFileSingle` và `copyVideoReUpload` trả `{ok:false,reason:'Đã dừng'}` — worker check `if(stopFlag) return` sau đó → không log lỗi; `_runCopyInternal`/`startScan` catch AbortError → `setStatus('Đã dừng...')` clean. Scan path: `testFileCopy` re-throw AbortError; `scanFileNodes` và `scanNodes` catch re-throw; `startScan` catch handle cleanly.
- **Thanh tiến trình bị reset về 0% khi resume sau mất wifi/tắt máy**: Root cause: `resumeSession()` khôi phục `stats` từ localStorage nhưng không khôi phục `progDone`/`_progTotal` → `_runCopyInternal` gọi `progStart()` với `startDone=0` → bar reset về 0% dù đã copy được 60%. Fix: (1) `saveSessionData()` và `saveSession()` lưu thêm `progDone` và `progTotal:_progTotal`; (2) `resumeSession()` khôi phục `progDone` và `_progTotal` từ session trước khi gọi `startCopy(true)`; (3) `progStart(startDone=0)` nhận tham số optional — nếu `startDone>0` gọi `_updateProgBar()` ngay (trong khi `transition='none'`) để bar nhảy đúng vị trí; (4) `_runCopyInternal` đọc `_savedSess=getSession()` khi `isResume=true` → set `_progTotal=_savedSess.progTotal||...`, `_startDone=_savedSess.progDone||0` → `progStart(_startDone)`.
- **Thanh tiến trình bị lock ở % sai (quá cao) so với X/Y mục thực tế — xảy ra không nhất quán giữa Kiểm tra trước và Sao chép, giữa các drive khác nhau**: Root cause: `_maxPct` ratchet bị lock quá sớm. Cụ thể: `scanNodes` xử lý TẤT CẢ file ở depth-N trước khi list subfolder ở depth-N → `scanFileNodes` gọi `progInc()` cho 100 file trong khi `_progTotal` vẫn còn nhỏ (vd: 2 top-level items) → `progDone/2 = 95%` → `_maxPct` lock ở 95% → dù sau đó `_totalDeepCount = 1526` được cập nhật, `_maxPct` không bao giờ giảm → bar hiện 90% khi thực tế chỉ 49%. Lý do không nhất quán: nếu user đợi deep scan xong trước khi nhấn Kiểm tra/Sao chép → `_totalDeepCount` đã có → `_progTotal` khởi đầu bằng `_totalDeepCount` → không bị lock. Nếu nhấn ngay → `_progTotal = topItems.length` nhỏ → lock. Fix: `_updateProgBar()` dùng `Math.max(_progTotal, _totalDeepCount, 1)` làm mẫu số; khi `_totalDeepCount > 0` và ổn định → hiển thị trực tiếp `progDone/_totalDeepCount * 95%` không dùng ratchet (bar chỉ tăng vì `_totalDeepCount` không shrink); khi `_totalDeepCount = 0` → vẫn dùng ratchet nhưng cho phép correction nếu sai lệch >35 điểm (`if(pct < _maxPct-35) _maxPct = pct+15`).
- **Video semaphore dùng sleep(100) polling gây lãng phí CPU và trễ 100ms mỗi lần slot giải phóng**: Root cause: `while(_videoActive>=VIDEO_CONCUR){ await sleep(100); }` — mỗi 100ms một lần worker thức dậy để kiểm tra, dù slot vừa giải phóng xong thì vẫn phải đợi tối đa 100ms. Với nhiều worker chờ đồng thời → CPU chạy polling liên tục. Fix: thay bằng **Promise-based semaphore** — `const _videoWaiters = []`; khi chờ: `await new Promise(r => _videoWaiters.push(r))`; khi giải phóng slot (`finally`): `_videoWaiters.shift()?.()` → waiter tiếp theo thức dậy ngay lập tức, 0ms latency. `doStopScan/doStopCopy/doReset` drain toàn bộ `_videoWaiters` (`while(_videoWaiters.length) _videoWaiters.shift()()`) để worker thoát tức thì khi Dừng. `VIDEO_CONCUR` tăng 4 → 6 để tận dụng băng thông tốt hơn. Backoff retry 800ms → 500ms base cho phục hồi rate-limit nhanh hơn.
- **[CHẨN ĐOÁN SAI — BÀI HỌC QUAN TRỌNG] Maintenance không hoạt động cho người chưa đăng nhập (Bảo trì 1 & 2)**: Triệu chứng: incognito và tài khoản chưa đăng ký vẫn thấy landing thay vì trang bảo trì. Chẩn đoán ban đầu SAI: cứ đề nghị sửa Firestore Security Rules trong Firebase Console thay vì tìm giải pháp code. Nguyên nhân thật: `getMaintenance()` đọc Firestore trực tiếp từ browser → Security Rules chặn người chưa auth → catch trả `{ mode:'off' }` → maintenance không bao giờ áp dụng. Fix đúng: tạo `api/maintenance.js` (Vercel serverless + service account JWT) → đọc Firestore server-side → bypass Security Rules hoàn toàn → tất cả 3 mode hoạt động cho mọi loại user. **Quy tắc rút ra: bất kỳ Firestore collection nào cần đọc bởi người CHƯA đăng nhập → PHẢI đọc qua Vercel server-side function, KHÔNG đọc trực tiếp từ browser.**
- **Nút "Kiểm tra trước" và "Bắt đầu sao chép" có thể bấm đồng thời gây chạy 2 tác vụ song song**: Khi scan đang chạy, user vẫn bấm được "Bắt đầu sao chép" (và ngược lại) → 2 tác vụ tranh nhau `abortCtrl` và `stopFlag` → kết quả không nhất quán, log lẫn lộn. Fix: trong `setBtnMode('scan')` thêm `bst.disabled = true` (khoá nút Bắt đầu); trong `setBtnMode('copy')` thêm `bs.disabled = true` (khoá nút Kiểm tra). `setBtnMode('idle')` và các nhánh khác reset `bs.disabled = false; bst.disabled = false` như bình thường.
- **Dữ liệu tiến trình cũ còn sót lại khi paste link nguồn mới**: Sau khi copy xong, paste link Drive mới vào ô nguồn → thanh tiến trình, stats (THÀNH CÔNG/LỖI/THƯ MỤC), Activity Log vẫn hiện số liệu của lần chạy trước. Fix: trong `onInputChange` khi `which === 'src'` và `st.runMode === 'idle'`, reset ngay: `st.stats = ns(); updStats(); progFill.style.width='0%'; logBox.innerHTML=''; progInfo.innerHTML=''; statsRow.display='none'; setStatus('Chưa bắt đầu')`. Không reset khi scan/copy đang chạy.
- **Video warning modal gây gián đoạn UX không cần thiết cho paid user**: Modal `#videoWarnModal` hiện trước mỗi lần copy nếu drive có video — yêu cầu paid user click thêm 1 bước xác nhận không có giá trị thực. Fix: xoá toàn bộ video warn flow khỏi `startCopy()` (15 dòng check video + showVideoWarn) và `closeComplModal()` (showVideoWarn 'after' call). Paid user bấm "Bắt đầu sao chép" → copy ngay, không hỏi. Các hàm `showVideoWarn`, `confirmVideoWarn`, `closeVideoWarn`, `videoGate` và HTML `#videoWarnModal` giữ lại nhưng là dead code.
- **Thứ tự file/thư mục trong checklist và modal kết quả dùng alphabetical sort (B1, B10, B11 thay vì B1, B2, B3)**: Drive API trả kết quả theo `orderBy:'folder,name'` — sort lexicographic → B10 đứng trước B2. Fix: đổi `orderBy: 'folder,name_natural'` trong `listItems()` (drive-api.js) → Drive API tự áp dụng natural sort giống Google Drive UI grid view. Áp dụng cho cả checklist load và tất cả modal kết quả (Thành công/Lỗi/Thư mục/Scan report) vì đều dùng cùng `listItems()`.
- **Label Drive Nguồn/Đích trong dashboard thiếu mô tả phụ giải thích vai trò**: Hint cũ "(Shared Drive)" và "(Drive của bạn)" không rõ ý với user mới. Fix: đổi thành "(Bản gốc tải về)" cho Drive Nguồn và "(Tải về Drive bạn)" cho Drive Đích — cùng hàng, font nhỏ hơn (`text-[10px]`), màu mờ (`text-[#adb5bd]`).
- **Nút Dừng dừng ngay lập tức không có xác nhận — user dễ bấm nhầm**: Clicking "Dừng sao chép" hoặc "Dừng kiểm tra" lập tức abort toàn bộ tiến trình → mất công scan/copy nếu bấm nhầm. Fix: `doStopScan()/doStopCopy()` không còn abort trực tiếp; thay vào đó hiện `#stopConfirmModal` (icon stop vàng, tiêu đề "Dừng sao chép?", mô tả, 2 nút). `_execStop()` chứa logic abort thực sự. `window.confirmStop` → `_execStop()` rồi đóng modal; `window.cancelStop` → chỉ đóng modal. `_stopPendingFn` module-level giữ ref đến `_execStop`.
- **#clSizeInfo hiện text tĩnh "đang tính dung lượng..." trong lúc deep scan chạy**: Text tĩnh không cho user biết app đang làm gì. Fix: thêm animation loop — `_startCalcAnim(selected)` → `_tickCalcAnim()` cycle 4 trạng thái: "Đang tính dung lượng." (500ms) → ".." (500ms) → "..." (500ms) → shimmer bar (1500ms) → lặp. Dot pulse màu `#f5a623` kèm CSS `calc-blink`. Shimmer dùng CSS `calc-shimmer-bar` gradient animation. `_stopCalcAnim()` gọi khi `unloaded===0` (xong) hoặc khi `!clLoaded/!total` hoặc `doReset()`. Anim timer không reset khi `updateClInfo()` gọi lại (guard `if(_calcAnimTimer) return`).

---

## Trạng thái hiện tại (để tiếp tục đúng chỗ)

- **Landing/Dashboard split**: ĐÃ tách và ĐÃ fix auth flow — `index.html` (~621 dòng) xử lý toàn bộ đăng ký/đăng nhập tại chỗ (loginModal + planSelectModal + paymentModal + paymentConfirmModal + readdWelcomeModal đều trong index.html). `dashboard.html` (~684 dòng) chỉ chứa app sections + copy modals + upgrade modals (paymentModal/paymentConfirmModal cho free→paid). Dashboard không có user → redirect `/`. `app.js` dùng `IS_DASHBOARD = !!document.getElementById('s-app')`. URL không đổi khi mở auth modals trên landing.
- **Đang deploy**: Vercel (`swiftcopydrive.vercel.app`) — sắp mua domain `swiftcopydrive.com`
- **CI/CD**: Vercel tự động deploy khi push lên GitHub
- **Email system**: ĐÃ hoạt động — `GAS_URL` lưu trong Vercel env var, proxy qua `api/email.js`, confirmed working (kick/readd/approve/upgrade đều gửi được)
- **Email template HTML**: ĐÃ redesign cả 7 loại trong `gas-email.js` từ plain text sang HTML chuyên nghiệp (`buildEmailHtml()` dùng chung, logo SVG vẽ theo `favicon.svg`, icon tròn màu theo loại, nút CTA). Gửi qua `htmlBody`. Xem chi tiết ở mục "Email system" phía trên. **Sau khi đổi `gas-email.js` phải vào script.google.com → Deploy → Manage deployments → Edit → New version → Deploy thì code mới mới có hiệu lực** (URL không đổi).
- **SITE_URL trong email**: đã set `https://swiftcopydrive.com` trong `admin.html` — khi mua domain xong chỉ cần trỏ domain về Vercel, không cần sửa code
- **Auth flow**: ĐÃ implement luồng mới — #loginModal premium + #planSelectModal (chọn Free/Paid sau login), #startModal đã bị xóa. Điều hướng landing-cho-user-đã-đăng-nhập nằm trong `_routeLandingAuthedUser(u)` (auth.js) — gọi từ cả `onAuthStateChanged` lẫn trực tiếp trong `doLogin()` sau khi popup resolve (không phụ thuộc hoàn toàn vào listener — fix bug "phải F5 mới vào được dashboard sau đăng nhập lại"). `window.closePaymentModal()` signOut nếu đóng `#paymentModal` giữa chừng lúc đang đăng ký mới (chưa có Firestore doc) — không áp dụng cho flow upgrade. Đăng nhập bằng email chưa đăng ký → báo lỗi inline trong `#loginErrorMsg` (cuối `#loginView`), không mở `#planSelectModal`. Xem chi tiết 3 fix ở mục "Các lỗi đã gặp" phía trên.
- **loginModal UI**: tiêu đề "Đăng ký", backdrop `rgba(0,0,0,0.85)` không blur — tạo cảm giác tập trung; có 2 view: `#loginView` (form mặc định) + `#loginWarnView` (cảnh báo Google chưa xét duyệt — hiện trước khi gọi popup)
- **login_hint + account picker**: `doLogin()` luôn set `prompt: 'select_account'` (kèm `login_hint` nếu có) → Google luôn hiện account picker. `reAuth()` cũng set `prompt: 'select_account'` (KHÔNG dùng `prompt: 'consent'` vì gây hiện "Google chưa xác minh" mỗi lần)
- **gToken + sessionStorage**: `gToken` (Google OAuth access token cho Drive API) bị reset về null mỗi khi page reload. Fix: `doLogin()` và `reAuth()` lưu `gToken` vào `sessionStorage` key `swiftcopy_gtok`; dashboard's `onAuthStateChanged` restore từ sessionStorage nếu `gToken` null. Khi logout (dashboard `!u` branch): `sessionStorage.removeItem('swiftcopy_gtok')`
- **Checklist size display**: `#srcTotalSize` bị ẩn (display:none). `#clSizeInfo` hiện "Đã chọn: X.X GB (mp4, pdf, doc...)" — size tổng + danh sách đuôi file thực tế (top 6 theo tổng dung lượng, không phải số lượng) sau khi deep scan xong. Sort theo dung lượng để extension nào chiếm nhiều GB nhất hiện đầu tiên (ví dụ mp4 sẽ lên đầu dù ít file hơn pdf).
- **planSelectModal UI**: backdrop `rgba(0,0,0,0.55)` + `blur(10px)`; cột Trọn đời nền `#fffdf5` (kem vàng nhạt). Tất cả 5 dòng tính năng cột Trọn đời in đậm (`<b>`). Nội dung cột Free: "Sao chép tốc độ cao file & thư mục" / "500 MB / 5 giờ (tự reset)" / "Kiểm tra quyền trước khi copy" / "Không copy video" / "Mất mạng/tắt máy không tự tiếp tục". Nội dung cột Trọn đời: "Sao chép tốc độ cao file & thư mục" / "Không giới hạn dung lượng" / "Sao chép video không giới hạn" / "Kể cả file không có nút tải về" / "Tự tiếp tục sau mất mạng/máy tắt".
- **paymentModal UI**: bố cục 2 cột (QR 185×185px bên trái + thông tin ngân hàng bên phải), max-width 520px; ô hướng dẫn: `border-left: 3px solid #c9a84c`, nền `#f8f9fa`, tiêu đề `#212529 700`, text bước `#495057`, highlight `#a07820 600`
- **premiumBadge icon**: SVG outline crown (vương miện 3 răng + ngang band), polygon + line, stroke `#c9a84c`
- **Premium badge**: ĐÃ implement — `#premiumBadge` hiện khi plan=paid, thay freeBanner
- **Kick screen**: ĐÃ fix — `pollKickStatus()` hiện `#s-kicked` (không signOut), user thấy lý do và phải bấm Đăng xuất
- **Readd + welcome modal**: ĐÃ implement — `doReadd()` set plan='paid' + readdedAt; `#readdWelcomeModal` hiện 1 lần sau login
- **Admin email**: không còn xử lý đặc biệt trong `app.js` — hành vi hoàn toàn giống user thường. Đăng ký → chọn gói → chờ duyệt → vào dashboard. Doc tồn tại vĩnh viễn sau khi tạo. `admin.html` vẫn gate riêng bởi `ADMIN_EMAIL` constant trong file đó.
- **Maintenance mode**: ĐÃ fix hoàn toàn — 3 chế độ (all/auth/dashboard) + off, trang riêng `admin-maintenance.html`. `getMaintenance()` gọi `/api/maintenance` (Vercel function + service account) thay vì Firestore trực tiếp → hoạt động đúng cho cả người chưa đăng nhập. Toggle bật/tắt trong card header, nhớ mode cuối qua `_lastActiveMode`. Vercel env vars cần có: `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`.
- **Register/Login separation**: ĐÃ implement — `onAuthStateChanged` check `_loginMode==='register'` + `docSnap.exists()` → signOut + toast lỗi + shake `#btnGoLogin`. Nút "Đăng nhập" có `id="btnGoLogin"`.
- **Video warning modal (paid)**: ĐÃ XOÁ flow — paid user bấm "Bắt đầu sao chép" → copy video ngay, không hỏi. `#videoWarnModal`, `showVideoWarn`, `confirmVideoWarn`, `closeVideoWarn` còn trong HTML/JS nhưng là **dead code** (không được gọi từ bất kỳ đâu). `#vidWarnOv` cũng dead code. Không khôi phục lại các call site này.
- **Responsive CSS**: ĐÃ thêm media queries vào `style.css` — ≤640px: ẩn bell/help icon, compl-stats 2×2; ≤480px: ẩn earn+lang buttons, plan-cols stack dọc, payment-grid stack dọc; 641–1024px: modal max-height+scroll; 1024–1280px: checklist max-height giảm. Classes `plan-cols` và `payment-grid` thêm vào HTML tương ứng.
- **Footer font**: Tăng 1 size — description `text-[15px]` → `text-base`, headers `text-[17.5px]` → `text-[18.5px]`, feature badge `12.5px` → `13.5px`, links/copyright `text-[15px]` → `text-base`.
- **Footer "Tính năng" column**: Mỗi item dùng `display:flex;align-items:center;gap:8px` — icon yellow verified badge SVG bên TRÁI, text bên phải. Dòng cuối dài ("Tự động copy tiếp nếu mất mạng, treo máy") dùng `align-items:flex-start` + `margin-top:3px` trên icon để canh với dòng đầu tiên khi text xuống dòng.
- **Stop confirm modal**: `#stopConfirmModal` trong `dashboard.html` — hiện khi nhấn "Dừng kiểm tra" hoặc "Dừng sao chép". Tiêu đề động theo mode. 2 nút: "Xác nhận" (nền `#e24b4a`) → `confirmStop()` → `_execStop()`; "Huỷ" → `cancelStop()`. `doReset()` KHÔNG qua modal (abort trực tiếp).
- **Calc animation #clSizeInfo**: khi deep scan đang chạy (`unloaded > 0`), `_startCalcAnim()` → vòng lặp 4 bước với dot pulse `#f5a623` và shimmer bar CSS. Tự dừng khi xong. CSS trong `style.css` (`.calc-dot-pulse`, `.calc-shimmer-wrap`, `.calc-shimmer-bar`).
- **Scan summary banner + scan detail modal**: ĐÃ implement — sau "Kiểm tra trước", nếu user bấm "Để tôi kiểm tra lại" (thay vì copy ngay), `#scanSummaryBanner` (vàng nhạt, trong khu vực Tiến trình đồng bộ) thay thế cho việc mất hẳn kết quả scan. Bấm "Xem chi tiết" mở `#scanDetailModal` (2 tab Thành công/Lỗi, tree lazy-load, tái dùng `buildTreeHTML`). Banner tự ẩn khi user thực sự bắt đầu copy. Xem chi tiết ở mục "Các lỗi đã gặp" phía trên.
- **Drive label sublabels**: Drive Nguồn hiện "(Bản gốc tải về)", Drive Đích hiện "(Tải về Drive bạn)" — `text-[10px] text-[#adb5bd]`, cùng hàng với tên label. Trong `dashboard.html`.
- **Firestore Security Rules**: ĐÃ siết — `firestore.rules` trong repo. Paste vào Firebase Console → Firestore → Rules → Publish. Quy tắc: user chỉ đọc doc của mình; tạo mới chỉ được plan='free'; cập nhật không được thay đổi plan/approved/status/email; admin (ADMIN_EMAIL) bypass toàn bộ; `settings` chỉ admin đọc/ghi trực tiếp (api/maintenance dùng service account → bypass). **QUAN TRỌNG: phải Apply rules trong Firebase Console sau mỗi lần sửa `firestore.rules`.**
- **Cổng thanh toán**: chưa có, duyệt thủ công qua admin.html (user báo đã chuyển → admin kiểm tra → bấm "Duyệt nâng cấp")
- **Đa ngôn ngữ VI/EN**: chưa implement, bấm VI/EN hiện popup "Tính năng chưa hỗ trợ"
- **Review/FAQ**: dữ liệu tĩnh trong JS, chưa nối Firestore thật
- **zalo-qr.png**: ảnh thật (đã crop), phải nằm cùng thư mục với index.html khi deploy
- **Floating support button (FAB)**: `#fabSupportWrap` — góc dưới phải cố định, có trong cả `index.html` và `dashboard.html` (markup + script inline giống hệt nhau, duplicate theo đúng pattern các utility modal khác). Nút tròn 54×54px nền `#ffc107`, icon headphone trắng, badge "Hỗ trợ" góc trên phải. Animation `.fab-wobble` (keyframe `fabWobble` trong `style.css`) lắc nhẹ định kỳ mỗi 4s, vô hạn — không lắc liên tục để tránh gây rối mắt. Click mở `#fabSupportMenu` (dropdown phía trên nút) gồm 3 mục: Hỗ trợ → mở `#supportModal`; FAQ → `openFaqModal()`; Báo lỗi → toast "chưa hỗ trợ". Click ra ngoài `#fabSupportWrap` tự đóng dropdown. **Lý do đặt script inline ngay sau markup thay vì gắn vào cuối `ui.js`**: phát hiện `ui.js` có `document.getElementById('reviewBtn').addEventListener(...)` không optional-chaining — `reviewBtn` chỉ tồn tại trong `index.html` (footer), không tồn tại trong `dashboard.html` → dòng này throw lỗi và dừng toàn bộ phần thực thi tuần tự còn lại của `ui.js` trên dashboard (các `function` declaration vẫn hoisted nên không bị ảnh hưởng, nhưng các statement chạy ngay như `addEventListener` thì không). Đặt script riêng, tự chứa, ngay tại chỗ tránh phụ thuộc vào điểm crash này. **Không sửa `ui.js`** vì ngoài phạm vi task.
- **Zalo QR hover & modal (footer index.html)**: ảnh `zalo-qr.png` trong footer có class `.zalo-qr-footer` (CSS trong `style.css`) — `transition:transform .2s ease` + `:hover{transform:scale(1.18)}`. Click ảnh → `window.openZaloQrModal()` mở `#zaloQrModal` (overlay `rgba(0,0,0,.75)`, chỉ hiện ảnh QR phóng to max-width 320px, không có khung modal trắng). Click ra ngoài đóng qua `onclick="if(event.target===this)..."` pattern có sẵn. Chỉ áp dụng cho footer trong `index.html` — `dashboard.html` không có footer.
- **og-image.png**: 1200×630px Open Graph image — tạo bằng Python Pillow, logo badge dùng `apple-touch-icon.png` thật (paste trực tiếp, không vẽ lại). Nếu cần tái tạo: yêu cầu Claude Code chạy lại gen script (lưu trong scratchpad phiên làm việc). OG tags trong `index.html` trỏ đến `og-image.png?v=N` với `?v=N` để bust cache Zalo/Facebook — tăng N mỗi lần cập nhật ảnh.

---

- **Ghost workers tiếp tục sau exception trong copy/scan**: Khi 1 worker trong `Promise.all` throw exception → `Promise.all` reject ngay, nhưng các worker còn lại tiếp tục chạy và log. Fix: trong catch block của `_runCopyInternal` và `startScan`, luôn set `stopFlag=true; abortCtrl?.abort(); abortCtrl=null; while(_videoWaiters.length) _videoWaiters.shift()();` TRƯỚC khi log lỗi — không chỉ cho AbortError/AuthExpired case mà cho mọi exception bất ngờ.
- **app.js quá lớn (~2100 dòng) gây rối trí và fix sai**: Đã tách thành 4 file: `state.js` (63L shared state), `drive-api.js` (185L Drive API), `auth.js` (400L Firebase+auth), `app.js` (1380L copy+scan+UI). Tất cả share cùng object `st` từ state.js — mutation visible ngay. Dependency: `state.js` ← `drive-api.js` ← `auth.js` ← `app.js`. Không có circular dep. HTML không cần sửa — `<script type="module" src="app.js">` tự load transitive imports.
- **#clSizeInfo hiện sai tổng GB sau khi "tính xong" — undercount với drive có nhiều thư mục lồng sâu**: Root cause: `deepLoadAllFolders()` gọi `listItems()` trực tiếp (không retry) cho từng folder unloaded; nếu Drive API trả lỗi tạm thời (429/500/503 — rất dễ gặp khi BFS quét hàng trăm folder liên tiếp, càng sâu càng nhiều lệnh gọi tích lũy → càng dễ dính rate limit), catch block set `item.children = []` ngay lập tức — coi như folder đó rỗng vĩnh viễn, không retry. Kết quả: `calcSelectedBytes()` tính thiếu các file nằm trong những folder bị lỗi, đặc biệt rõ ở các nhánh sâu nhất (nơi tích lũy nhiều request nhất). `_stopCalcAnim()` vẫn chạy bình thường (vì `countUnloadedSelectedFolders()` không phân biệt "đã load thật" với "load rỗng do lỗi") nên animation dừng và hiện số — nhưng là số sai, thấp hơn thực tế. Fix: thêm `listItemsRetry(id)` trong `app.js` (exponential backoff 500ms base, tối đa 4 lần, retry cho 429/500/503 — cùng pattern với `copyFileSingle`/`testFileCopy` trong `drive-api.js`); `deepLoadAllFolders` gọi `listItemsRetry` thay vì `listItems` trực tiếp. Lỗi AUTH_EXPIRED vẫn throw ngay (không retry) để `handleAuthExpired()` xử lý đúng.
- **Đăng ký lần 2 lỗi sau khi đóng paymentModal/paymentConfirmModal giữa chừng (popup mở tab mới, bị đẩy về landing không báo lỗi, F5 hiện planSelectModal)**: Root cause: nút "✕" và backdrop-click của `#paymentModal` chỉ gỡ class `active`, không `signOut()` — khi user bỏ ngang ở bước thanh toán (đã có Firebase Auth session từ `signInWithPopup` nhưng CHƯA có Firestore doc vì `createPaidPendingUser()` chưa chạy), Firebase session "ghost" này vẫn tồn tại. Lần đăng ký kế tiếp khởi đầu không sạch — `signInWithPopup` gọi lại trên session đã có sẵn cookie/credential gây hành vi thất thường (đổi sang tab mới, hoặc `onAuthStateChanged` không re-fire đúng). Fix: thêm `window.closePaymentModal()` trong `auth.js` — gỡ `active` rồi `signOut(auth)` nếu `st._paymentContext==='new' && st.gUser && !st.gUserData` (tức đang mid-registration, chưa có doc thật — phân biệt với flow upgrade Free→Paid của user đã duyệt, KHÔNG được signOut). Đổi `onclick` của nút ✕ và backdrop-click trên `#paymentModal` trong `index.html` từ `classList.remove('active')` trực tiếp sang gọi `window.closePaymentModal()`. `#paymentConfirmModal` không có nút ✕ riêng — đóng qua "Kiểm tra lại" quay về `#paymentModal` nên đã được bao phủ.
- **Đăng nhập lại sau đăng xuất không vào dashboard — phải F5 hoặc mở tab mới mới hoạt động**: Root cause: toàn bộ logic điều hướng sau đăng nhập (check Firestore doc, redirect `/copy-drive`) nằm độc quyền trong `onAuthStateChanged` callback của `auth.js`; callback này đôi khi không re-fire kịp thời/đáng tin cậy ngay sau một lần `signOut()` gần đó trong cùng tab (Firebase Auth SDK quirk) → `doLogin()` resolve xong (`signInWithPopup` thành công, có user) nhưng không có gì điều hướng tiếp → kẹt ở landing đến khi F5 (load lại module, đọc lại persisted session, listener fire sạch). Fix: tách toàn bộ logic điều hướng landing-cho-user-đã-đăng-nhập trong `onAuthStateChanged` ra hàm riêng `async function _routeLandingAuthedUser(u)` trong `auth.js`; gọi hàm này ở **2 nơi** — (1) `onAuthStateChanged` như cũ, và (2) trực tiếp trong `doLogin()` ngay sau khi `signInWithPopup` resolve thành công (dùng `res.user`) — không còn phụ thuộc hoàn toàn vào listener. Biến module-level `_routingLanding` (boolean) làm re-entrancy guard — nếu cả 2 đường gọi trùng nhau cho cùng 1 lần đăng nhập (gần như đồng thời) thì lệnh gọi thứ 2 no-op, tránh `getDoc`/`signOut` chạy đôi.
- **Đăng nhập bằng email chưa đăng ký hiện `#planSelectModal` thay vì báo lỗi**: Root cause: nhánh kiểm tra "doc Firestore không tồn tại" trong `onAuthStateChanged`/`_routeLandingAuthedUser` chạy **trước** và **không phân biệt** `st._loginMode` — áp dụng `showPlanSelect()` cho mọi trường hợp doc không tồn tại, kể cả khi user bấm "Đăng nhập" (chỉ nên áp dụng khi bấm "Đăng ký"). Fix: trong `_routeLandingAuthedUser`, thêm nhánh kiểm tra `st._loginMode === 'login' && !exists` **trước** nhánh `!exists` chung — nếu đúng: `signOut(auth)` rồi (sau 150ms, cùng pattern với nhánh "đăng ký trùng") gọi `window.openLoginModal('login')` + hiện lỗi qua `showLoginError('Tài khoản này chưa được đăng ký. Vui lòng thực hiện đăng ký để tiếp tục.')` — **không** mở `#planSelectModal`. Thêm `<div id="loginErrorMsg">` (ẩn mặc định) vào cuối `#loginView` trong `index.html`, dưới khối Terms. `window.hideLoginError()` được gọi trong `openLoginModal()` (mỗi lần mở modal) và `handleLoginContinue()` (mỗi lần thử lại) để xoá lỗi cũ.

---

## Khi nhận task mới

1. Đọc CLAUDE.md này trước (đã xong nếu bạn đang đọc đây).
2. Đọc phần code liên quan trước khi sửa:
   - Logic auth/plan/payment → đọc `auth.js`
   - Drive API calls → đọc `drive-api.js`
   - Copy/scan/checklist/progress/UI → đọc `app.js`
   - Biến shared → xem `state.js`
   - UI dùng chung (header, utility modals) → kiểm tra cả 2 HTML file
3. Sau khi sửa: kiểm tra JS syntax, kiểm tra duplicate ID, kiểm tra tag balance `<div>`.
4. Không giải trình dài dòng — làm xong báo cáo ngắn gọn những gì đã thay đổi và tại sao.
5. Nếu task ảnh hưởng đến cả `admin.html`, nêu rõ và sửa cả hai file.
