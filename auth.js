/* ══════════════ FIREBASE AUTH + PLAN/PAYMENT + MAINTENANCE ══════════════
   Imports: Firebase SDK + state.js
   Exports: db  (Firestore instance — used by app.js for saveHist/updateDoc)
   All auth functions are attached to window.* for HTML onclick handlers.
   Cross-module calls (sec, toast, etc.) go via st.* callbacks set by app.js.
   ══════════════════════════════════════════════════════════════════════ */
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp, onSnapshot,
         collection, getDocs, where, query, increment }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { st, IS_DASHBOARD, FREE_MB_LIMIT, FREE_RESET_MS, releasePauseWaiters } from './state.js';

const firebaseConfig = {
  apiKey: "AIzaSyDu5D6bB-FxJl2E71Ls17GwHVtqZV0FwF8",
  authDomain: "swiftcopy-drive.firebaseapp.com",
  projectId: "swiftcopy-drive",
  storageBucket: "swiftcopy-drive.firebasestorage.app",
  messagingSenderId: "477488339991",
  appId: "1:477488339991:web:7d47100631b846b1189052"
};

const ADMIN_EMAIL = "hgntran.contact@gmail.com";
const SITE_URL    = "https://swiftcopydrive.vercel.app";

const fbApp    = initializeApp(firebaseConfig);
const auth     = getAuth(fbApp);
export const db = getFirestore(fbApp);
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive');

// ── Auth UI ───────────────────────────────────────────────────
window.doLogin = async () => {
  document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
  const hint = document.getElementById('loginEmailHint')?.value?.trim() || '';
  provider.setCustomParameters({ prompt: 'select_account', ...(hint ? { login_hint: hint } : {}) });
  try {
    const res = await signInWithPopup(auth, provider);
    st.gToken = GoogleAuthProvider.credentialFromResult(res)?.accessToken;
    if (st.gToken) sessionStorage.setItem('swiftcopy_gtok', st.gToken);
    // Drive routing directly off the popup result — onAuthStateChanged can be slow/flaky
    // to re-fire right after a recent signOut, so don't rely on it alone (Bug: stuck on landing).
    if (!IS_DASHBOARD && res.user) { st.gUser = res.user; await _routeLandingAuthedUser(res.user); }
  } catch (e) { st.toast?.('Đăng nhập thất bại', 'err'); }
};

window.showLoginWarn = () => {
  const lv = document.getElementById('loginView');
  const wv = document.getElementById('loginWarnView');
  if (lv) lv.style.display = 'none';
  if (wv) wv.style.display = 'block';
  const cb = document.getElementById('loginWarnCheck');
  const btn = document.getElementById('loginWarnBtn');
  if (cb) cb.checked = false;
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
};

window.hideLoginWarn = () => {
  const lv = document.getElementById('loginView');
  const wv = document.getElementById('loginWarnView');
  if (lv) lv.style.display = 'block';
  if (wv) wv.style.display = 'none';
};

window.hideLoginError = () => {
  const el = document.getElementById('loginErrorMsg');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
};

function showLoginError(msg) {
  const el = document.getElementById('loginErrorMsg');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

window.openLoginModal = (mode = 'register') => {
  if (IS_DASHBOARD) { window.location.href = '/'; return; }
  st._loginMode = mode;
  const titleEl = document.getElementById('loginModalTitle');
  if (titleEl) titleEl.textContent = mode === 'login' ? 'Đăng nhập' : 'Đăng ký';
  document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
  document.getElementById('loginModal')?.classList.add('active');
  window.hideLoginWarn();
  window.hideLoginError();
};

window.handleLoginContinue = () => {
  window.hideLoginError();
  if (st._loginMode === 'login') { window.doLogin(); } else { window.showLoginWarn(); }
};

window.openRegisterModal = () => window.openLoginModal();
window.doLogout = () => signOut(auth);

// Closing the payment modal mid-registration (before the Firestore doc is created) leaves a
// "ghost" signed-in Firebase session with no doc — the next register attempt then behaves
// inconsistently. Sign out so every new attempt starts clean, exactly like the first time.
// Upgrade flow (already-approved user) uses the same modal but must NOT be signed out.
window.closePaymentModal = async () => {
  document.getElementById('paymentModal')?.classList.remove('active');
  if (!IS_DASHBOARD && st._paymentContext === 'new' && st.gUser && !st.gUserData) {
    st._loginMode = null;
    await signOut(auth);
  }
};

window.reAuth = async () => {
  try {
    provider.setCustomParameters({ prompt: 'select_account' });
    const res = await signInWithPopup(auth, provider);
    st.gToken = GoogleAuthProvider.credentialFromResult(res)?.accessToken;
    if (st.gToken) sessionStorage.setItem('swiftcopy_gtok', st.gToken);
    const el = document.getElementById('authSuccessToast');
    if (el) { el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3500); }
    const sv = document.getElementById('srcInput')?.value.trim();
    const dv = document.getElementById('destInput')?.value.trim();
    if (sv) window.onInputChange?.('src');
    if (dv) window.onInputChange?.('dest');
    await _handleReauthSuccess();
  } catch (e) { st.toast?.('Lỗi cấp quyền: ' + e.message, 'err'); }
};

