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

**`index.html`, `admin.html`, `admin-maintenance.html` độc lập hoàn toàn** — không import lẫn nhau, không share component. Nếu sửa config chung (firebaseConfig, ADMIN_EMAIL) phải sửa ở CẢ BA file.

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

## Cấu trúc bên trong index.html (sau khi tách file)

### HTML (~600 dòng — chỉ còn HTML thuần)
- `<head>`: Tailwind CDN, favicon, `<link rel="stylesheet" href="style.css">`
- SVG sprite: icon dùng lại qua `<use href="#ic-...">`
- 6 section: `#s-land` (landing), `#s-check` (đang kiểm tra auth), `#s-pend` (chờ duyệt), `#s-app` (dashboard thật), `#s-kicked` (bị kick — hiển thị lý do, nút Đăng xuất), `#s-maintenance` (bảo trì — hiện cho user không được phép khi maintenance bật)
- **Modals auth/plan**: `#loginModal` (premium design, Google OAuth + email hint), `#planSelectModal` (chọn gói Free/Paid sau login), `#paymentModal` (thông tin chuyển khoản), `#paymentConfirmModal` (xác nhận đã chuyển — bước trung gian trước confirmPayment), `#readdWelcomeModal` (chào mừng user được admin thêm lại)
- **Modals app**: `#modalOv`, `#vidWarnOv`, `#complOv`, `#langModal`, `#supportModal`, `#earnModal`, `#addReviewModal` (gộp list + form), `#reviewListModal` (giữ lại nhưng không gọi từ UI), `#faqModal`, `#policyModal` (dùng chung cho 3 chính sách), `#policyAndReviewModal` (hub từ header), `#pvFullscreenOverlay`, `#freeLimitModal`
- **Banner/badge dashboard**: `#freeBanner` (render innerHTML động — 3 trạng thái), `#premiumBadge` (vàng #c9a84c, crown icon — hiện khi plan=paid)
- Preview Dashboard: `id="pvCard"` — animation minh hoạ cho khách chưa đăng nhập
- Cuối body: `<script type="module" src="app.js"></script>` + `<script src="ui.js"></script>`

**Lưu ý `#startModal` đã bị xóa hoàn toàn** — thay bằng `#loginModal` + `#planSelectModal`.

### app.js — ES module (~1200 dòng)
Nhóm hàm chính:
- **Firebase/Auth**: `onAuthStateChanged`, `checkApproval`, `doLogin`, `doLogout`, `reAuth`, `setNavUser`
- **Plan selection (new)**: `showPlanSelect`, `closePlanSelect` (sign out nếu đóng), `createFreeUser`, `openPlanSelectPaid`, `createPaidPendingUser`
- **Payment flow (new)**: `showPaymentConfirm`, `confirmPayment`, `_doUpgradeRequestInternal`, `openUpgradeModal`
  - `doUpgradeRequest` là alias của `showPaymentConfirm` (backward compat)
  - `_paymentContext`: `'new'` | `'upgrade'` — quyết định `confirmPayment()` làm gì
- **Kicked screen**: `pollKickStatus` — hiện `sec('kicked')` thay vì `signOut()` khi bị kick
- **Readd welcome (new)**: `checkReaddWelcome` (gọi sau login), `closeReaddWelcome`
  - localStorage key: `swiftcopy_readd_{uid}` — đảm bảo modal chỉ hiện 1 lần
- **Maintenance**: `getMaintenance()` (cached promise, gọi `/api/maintenance` — Vercel function dùng service account) + `getMaintenanceResult(mode, allowedEmails, userEmail)` → `'maintenance'|'landing'|null`. `sec('check')` và `getMaintenance()` gọi ngay khi module load. `onAuthStateChanged` gọi `sec('check')` trước mọi await. Chỉ `allowedEmails` bypass — ADMIN_EMAIL không có xử lý đặc biệt trong `app.js`. **QUAN TRỌNG: KHÔNG đọc Firestore trực tiếp từ browser cho `settings/maintenance`** — phải luôn qua `/api/maintenance` vì người chưa đăng nhập bị Security Rules chặn.
- **Drive API wrapper**: `dget`, `dpost`, `ddel`, `fid`, `fname`, `listItems`, `existNames`, `copyFileSingle`, `mkFolder` — có retry exponential backoff cho 429/500/503
- **Auth expiry**: `isAuthExpiredErr`, `handleAuthExpired` — xử lý 401 giữa chừng, tự resume sau khi reauth
- **Checklist**: `loadChecklist`, `renderChecklist` — cây thư mục lazy-load, checkbox 3 trạng thái
- **Scan**: `startScan`, `scanNodes` — test quyền bằng copy-thử-rồi-xóa ngay
- **Copy**: `startCopy`, `_runCopyInternal`, `copyRecTree` — đa luồng (CONCUR=8 file, FOLDER_CONCUR=3)
- **Progress**: `progStart`, `progInc`, `progFinish` — indeterminate mode, không pre-scan
- **Session/resume**: `saveSession`, `checkResume`, `resumeSession` — lưu localStorage key `swiftcopy_session`
- **UI helpers**: `sec`, `setBtnMode`, `setStatus`, `addLog`, `updStats`, `updateFreeBanner`, `toast` (expose qua `window.toast`)

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

### Biến module-level quan trọng trong app.js
| Biến | Mô tả |
|---|---|
| `gUserData` | Full Firestore user document (set bởi `checkApproval()`) |
| `_loginMode` | `'register'` hoặc `'login'` — set bởi `openLoginModal(mode)`, dùng bởi `handleLoginContinue()` để quyết định có hiện `#loginWarnView` hay gọi `doLogin()` trực tiếp |
| `_paymentContext` | `'new'` hoặc `'upgrade'` — `confirmPayment()` dùng để quyết định gọi `createPaidPendingUser()` hay `_doUpgradeRequestInternal()` |
| `_sessionCopiedMB` | MB đã copy trong phiên hiện tại, cộng vào `freeUsedMB` khi copy xong |
| `_freeLimitTimer` | `setInterval` ID cho countdown trong `#freeLimitModal` |
| `_kickPollTimer` | `setInterval` ID cho `pollKickStatus()` — clearInterval khi logout hoặc kicked |

**`_pendingPlan` đã bị xóa** — thay bằng `_paymentContext`.

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

// Free plan (trong app.js)
const FREE_MB_LIMIT = 500;
const FREE_RESET_MS = 5 * 60 * 60 * 1000; // 5 giờ
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
| Font | Nunito (heading 800) + Nunito Sans (body) |

### Dashboard user (#s-app)
- **Cards**: `rounded-2xl` + `p-5 md:p-6` + `shadow-sm hover:shadow-md transition-shadow`
- **Card headers**: icon badge (icon trong ô màu nhỏ 28×28) thay vì emoji — config card dùng folder icon nền fffbea, progress card dùng bolt icon nền fff9db
- **Input section**: source→dest flow với arrow SVG divider ở giữa + icon màu nhỏ ở label (green=source, blue=dest)
- **Action buttons**: `py-2.5 text-[12px] rounded-xl border-2` — scan=đỏ outline, start=amber fill+shadow, pause=vàng outline, resume=xanh outline, reset=dark fill
- **Stats cards**: `rounded-xl h-[70px] text-2xl md:text-3xl` font numbers, 3 gaps `gap-3`
- **Premium badge**: dark `#111110` bg + gold `#c9a84c` border 1.5px + box-shadow amber nhẹ + icon badge + divider dọc + feature summary

### Admin panel (admin.html)
- **Nav**: height 60px, có logo SVG (cùng SVG với index.html), badge "ADMIN" vàng
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
- **`Đã chọn: X MB` hiện 0 hoặc NaN với drive hỗn hợp Google Docs/Sheets/Slides + file thường**: Google native format không có `size` field trong Drive API → `parseInt(undefined) = NaN → NaN || 0 = 0` → tổng bytes = 0 → hiện "0 MB". Fix: thêm `countNativeSelected()` đếm riêng số file Google native (mimeType starts with `application/vnd.google-apps.` và không phải FMIME/SMIME); thêm NaN guard `const mb = isNaN(rawMb) ? 0 : rawMb`; cập nhật `updateClInfo()` để hiện `(+N Google Docs/Sheets/Slides)` bên cạnh size khi `native > 0`. Đổi `toFixed(0)` → `toFixed(1)` để tránh làm tròn sai cho file nhỏ.
- **Thiếu tổng dung lượng Drive nguồn khi load checklist**: User không biết thư mục nguồn nặng bao nhiêu trước khi copy. Fix: thêm `updateSrcTotalInfo()` — tính tổng bytes của tất cả file cấp đầu trong `clItems` (loại trừ FMIME, SMIME, Google native riêng), hiển thị "Thư mục nguồn: ~X.X MB · Y Google file · Z thư mục" trong `#srcTotalSize` div ngay trên `#clSizeInfo`. Gọi tự động sau khi `loadChecklist` hoàn tất.
- **Đăng nhập Google không hiện account picker, cấp quyền Drive không hiện consent screen**: `doLogin()` gọi `setCustomParameters({})` (hoặc chỉ có `login_hint`) → Firebase dùng phiên Google đang đăng nhập mà không cho chọn tài khoản. `reAuth()` không set params → Google bỏ qua consent screen nếu đã cấp quyền trước đó. Fix: `doLogin()` thêm `prompt: 'select_account'` vào params; `reAuth()` gọi `provider.setCustomParameters({ prompt: 'consent' })` trước `signInWithPopup` để luôn hiện màn hình phê duyệt quyền Drive chi tiết.
- **[CHẨN ĐOÁN SAI — BÀI HỌC QUAN TRỌNG] Maintenance không hoạt động cho người chưa đăng nhập (Bảo trì 1 & 2)**: Triệu chứng: incognito và tài khoản chưa đăng ký vẫn thấy landing thay vì trang bảo trì. Chẩn đoán ban đầu SAI: cứ đề nghị sửa Firestore Security Rules trong Firebase Console thay vì tìm giải pháp code. Nguyên nhân thật: `getMaintenance()` đọc Firestore trực tiếp từ browser → Security Rules chặn người chưa auth → catch trả `{ mode:'off' }` → maintenance không bao giờ áp dụng. Fix đúng: tạo `api/maintenance.js` (Vercel serverless + service account JWT) → đọc Firestore server-side → bypass Security Rules hoàn toàn → tất cả 3 mode hoạt động cho mọi loại user. **Quy tắc rút ra: bất kỳ Firestore collection nào cần đọc bởi người CHƯA đăng nhập → PHẢI đọc qua Vercel server-side function, KHÔNG đọc trực tiếp từ browser.**

---

## Trạng thái hiện tại (để tiếp tục đúng chỗ)

- **Đang deploy**: Vercel (`swiftcopydrive.vercel.app`) — sắp mua domain `swiftcopydrive.com`
- **CI/CD**: Vercel tự động deploy khi push lên GitHub
- **Email system**: ĐÃ hoạt động — `GAS_URL` lưu trong Vercel env var, proxy qua `api/email.js`, confirmed working (kick/readd/approve/upgrade đều gửi được)
- **SITE_URL trong email**: đã set `https://swiftcopydrive.com` trong `admin.html` — khi mua domain xong chỉ cần trỏ domain về Vercel, không cần sửa code
- **Auth flow**: ĐÃ implement luồng mới — #loginModal premium + #planSelectModal (chọn Free/Paid sau login), #startModal đã bị xóa
- **loginModal UI**: tiêu đề "Đăng ký", backdrop `rgba(0,0,0,0.85)` không blur — tạo cảm giác tập trung; có 2 view: `#loginView` (form mặc định) + `#loginWarnView` (cảnh báo Google chưa xét duyệt — hiện trước khi gọi popup)
- **login_hint + account picker**: `doLogin()` luôn set `prompt: 'select_account'` (kèm `login_hint` nếu có) → Google luôn hiện account picker. `reAuth()` set `prompt: 'consent'` → luôn hiện màn hình phê duyệt Drive scope chi tiết
- **Checklist size display**: `#srcTotalSize` hiện tổng file cấp đầu của thư mục nguồn ngay khi load; `#clSizeInfo` hiện "Đã chọn: X.X MB (+N Google file)" với NaN guard và native file count
- **planSelectModal UI**: backdrop `rgba(0,0,0,0.55)` + `blur(10px)`; cột Trọn đời nền `#fffdf5` (kem vàng nhạt)
- **paymentModal UI**: bố cục 2 cột (QR 185×185px bên trái + thông tin ngân hàng bên phải), max-width 520px; ô hướng dẫn: `border-left: 3px solid #c9a84c`, nền `#f8f9fa`, tiêu đề `#212529 700`, text bước `#495057`, highlight `#a07820 600`
- **premiumBadge icon**: SVG outline crown (vương miện 3 răng + ngang band), polygon + line, stroke `#c9a84c`
- **Premium badge**: ĐÃ implement — `#premiumBadge` hiện khi plan=paid, thay freeBanner
- **Kick screen**: ĐÃ fix — `pollKickStatus()` hiện `#s-kicked` (không signOut), user thấy lý do và phải bấm Đăng xuất
- **Readd + welcome modal**: ĐÃ implement — `doReadd()` set plan='paid' + readdedAt; `#readdWelcomeModal` hiện 1 lần sau login
- **Admin email**: không còn xử lý đặc biệt trong `app.js` — hành vi hoàn toàn giống user thường. Đăng ký → chọn gói → chờ duyệt → vào dashboard. Doc tồn tại vĩnh viễn sau khi tạo. `admin.html` vẫn gate riêng bởi `ADMIN_EMAIL` constant trong file đó.
- **Maintenance mode**: ĐÃ fix hoàn toàn — 3 chế độ (all/auth/dashboard) + off, trang riêng `admin-maintenance.html`. `getMaintenance()` gọi `/api/maintenance` (Vercel function + service account) thay vì Firestore trực tiếp → hoạt động đúng cho cả người chưa đăng nhập. Toggle bật/tắt trong card header, nhớ mode cuối qua `_lastActiveMode`. Vercel env vars cần có: `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`.
- **Firestore Security Rules**: CHƯA siết — đây là rủi ro bảo mật cao nhất, cần làm trước khi mở rộng user base
- **Cổng thanh toán**: chưa có, duyệt thủ công qua admin.html (user báo đã chuyển → admin kiểm tra → bấm "Duyệt nâng cấp")
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
