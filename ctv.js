/* ══════════════ CTV (Cộng Tác Viên) — Logic ══════════════
   Dùng cho ctv.html (đăng ký & đăng nhập) và ctv-dashboard.html
   Firebase config giống hệt các file khác trong project.
   ══════════════════════════════════════════════════════════ */
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, addDoc, getDoc, doc, serverTimestamp,
         updateDoc, orderBy, increment }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDu5D6bB-FxJl2E71Ls17GwHVtqZV0FwF8",
  authDomain: "swiftcopy-drive.firebaseapp.com",
  projectId: "swiftcopy-drive",
  storageBucket: "swiftcopy-drive.firebasestorage.app",
  messagingSenderId: "477488339991",
  appId: "1:477488339991:web:7d47100631b846b1189052"
};

const fbApp   = initializeApp(firebaseConfig);
const auth    = getAuth(fbApp);
export const db = getFirestore(fbApp);
const provider  = new GoogleAuthProvider();

let currentUser = null;
let currentCTVDoc = null; // {id, ...data} khi đã là CTV

// ── Auth ──────────────────────────────────────────────────────
window.loginCTV = async function() {
  try {
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
    // onAuthStateChanged xử lý điều hướng
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      showMsg('Đăng nhập thất bại. Vui lòng thử lại.', 'err');
    }
  }
};

window.logoutCTV = async function() {
  await signOut(auth);
  window.location.href = '/ctv';
};

// ── Status check ──────────────────────────────────────────────
// Trả về: { state: 'affiliate'|'existing_user'|'eligible', status?, doc? }
export async function checkCTVStatus(user) {
  // 1. Kiểm tra affiliates theo email (Security Rule cho phép đọc email match)
  const q = query(collection(db, 'affiliates'), where('email', '==', user.email));
  const snap = await getDocs(q);
  if (!snap.empty) {
    const d = snap.docs[0].data();
    return { state: 'affiliate', status: d.status, doc: { id: snap.docs[0].id, ...d } };
  }

  // 2. Kiểm tra users theo uid (CTV có thể đọc doc của chính mình)
  const userSnap = await getDoc(doc(db, 'users', user.uid));
  if (userSnap.exists()) {
    return { state: 'existing_user' };
  }

  return { state: 'eligible' };
}

// ── Gửi đơn đăng ký ──────────────────────────────────────────
window.submitCTVForm = async function() {
  if (!currentUser) { showMsg('Vui lòng đăng nhập trước.', 'err'); return; }

  const name  = document.getElementById('ctvName')?.value.trim() || '';
  const phone = document.getElementById('ctvPhone')?.value.trim() || '';
  const note  = document.getElementById('ctvNote')?.value.trim() || '';
  const terms = document.getElementById('ctvTerms')?.checked;

  if (!name)  { showMsg('Vui lòng nhập họ tên.', 'err'); return; }
  if (!phone) { showMsg('Vui lòng nhập số điện thoại.', 'err'); return; }
  if (!terms) { showMsg('Vui lòng đồng ý điều khoản trước khi gửi.', 'err'); return; }

  const btn = document.getElementById('ctvSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Đang gửi...'; }

  try {
    await addDoc(collection(db, 'affiliates'), {
      name, email: currentUser.email, phone,
      note: note || '',
      status: 'pending',
      code: null,
      commissionRate: 0.5,
      totalEarned: 0, totalPaid: 0,
      totalClients: 0, totalConverted: 0,
      createdAt: serverTimestamp()
    });

    // Gửi email thông báo admin
    fetch('/api/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'admin_ctv_applied',
        userName: name, userEmail: currentUser.email,
        phone, note: note || '',
        siteUrl: 'https://swiftcopydrive.com'
      })
    }).catch(() => {});

    showSection('success');
  } catch (e) {
    showMsg('Có lỗi xảy ra: ' + e.message, 'err');
    if (btn) { btn.disabled = false; btn.textContent = 'Gửi đơn đăng ký'; }
  }
};

// ── Helper hiển thị section ───────────────────────────────────
// Dùng trên trang ctv.html — ctv-dashboard.html có logic riêng
function showSection(name) {
  const all = ['loading','unauthenticated','pending','redirecting','user_conflict','register_form','success'];
  all.forEach(s => {
    const el = document.getElementById('sec-' + s);
    if (el) el.style.display = s === name ? 'block' : 'none';
  });
}

function showMsg(msg, type) {
  const el = document.getElementById('ctvGlobalMsg');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.style.color = type === 'err' ? '#dc3545' : '#099268';
  el.style.background = type === 'err' ? '#fff5f5' : '#ebfbee';
  el.style.border = '1px solid ' + (type === 'err' ? '#ffe3e3' : '#d3f9d8');
}