async function _handleReauthSuccess() {
  if (st._resumeAfterReauth === 'copy') {
    st._resumeAfterReauth = null;
    st.toast?.('Đã cấp quyền lại - tiếp tục sao chép...', 'ok');
    await window.startCopy?.(true);
  } else {
    st._resumeAfterReauth = null;
  }
}

// Called when any Drive API call hits 401 with existing token
export function handleAuthExpired() {
  if (st._authExpiredHandled) return;
  st._authExpiredHandled = true;
  st.gToken = null;
  st.stopFlag = true; st.pauseFlag = false;
  st.abortCtrl?.abort(); st.abortCtrl = null;
  releasePauseWaiters();
  while (st._videoWaiters.length) st._videoWaiters.shift()();
  st._resumeAfterReauth = (st.runMode === 'copy') ? 'copy' : null;
  window.setStatus?.('Đã dừng - cần cấp quyền lại');
  st.showNoAuth?.('Phiên cấp quyền đã hết hạn', 'Quyền truy cập Google Drive đã hết hạn sau một thời gian. Vui lòng cấp quyền lại để tiếp tục.');
}

// ── Maintenance ───────────────────────────────────────────────
function getMaintenance() {
  if (!st._maintenancePromise) {
    st._maintenancePromise = fetch('/api/maintenance')
      .then(r => r.ok ? r.json() : { mode: 'off', allowedEmails: [] })
      .catch(() => ({ mode: 'off', allowedEmails: [] }));
  }
  return st._maintenancePromise;
}

function getMaintenanceResult(mode, allowedEmails, userEmail) {
  if (!mode || mode === 'off') return null;
  if (userEmail && (allowedEmails || []).includes(userEmail)) return null;
  switch (mode) {
    case 'all':       return 'maintenance';
    case 'auth':      return userEmail ? null : 'maintenance';
    case 'dashboard': return userEmail ? 'maintenance' : null;
    default:          return null;
  }
}

// ── Landing routing for an authenticated user ───────────────────
// Shared by onAuthStateChanged and doLogin(). Calling it directly right after a
// successful signInWithPopup makes routing work even when onAuthStateChanged is
// slow/flaky to re-fire right after a recent signOut (bug: stuck on landing until F5).
// _routingLanding re-entrancy guard avoids both callers racing the same getDoc/signOut.
let _routingLanding = false;
async function _routeLandingAuthedUser(u) {
  if (_routingLanding) return;
  _routingLanding = true;
  try {
    const maint = await getMaintenance();
    const mode = maint.mode || (maint.enabled ? 'all' : 'off');
    const allowedEmails = maint.allowedEmails || [];
    const mResult = getMaintenanceResult(mode, allowedEmails, u.email);
    if (mResult === 'maintenance') { st.sec?.('maintenance'); return; }
    document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
    try {
      const docSnap = await getDoc(doc(db, 'users', u.uid));
      const exists = docSnap.exists();
      if (st._loginMode === 'login' && !exists) {
        await signOut(auth);
        setTimeout(() => {
          window.openLoginModal('login');
          showLoginError('Tài khoản của bạn đã bị xoá trước đó. Vui lòng đăng ký lại trên trang chủ để tiếp tục sử dụng.');
        }, 150);
        return;
      }
      if (!exists) {
        st.setNavUser?.(u);
        showPlanSelect();
        return;
      }
      if (st._loginMode === 'register') {
        // Admin test account: skip the "already registered" block so the admin can
        // repeatedly re-register (re-pick Free/Paid) without manually deleting the
        // Firestore doc each time — createFreeUser()/createPaidPendingUser() overwrite
        // the doc via setDoc(). Normal users still get blocked below.
        if (u.email === ADMIN_EMAIL) {
          st.setNavUser?.(u);
          showPlanSelect();
          return;
        }
        await signOut(auth);
        setTimeout(() => {
          st.toast?.('Tài khoản này đã được đăng ký. Vui lòng chọn Đăng nhập.', 'err');
          const btn = document.getElementById('btnGoLogin');
          if (btn) { btn.classList.add('shake-hint'); setTimeout(() => btn.classList.remove('shake-hint'), 600); }
          window.openLoginModal('login');
        }, 150);
        return;
      }
      const d = docSnap.data();
      if (d.status === 'kicked') _notifyAdminKicked(u, d.kickReason);
      const approved = await checkApproval(u);
      if (approved) {
        if (checkReaddWelcome()) return;
        window.location.href = '/copy-drive';
      } else {
        window.location.href = '/copy-drive';
      }
    } catch (e) { window.location.href = '/copy-drive'; }
  } finally {
    _routingLanding = false;
  }
}

