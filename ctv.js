/* ══════════════ CTV (Cộng Tác Viên) — Logic ══════════════
   Dùng cho ctv.html (đăng ký & đăng nhập) và ctv-dashboard.html
   Firebase config giống hệt các file khác trong project.
   ══════════════════════════════════════════════════════════ */
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, addDoc, getDoc, doc, serverTimestamp }
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

// ── onAuthStateChanged — chỉ chạy trên ctv.html ──────────────
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