// ── onAuthStateChanged — chỉ chạy trên ctv.html ─────────────
if (document.getElementById('sec-loading')) {
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (!user) { showSection('unauthenticated'); return; }

    showSection('loading');
    try {
      const result = await checkCTVStatus(user);

      if (result.state === 'affiliate') {
        currentCTVDoc = result.doc;
        if (result.status === 'active') {
          showSection('redirecting');
          setTimeout(() => { window.location.href = '/ctv-dashboard'; }, 1800);
        } else if (result.status === 'pending') {
          showSection('pending');
        } else {
          // suspended / rejected
          showMsg('Tài khoản CTV của bạn đã bị ' + result.status + '.', 'err');
          showSection('unauthenticated');
        }
      } else if (result.state === 'existing_user') {
        showSection('user_conflict');
      } else {
        // Eligible — hiện form đăng ký với email đã biết
        const emailEl = document.getElementById('ctvEmailDisplay');
        const nameInp = document.getElementById('ctvName');
        if (emailEl) emailEl.textContent = user.email;
        if (nameInp && user.displayName) nameInp.value = user.displayName;
        showSection('register_form');
      }
    } catch (e) {
      showMsg('Lỗi kiểm tra thông tin: ' + e.message, 'err');
      showSection('unauthenticated');
    }
  });
}

// ── Terms modal — fetch từ Firestore (ctv.html) ──────────────
const _termsCache = {};
window.openTermsModal = async function(type) {
  const modal   = document.getElementById('termsModal');
  const titleEl = document.getElementById('termsModalTitle');
  const contentEl = document.getElementById('termsModalContent');
  if (!modal) return;
  titleEl.textContent = type === 'ctv_terms' ? 'Điều khoản CTV' : 'Điều khoản thanh toán hoa hồng';
  contentEl.textContent = 'Đang tải...';
  modal.style.display = 'flex';
  if (_termsCache[type]) { contentEl.textContent = _termsCache[type]; return; }
  try {
    const snap = await getDoc(doc(db, 'settings', type));
    const text = snap.exists() ? (snap.data().text || '') : '(Admin chưa cập nhật nội dung.)';
    _termsCache[type] = text;
    contentEl.textContent = text;
  } catch { contentEl.textContent = '(Không thể tải nội dung. Vui lòng thử lại.)'; }
};
window.closeTermsModal = function() {
  const el = document.getElementById('termsModal');
  if (el) el.style.display = 'none';
};