// ── onAuthStateChanged ────────────────────────────────────────
getMaintenance(); // pre-fetch so it's cached when onAuthStateChanged fires

onAuthStateChanged(auth, async u => {
  const maint = await getMaintenance();
  const mode = maint.mode || (maint.enabled ? 'all' : 'off');
  const allowedEmails = maint.allowedEmails || [];

  // ── LANDING ────────────────────────────────────────────────
  if (!IS_DASHBOARD) {
    if (!u) {
      const mResult = getMaintenanceResult(mode, allowedEmails, null);
      if (mResult === 'maintenance') { st.sec?.('maintenance'); return; }
      st.sec?.('land');
      return;
    }
    st.gUser = u;
    await _routeLandingAuthedUser(u);
    return;
  }

  // ── DASHBOARD ──────────────────────────────────────────────
  if (!u) {
    st.gUser = null; st.gToken = null; st.gUserData = null;
    sessionStorage.removeItem('swiftcopy_gtok');
    if (st._kickPollTimer) { clearInterval(st._kickPollTimer); st._kickPollTimer = null; }
    _stopUserDocListener();
    const mResult0 = getMaintenanceResult(mode, allowedEmails, null);
    if (mResult0 === 'maintenance') { st.sec?.('maintenance'); return; }
    window.location.href = '/';
    return;
  }
  st.gUser = u;
  if (!st.gToken) { const t = sessionStorage.getItem('swiftcopy_gtok'); if (t) st.gToken = t; }
  const mResult = getMaintenanceResult(mode, allowedEmails, u.email);
  if (mResult === 'maintenance') { st.sec?.('maintenance'); return; }
  if (mResult === 'landing') { window.location.href = '/'; return; }

  try {
    const docSnap = await getDoc(doc(db, 'users', u.uid));
    if (!docSnap.exists()) { await signOut(auth); window.location.href = '/'; return; }
    const d = docSnap.data();
    if (d.status === 'kicked') _notifyAdminKicked(u, d.kickReason);
    const approved = await checkApproval(u);
    st.setNavUser?.(u);
    if (approved) {
      document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
      st.sec?.('app'); st.checkResume?.(); st.updateFreeBanner?.();
      if (st._kickPollTimer) clearInterval(st._kickPollTimer);
      st._kickPollTimer = setInterval(_pollKickStatus, 30000);
      _startUserDocListener(u.uid);
    } else if (st.gUserData?.status === 'kicked') {
      st.sec?.('kicked');
      const el = document.getElementById('kickedReasonText');
      if (el) el.textContent = st.gUserData.kickReason ? `Lý do: ${st.gUserData.kickReason}` : 'Lý do: Vi phạm điều khoản sử dụng.';
    } else {
      st.sec?.('pend');
    }
  } catch (e) { st.setNavUser?.(u); st.sec?.('pend'); }
});

async function _pollKickStatus() {
  if (!st.gUser) return;
  try {
    const snap = await getDoc(doc(db, 'users', st.gUser.uid));
    if (!snap.exists() || snap.data().status !== 'approved' || !snap.data().approved) {
      if (st._kickPollTimer) { clearInterval(st._kickPollTimer); st._kickPollTimer = null; }
      st.stopFlag = true; st.pauseFlag = false;
      st.abortCtrl?.abort(); st.abortCtrl = null;
      releasePauseWaiters();
      while (st._videoWaiters.length) st._videoWaiters.shift()();
      const d = snap.exists() ? snap.data() : {};
      st.gUserData = snap.exists() ? { id: st.gUser.uid, ...d } : null;
      st.sec?.('kicked');
      const el = document.getElementById('kickedReasonText');
      if (el) el.textContent = d.kickReason ? `Lý do: ${d.kickReason}` : 'Lý do: Vi phạm điều khoản sử dụng.';
    }
  } catch (e) { console.warn('pollKickStatus', e); }
}

// ── Realtime kick/delete listener (onSnapshot) ────────────────
let _userDocUnsubscribe = null;

function _stopUserDocListener() {
  if (_userDocUnsubscribe) { _userDocUnsubscribe(); _userDocUnsubscribe = null; }
}

function _startUserDocListener(uid) {
  _stopUserDocListener();
  _userDocUnsubscribe = onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      // First snapshot fires immediately after subscribe — user is already approved at this point,
      // so we skip it to avoid false positive. Only react to subsequent changes.
      if (!snap.exists()) { _stopUserDocListener(); _reactToKick(null); return; }
      const d = snap.data();
      if (d.status === 'kicked' || !d.approved) { _stopUserDocListener(); _reactToKick(d); }
    },
    (err) => { console.warn('userDoc listener:', err.code); }
  );
}

function _reactToKick(d) {
  if (st._kickPollTimer) { clearInterval(st._kickPollTimer); st._kickPollTimer = null; }
  st.stopFlag = true; st.pauseFlag = false;
  st.abortCtrl?.abort(); st.abortCtrl = null;
  releasePauseWaiters();
  while (st._videoWaiters.length) st._videoWaiters.shift()();
  st.gUserData = d ? { id: st.gUser?.uid, ...d } : null;
  st.sec?.('kicked');
  const el = document.getElementById('kickedReasonText');
  if (el) el.textContent = d?.kickReason ? `Lý do: ${d.kickReason}` : 'Lý do: Vi phạm điều khoản sử dụng.';
}

async function checkApproval(u) {
  const snap = await getDoc(doc(db, 'users', u.uid));
  if (!snap.exists()) return false;
  const d = snap.data();
  st.gUserData = { id: u.uid, ...d };
  if (d.plan === 'free' && d.approved && (d.freeUsedMB === undefined || !d.freeResetAt)) {
    const upd = {};
    if (d.freeUsedMB === undefined) { upd.freeUsedMB = 0; st.gUserData.freeUsedMB = 0; }
    if (!d.freeResetAt) { upd.freeResetAt = serverTimestamp(); st.gUserData.freeResetAt = { toMillis: () => Date.now() }; }
    try { await updateDoc(doc(db, 'users', u.uid), upd); } catch (e) { console.warn('migration', e); }
  }
  return d.status !== 'kicked' && d.approved === true;
}