// ══════════════════════════════════════════════════════════════
// DASHBOARD LOGIC — chỉ chạy trên ctv-dashboard.html
// Guard: document.getElementById('dash-loading') chỉ có ở đây
// ══════════════════════════════════════════════════════════════
if (document.getElementById('dash-loading')) {
  let _dash = null;        // { id, ...affiliateDoc fields }
  let _comms = [];         // commission records sorted createdAt desc
  let _currentTab = 0;

  // helper: ẩn tất cả screens, hiện screen chỉ định
  function _showScreen(name) {
    ['dash-loading','dash-error','dash-main'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = id === name ? (id === 'dash-main' ? 'block' : 'flex') : 'none';
    });
  }

  function _toast(msg) {
    const t = document.getElementById('dashToast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
  }

  function _fmtMoney(n) {
    return (n || 0).toLocaleString('vi-VN') + 'đ';
  }

  function _fmtDate(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('vi-VN');
  }

  function _maskEmail(email) {
    if (!email) return '—';
    const [user, domain] = email.split('@');
    if (user.length <= 4) return email;
    const visible = user.slice(0, 2);
    const end = user.slice(-2);
    return visible + '****' + end + '@' + domain;
  }

  // ── Tab switching ─────────────────────────────────────────
  window.switchDashTab = function(n) {
    _currentTab = n;
    for (let i = 0; i < 4; i++) {
      const panel = document.getElementById('dash-tab-' + i);
      const btn   = document.getElementById('dash-tab-btn-' + i);
      if (panel) panel.style.display = i === n ? 'block' : 'none';
      if (btn)   btn.classList.toggle('active', i === n);
    }
    if (n === 1) _renderClients();
    if (n === 2) _renderHistory();
    if (n === 3) _renderProfile();
  };

  // ── Tab 0: Tổng quan ──────────────────────────────────────
  function _renderOverview() {
    const now  = new Date();
    const todayStart  = new Date(now); todayStart.setHours(0,0,0,0);
    const weekStart   = new Date(now.getTime() - 7*24*60*60*1000);
    const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1);

    const earnToday  = _comms.filter(c => c.createdAt?.toDate?.() >= todayStart).reduce((s,c)=>s+c.amount,0);
    const earnWeek   = _comms.filter(c => c.createdAt?.toDate?.() >= weekStart ).reduce((s,c)=>s+c.amount,0);
    const earnMonth  = _comms.filter(c => c.createdAt?.toDate?.() >= monthStart).reduce((s,c)=>s+c.amount,0);
    const pending    = _comms.filter(c => c.status === 'pending').reduce((s,c)=>s+c.amount,0);
    const paid       = _dash.totalPaid || 0;
    const clients    = _dash.totalClients || 0;
    const converted  = _dash.totalConverted || _comms.length;
    const rate       = clients > 0 ? Math.round(converted / clients * 100) : 0;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('stat-today',    _fmtMoney(earnToday));
    set('stat-week',     _fmtMoney(earnWeek));
    set('stat-month',    _fmtMoney(earnMonth));
    set('stat-pending',  _fmtMoney(pending));
    set('stat-paid',     _fmtMoney(paid));
    set('stat-rate',     rate + '%');
    set('stat-clients',  clients);
    set('stat-converted', converted);

    const link = 'https://swiftcopydrive.com?r=' + _dash.code;
    const ld = document.getElementById('affLinkDisplay');
    if (ld) ld.textContent = link;
  }

  // ── Tab 1: Danh sách khách (converted = có commission) ───
  function _renderClients() {
    const tbody = document.getElementById('clients-tbody');
    const badge = document.getElementById('clients-count-badge');
    if (!tbody) return;

    const rows = _comms;
    if (badge) badge.textContent = rows.length + ' khách';

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:#adb5bd">Chưa có khách nào mua Trọn đời qua link của bạn</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((c, i) => `
      <tr>
        <td style="color:#868e96">${i+1}</td>
        <td style="font-weight:600">${_maskEmail(c.userEmail)}</td>
        <td>${_fmtDate(c.createdAt)}</td>
        <td style="font-weight:700;color:#099268">${_fmtMoney(c.amount)}</td>
        <td>${c.status === 'paid'
          ? '<span style="background:#e6fcf5;color:#099268;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">Đã thanh toán</span>'
          : '<span style="background:#fffbea;color:#b07600;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">Chờ thanh toán</span>'
        }</td>
      </tr>`).join('');
  }

  // ── Tab 2: Lịch sử hoa hồng ──────────────────────────────
  function _renderHistory() {
    const tbody = document.getElementById('comm-tbody');
    const badge = document.getElementById('comm-count-badge');
    if (!tbody) return;

    if (badge) badge.textContent = _comms.length + ' giao dịch';

    if (!_comms.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:#adb5bd">Chưa có hoa hồng nào</td></tr>';
      return;
    }

    tbody.innerHTML = _comms.map((c, i) => `
      <tr>
        <td style="color:#868e96">${i+1}</td>
        <td>${_maskEmail(c.userEmail)}</td>
        <td>${_fmtDate(c.createdAt)}</td>
        <td style="font-weight:700;color:#212529">${_fmtMoney(c.amount)}</td>
        <td>${c.status === 'paid'
          ? '<span style="background:#e6fcf5;color:#099268;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">Đã TT</span>'
          : '<span style="background:#fffbea;color:#b07600;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">Chờ TT</span>'
        }</td>
        <td style="color:#868e96">${c.paidAt ? _fmtDate(c.paidAt) : '—'}</td>
      </tr>`).join('');
  }

  // ── Tab 3: Thông tin CTV ──────────────────────────────────
  function _renderProfile() {
    const link = 'https://swiftcopydrive.com?r=' + _dash.code;
    const ld2 = document.getElementById('affLinkDisplay2');
    if (ld2) ld2.textContent = link;
    const cd = document.getElementById('ctvCodeDisplay');
    if (cd) cd.textContent = _dash.code;

    // Điền thông tin ngân hàng nếu đã lưu
    if (_dash.bankInfo) {
      const bi = _dash.bankInfo;
      const bn = document.getElementById('bankName');
      const ba = document.getElementById('bankAccount');
      const bh = document.getElementById('bankHolder');
      if (bn) bn.value = bi.bankName || '';
      if (ba) ba.value = bi.bankAccount || '';
      if (bh) bh.value = bi.bankHolder || '';
    }

    // Trạng thái urgentRequest + giới hạn tháng
    const urgentPend = document.getElementById('urgent-pending-info');
    const urgentBtn  = document.getElementById('urgentBtn');
    const urgentRemEl = document.getElementById('urgent-remaining');
    const thisMonth  = new Date().toISOString().slice(0, 7);
    const sameMonth  = (_dash.urgentPayReqMonth || '') === thisMonth;
    const usedCount  = sameMonth ? (_dash.urgentPayReqCount || 0) : 0;
    const remaining  = Math.max(0, 2 - usedCount);
    if (urgentRemEl) urgentRemEl.textContent = remaining + '/2 lượt còn lại tháng này';
    if (_dash.urgentRequest) {
      if (urgentPend) urgentPend.style.display = 'block';
      if (urgentBtn)  { urgentBtn.disabled = true; urgentBtn.style.opacity = '.5'; urgentBtn.textContent = 'Đang chờ xử lý...'; }
    } else if (remaining === 0) {
      if (urgentBtn)  { urgentBtn.disabled = true; urgentBtn.style.opacity = '.5'; urgentBtn.textContent = 'Đã hết lượt tháng này'; }
    }
  }

  // ── Copy affiliate link ───────────────────────────────────
  window.copyAffLink = function() {
    const link = 'https://swiftcopydrive.com?r=' + _dash.code;
    navigator.clipboard.writeText(link).then(() => _toast('Đã sao chép link!')).catch(() => _toast('Sao chép thất bại'));
  };

  // ── Lưu thông tin ngân hàng ──────────────────────────────
  window.saveBankInfo = async function() {
    const bankName    = document.getElementById('bankName')?.value.trim() || '';
    const bankAccount = document.getElementById('bankAccount')?.value.trim() || '';
    const bankHolder  = document.getElementById('bankHolder')?.value.trim() || '';
    if (!bankName || !bankAccount || !bankHolder) {
      _toast('Vui lòng điền đầy đủ 3 trường ngân hàng');
      return;
    }
    const btn = document.getElementById('saveBankBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu...'; }
    try {
      await updateDoc(doc(db, 'affiliates', _dash.id), { bankInfo: { bankName, bankAccount, bankHolder } });
      _dash.bankInfo = { bankName, bankAccount, bankHolder };
      _toast('Đã lưu thông tin ngân hàng!');
    } catch (e) {
      _toast('Lỗi lưu: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Lưu thông tin ngân hàng'; }
    }
  };

  // ── Yêu cầu thanh toán gấp ───────────────────────────────
  window.requestUrgentPayment = async function() {
    const pending = _comms.filter(c => c.status === 'pending').reduce((s,c)=>s+c.amount,0);
    if (pending === 0) { _toast('Không có hoa hồng nào đang chờ thanh toán'); return; }

    // Giới hạn 2 lần/tháng
    const thisMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
    const sameMonth = (_dash.urgentPayReqMonth || '') === thisMonth;
    const reqCount  = sameMonth ? (_dash.urgentPayReqCount || 0) : 0;
    if (reqCount >= 2) {
      _toast('Bạn đã sử dụng 2/2 lượt yêu cầu thanh toán gấp tháng này. Vui lòng chờ tháng sau.');
      return;
    }

    const btn = document.getElementById('urgentBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang gửi yêu cầu...'; }
    try {
      const newCount = reqCount + 1;
      await updateDoc(doc(db, 'affiliates', _dash.id), {
        urgentRequest: true,
        urgentPayReqCount: newCount,
        urgentPayReqMonth: thisMonth
      });
      _dash.urgentRequest = true;
      _dash.urgentPayReqCount = newCount;
      _dash.urgentPayReqMonth = thisMonth;
      // Thông báo admin
      fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'ctv_urgent_payment',
          ctvName: _dash.name, toCTVEmail: _dash.email,
          amount: pending, code: _dash.code,
          siteUrl: 'https://swiftcopydrive.com'
        })
      }).catch(() => {});
      const urgentPend = document.getElementById('urgent-pending-info');
      if (urgentPend) urgentPend.style.display = 'block';
      if (btn) { btn.textContent = 'Đang chờ xử lý...'; btn.style.opacity = '.5'; }
      _toast('Yêu cầu đã được gửi! Admin sẽ xử lý trong 24h.');
    } catch (e) {
      _toast('Lỗi gửi yêu cầu: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = 'Yêu cầu thanh toán gấp'; }
    }
  };

  // ── onAuthStateChanged — chỉ chạy trên ctv-dashboard.html ─
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = '/ctv'; return; }

    try {
      const result = await checkCTVStatus(user);
      if (result.state !== 'affiliate' || result.status !== 'active') {
        window.location.href = '/ctv';
        return;
      }

      _dash = result.doc;
      currentUser = user;

      // Load commissions — sắp xếp theo createdAt mới nhất trước
      const commSnap = await getDocs(
        query(collection(db, 'affiliates', _dash.id, 'commissions'), orderBy('createdAt', 'desc'))
      );
      _comms = commSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Set header
      const navName = document.getElementById('ctvNavName');
      const navCode = document.getElementById('ctvNavCode');
      if (navName) navName.textContent = _dash.name;
      if (navCode) navCode.textContent = _dash.code;

      _renderOverview();
      _showScreen('dash-main');

    } catch (e) {
      const errMsg = document.getElementById('dash-error-msg');
      if (errMsg) errMsg.textContent = e.message;
      _showScreen('dash-error');
    }
  });
}