// ── Email helpers ─────────────────────────────────────────────
function _gasPost(payload) {
  fetch('/api/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
}
export function sendRegEmail(u)           { _gasPost({ type: 'new_registration', userEmail: u.email, userName: u.displayName || u.email, plan: 'free' }); }
export function sendUpgradeRequestEmail(u){ _gasPost({ type: 'upgrade_request',  userEmail: u.email, userName: u.displayName || u.email }); }
function _notifyAdminKicked(u, reason)    { _gasPost({ type: 'kick_alert',       userEmail: u.email, userName: u.displayName || u.email, reason: reason || '?' }); }
function _sendRegisterFreeSuccessEmail(u) { _gasPost({ type: 'register_free_success', toEmail: u.email, userName: u.displayName || u.email, siteUrl: SITE_URL }); }
function _sendRegisterPaidPendingEmail(u) { _gasPost({ type: 'register_paid_pending',  toEmail: u.email, userName: u.displayName || u.email, siteUrl: SITE_URL }); }

// ── Affiliate referral helper ─────────────────────────────────
// Reads affiliateCode from localStorage, validates TTL (30 days),
// clears after reading so it's only applied once at doc creation.
function _getAffiliateFields() {
  const code = localStorage.getItem('affiliateCode');
  const at   = parseInt(localStorage.getItem('affiliateAt') || '0');
  const TTL  = 30 * 24 * 60 * 60 * 1000;
  if (!code || (Date.now() - at) >= TTL) return {};
  localStorage.removeItem('affiliateCode');
  localStorage.removeItem('affiliateAt');
  return { referredBy: code, referredAt: serverTimestamp() };
}

function _maskEmail(email) {
  const [user, domain] = (email || '').split('@');
  if (!domain || user.length <= 4) return email;
  const show = Math.max(2, Math.floor(user.length / 4));
  return user.slice(0, show) + '****' + user.slice(-show) + '@' + domain;
}

async function _incrementCTVClient(code) {
  if (!code) return;
  try {
    const snap = await getDocs(query(collection(db, 'affiliates'), where('code', '==', code)));
    if (snap.empty) return;
    await updateDoc(snap.docs[0].ref, { totalClients: increment(1) });
    // ctv_new_signup chỉ gửi khi khách mua Trọn đời (approveUpgrade trong admin.html)
    // không gửi khi đăng ký free để tránh thông báo nhầm cho CTV
  } catch {} // silent — không để lỗi CTV block luồng đăng ký user
}

// ── Plan selection ────────────────────────────────────────────
function showPlanSelect() {
  document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
  if (IS_DASHBOARD) {
    ['check', 'pend', 'kicked', 'app', 'maintenance'].forEach(s => {
      const el = document.getElementById('s-' + s); if (el) el.style.display = 'none';
    });
  } else {
    st.sec?.('land', true);
  }
  document.getElementById('planSelectModal')?.classList.add('active');
}

// Called from landing CTA and timed popup (before auth). After auth it's called internally.
window.openPlanSelectModal = () => showPlanSelect();

window.closePlanSelect = async () => {
  document.getElementById('planSelectModal')?.classList.remove('active');
  // Only sign out if the user already completed Google auth (mid-registration).
  // Pre-auth plan preview (no gUser yet) must not sign out — nothing to sign out from.
  if (st.gUser) await signOut(auth);
};

// Wrapper buttons in planSelectModal: route to login if not yet authenticated.
window.choosePlanFree = () => {
  if (!st.gUser) { document.getElementById('planSelectModal')?.classList.remove('active'); window.openLoginModal('register'); }
  else window.createFreeUser();
};
window.choosePlanPaid = () => {
  if (!st.gUser) { document.getElementById('planSelectModal')?.classList.remove('active'); window.openLoginModal('register'); }
  else window.openPlanSelectPaid();
};

window.createFreeUser = async () => {
  if (!st.gUser) return;
  document.getElementById('planSelectModal')?.classList.remove('active');
  try {
    const affFields = _getAffiliateFields();
    const userData = {
      email: st.gUser.email, displayName: st.gUser.displayName, photoURL: st.gUser.photoURL,
      approved: true, status: 'approved', plan: 'free',
      freeUsedMB: 0, freeResetAt: serverTimestamp(),
      upgradeRequestedAt: null, createdAt: serverTimestamp(),
      ...affFields
    };
    await setDoc(doc(db, 'users', st.gUser.uid), userData);
    if (affFields.referredBy) _incrementCTVClient(affFields.referredBy);
    sendRegEmail(st.gUser);
    _sendRegisterFreeSuccessEmail(st.gUser);
    window.location.href = '/copy-drive';
  } catch (e) { st.toast?.('Lỗi tạo tài khoản: ' + e.message, 'err'); await signOut(auth); }
};

window.openPlanSelectPaid = () => {
  st._paymentContext = 'new';
  document.getElementById('planSelectModal')?.classList.remove('active');
  const upgradeBtn = document.getElementById('paymentUpgradeBtn');
  const loginBtn   = document.getElementById('paymentLoginBtn');
  if (upgradeBtn) upgradeBtn.style.display = 'flex';
  if (loginBtn)   loginBtn.style.display   = 'none';
  document.getElementById('paymentModal')?.classList.add('active');
};

async function createPaidPendingUser() {
  if (!st.gUser) return;
  try {
    const affFields = _getAffiliateFields();
    const userData = {
      email: st.gUser.email, displayName: st.gUser.displayName, photoURL: st.gUser.photoURL,
      approved: false, status: 'pending', plan: 'free',
      freeUsedMB: 0, freeResetAt: serverTimestamp(),
      upgradeRequestedAt: serverTimestamp(), createdAt: serverTimestamp(),
      ...affFields
    };
    await setDoc(doc(db, 'users', st.gUser.uid), userData);
    if (affFields.referredBy) _incrementCTVClient(affFields.referredBy);
    st.gUserData = { id: st.gUser.uid, ...userData };
    sendUpgradeRequestEmail(st.gUser);
    _sendRegisterPaidPendingEmail(st.gUser);
    st.setNavUser?.(st.gUser);
    st.sec?.('pend');
  } catch (e) { st.toast?.('Lỗi: ' + e.message, 'err'); }
}

// ── Payment flow ──────────────────────────────────────────────
window.showPaymentConfirm = () => {
  document.getElementById('paymentModal')?.classList.remove('active');
  document.getElementById('paymentConfirmModal')?.classList.add('active');
};

window.backToPaymentModal = () => {
  document.getElementById('paymentConfirmModal')?.classList.remove('active');
  document.getElementById('paymentModal')?.classList.add('active');
};

window.copyText = (text, btn) => {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '✓'; btn.style.color = '#099268';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 1500);
  }).catch(() => st.toast?.('Không copy được', 'err'));
};

window.confirmPayment = async () => {
  document.getElementById('paymentConfirmModal')?.classList.remove('active');
  document.getElementById('paymentModal')?.classList.remove('active');
  if (st._paymentContext === 'new') {
    await createPaidPendingUser();
  } else {
    await _doUpgradeRequestInternal();
  }
};

// ── Readd welcome ─────────────────────────────────────────────
// Flag is keyed to the specific readdedAt timestamp (not just the uid) so the
// modal shows again on every new re-add event, not just once ever per account
// (bug: a user re-added a 2nd time never saw the welcome modal again).
function checkReaddWelcome() {
  if (!st.gUser || !st.gUserData || !st.gUserData.readdedAt) return false;
  const readdedMs = st.gUserData.readdedAt?.toMillis?.() ?? Date.now();
  const flagKey = 'swiftcopy_readd_' + st.gUser.uid;
  if (localStorage.getItem(flagKey) === String(readdedMs)) return false;
  localStorage.setItem(flagKey, String(readdedMs));
  const el = document.getElementById('readdWelcomeModal');
  if (el) { el.classList.add('active'); return true; }
  return false;
}

window.closeReaddWelcome = () => {
  document.getElementById('readdWelcomeModal')?.classList.remove('active');
  if (!IS_DASHBOARD) window.location.href = '/copy-drive';
};

// ── Upgrade (free → paid) ─────────────────────────────────────
window.openUpgradeModal = () => {
  st._paymentContext = 'upgrade';
  const loginBtn   = document.getElementById('paymentLoginBtn');
  const upgradeBtn = document.getElementById('paymentUpgradeBtn');
  if (loginBtn)   loginBtn.style.display   = 'none';
  if (upgradeBtn) upgradeBtn.style.display = 'flex';
  document.getElementById('paymentModal')?.classList.add('active');
};

window.openUpgradeFromLimit = () => {
  window.closeFreeLimitModal?.();
  window.openUpgradeModal();
};

async function _doUpgradeRequestInternal() {
  if (!st.gUserData || !st.gUser) return;
  if (st.gUserData.upgradeRequestedAt) {
    st.toast?.('Yêu cầu nâng cấp đã được gửi, admin đang xử lý', 'info');
    return;
  }
  try {
    await updateDoc(doc(db, 'users', st.gUser.uid), { upgradeRequestedAt: serverTimestamp() });
    st.gUserData.upgradeRequestedAt = { toMillis: () => Date.now() };
    sendUpgradeRequestEmail(st.gUser);
    st.updateFreeBanner?.();
    st.toast?.('Đã gửi yêu cầu! Admin sẽ xác nhận thanh toán và kích hoạt sớm nhất', 'ok');
  } catch (e) { st.toast?.('Lỗi: ' + e.message, 'err'); }
}

window.doUpgradeRequest = () => window.showPaymentConfirm();

export { handleAuthExpired as _handleAuthExpired };
