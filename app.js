/* ══════════════ REAL BUSINESS LOGIC (Firebase Auth + Google Drive API) ══════════════ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDu5D6bB-FxJl2E71Ls17GwHVtqZV0FwF8",
  authDomain: "swiftcopy-drive.firebaseapp.com",
  projectId: "swiftcopy-drive",
  storageBucket: "swiftcopy-drive.firebasestorage.app",
  messagingSenderId: "477488339991",
  appId: "1:477488339991:web:7d47100631b846b1189052"
};
// GAS_URL đã chuyển vào Vercel env var — xem api/email.js
const ADMIN_EMAIL = "hgntran.contact@gmail.com"; // luôn reset doc khi đăng nhập lại để test

// Free plan limits
const FREE_MB_LIMIT = 500;
const FREE_RESET_MS = 5 * 60 * 60 * 1000; // 5 giờ

const fbApp    = initializeApp(firebaseConfig);
const auth     = getAuth(fbApp);
const db       = getFirestore(fbApp);
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive');

let gUser = null, gToken = null;
let gUserData = null;          // full Firestore user document
let _paymentContext = null;    // 'new' | 'upgrade' — context khi mở paymentModal
let _loginMode = 'register';   // 'register' | 'login' — set trước khi mở loginModal
let _adminBypassActive = false; // true khi admin dùng bypass login (không có Firestore doc)
let pauseFlag = false, stopFlag = false, runMode = 'idle';
let stats = ns();
let _resumeResolve = null;
// Checklist state
let clItems = [];     // flat list of { id, name, mimeType, size, parentId, depth, expanded, checked, indeterminate }
let clLoaded = false;
// Drag-select state
let _dragActive = false, _dragCheckValue = null;
// Video file extensions to detect
const VIDEO_EXT = /\.(mp4|mov|mkv|avi|wmv|flv|webm|m4v|mpg|mpeg|3gp|ts|m2ts)$/i;
const VIDEO_MIME = /^video\//;
let _pendingCopyResume = false;
// Auth-expiry handling
let _authExpiredHandled = false;
let _resumeAfterReauth = null; // 'copy' if a copy run was interrupted by token expiry
// Free quota tracking
let _sessionCopiedMB = 0;      // MB copied in current copy session
let _freeLimitTimer = null;    // countdown interval for free limit modal
let _kickPollTimer  = null;    // 30s interval to detect kick while in dashboard

function ns(){ return { copied:0, failed:0, folders:0, copiedFiles:[], failedFiles:[], folderList:[] }; }

// ── OVERLAY ─────────────────────────────────────────────────
window.closeNoAuth = () => {
  document.getElementById('noAuthBackdrop').classList.remove('show');
  document.getElementById('noAuthPanel').classList.remove('show');
  _authExpiredHandled = false;
  _resumeAfterReauth = null;
};
window.reAuthFromOverlay = async () => {
  const pendingResume = _resumeAfterReauth;
  closeNoAuth();
  _resumeAfterReauth = pendingResume;
  await reAuth();
};
function showNoAuth(title, msg) {
  document.getElementById('noAuthTitle').textContent = title || 'Chưa cấp quyền Drive';
  document.getElementById('noAuthMsg').textContent   = msg   || 'Nhấn nút bên dưới để cấp quyền.';
  document.getElementById('noAuthBackdrop').classList.add('show');
  document.getElementById('noAuthPanel').classList.add('show');
}
function showAuthOK() {
  const el = document.getElementById('authSuccessToast');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3500);
}

// ── PAUSE/RESUME ─────────────────────────────────────────────
function pausePoint(){ return pauseFlag ? new Promise(r => { _resumeResolve = r; }) : Promise.resolve(); }
window.doPause = () => {
  pauseFlag = true;
  document.getElementById('btnPause').style.display  = 'none';
  document.getElementById('btnResume').style.display = 'inline-flex';
  setProgress(null,null,'paused');
  addLog('Tạm dừng','warn');
};
window.doResume = () => {
  pauseFlag = false;
  document.getElementById('btnPause').style.display  = 'inline-flex';
  document.getElementById('btnResume').style.display = 'none';
  setProgress(null,null, runMode==='scan'?'scanning':'running');
  addLog('Tiếp tục','info');
  if (_resumeResolve){ _resumeResolve(); _resumeResolve=null; }
};
window.handleScanBtn  = () => { if(runMode==='scan')  doStopScan();  else startScan(); };
window.handleStartBtn = () => { if(runMode==='copy')  doStopCopy();  else window.startCopy(); };
function doStopScan()  { stopFlag=true; pauseFlag=false; if(_resumeResolve){_resumeResolve();_resumeResolve=null;} }
function doStopCopy()  { stopFlag=true; pauseFlag=false; if(_resumeResolve){_resumeResolve();_resumeResolve=null;} }

window.doReset = () => {
  stopFlag=true; pauseFlag=false;
  if(_resumeResolve){_resumeResolve();_resumeResolve=null;}
  stats=ns(); updStats(); clItems=[]; clLoaded=false;
  document.getElementById('srcInput').value  = '';
  document.getElementById('destInput').value = '';
  document.getElementById('srcPreview').style.display  = 'none';
  document.getElementById('destPreview').style.display = 'none';
  document.getElementById('checklistWrap').style.display = 'none';
  document.getElementById('progFill').style.width  = '0%';
  document.getElementById('progFill').className    = 'prog-fill';
  document.getElementById('logBox').innerHTML      = '';
  document.getElementById('scanResult').style.display = 'none';
  /* statsRow kept visible always */
  setStatus('Chưa bắt đầu');
  clearSession(); setBtnMode('idle');
  toast('Đã reset toàn bộ','ok');
};

// ── AUTH ─────────────────────────────────────────────────────
window.doLogin = async () => {
  document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
  try {
    const res = await signInWithPopup(auth, provider);
    gToken = GoogleAuthProvider.credentialFromResult(res)?.accessToken;
  } catch(e) { toast('Đăng nhập thất bại','err'); }
};
window.openLoginModal = (mode = 'register') => {
  _loginMode = mode;
  document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
  document.getElementById('loginModal')?.classList.add('active');
};
// openRegisterModal giờ chỉ mở loginModal — plan selection xảy ra sau login
window.openRegisterModal = () => window.openLoginModal('register');

window.doLogout = async () => {
  _adminBypassActive = false;
  if (gUser?.email === ADMIN_EMAIL) {
    try { await deleteDoc(doc(db,'users',gUser.uid)); } catch(e){}
  }
  await signOut(auth);
};
window.reAuth   = async () => {
  try {
    const res=await signInWithPopup(auth,provider);
    gToken=GoogleAuthProvider.credentialFromResult(res)?.accessToken;
    showAuthOK();
    // Re-trigger folder name preview for inputs that already have values
    const sv=document.getElementById('srcInput').value.trim();
    const dv=document.getElementById('destInput').value.trim();
    if (sv) window.onInputChange('src');
    if (dv) window.onInputChange('dest');
    await handleReauthSuccess();
  }
  catch(e){ toast('Lỗi cấp quyền: '+e.message,'err'); }
};

// If the previous run was interrupted by an expired token while copying,
// automatically resume it once a fresh token is obtained.
async function handleReauthSuccess(){
  if (_resumeAfterReauth === 'copy'){
    _resumeAfterReauth = null;
    toast('Đã cấp quyền lại - tiếp tục sao chép...','ok');
    await window.startCopy(true);
  } else {
    _resumeAfterReauth = null;
  }
}

// Called whenever any Drive operation hits AUTH_EXPIRED (401 with an existing token).
function handleAuthExpired(){
  if (_authExpiredHandled) return;
  _authExpiredHandled = true;
  gToken = null;
  stopFlag = true; pauseFlag = false;
  if (_resumeResolve){ _resumeResolve(); _resumeResolve=null; }
  _resumeAfterReauth = (runMode==='copy') ? 'copy' : null;
  setStatus('Đã dừng - cần cấp quyền lại');
  showNoAuth('Phiên cấp quyền đã hết hạn','Quyền truy cập Google Drive đã hết hạn sau một thời gian. Vui lòng cấp quyền lại để tiếp tục.');
}

onAuthStateChanged(auth, async u => {
  if (!u){
    gUser=null; gToken=null; gUserData=null;
    if (_kickPollTimer){ clearInterval(_kickPollTimer); _kickPollTimer=null; }
    document.getElementById('planSelectModal')?.classList.remove('active');
    sec('land'); return;
  }
  gUser=u; sec('check');
  try {
    // Kiểm tra document tồn tại chưa
    const docSnap = await getDoc(doc(db,'users',u.uid));
    // Admin email: xử lý 2 mode
    if (u.email === ADMIN_EMAIL) {
      setNavUser(u);
      const mode = _loginMode;
      _loginMode = 'register'; // reset sau khi dùng
      if (mode === 'login') {
        // Bypass mode: vào dashboard ngay, không cần Firestore doc
        _adminBypassActive = true;
        gUserData = {
          id: u.uid, email: u.email, displayName: u.displayName || u.email,
          photoURL: u.photoURL || '', plan: 'paid', approved: true, status: 'approved',
          freeUsedMB: 0, freeResetAt: { toMillis: () => Date.now() }
        };
        sec('app'); updateFreeBanner();
      } else {
        // Register mode: xóa doc → planSelectModal như user mới
        _adminBypassActive = false;
        if (docSnap.exists()) await deleteDoc(doc(db,'users',u.uid));
        showPlanSelect();
      }
      return;
    }
    if (!docSnap.exists()){
      // User mới — hiện modal chọn gói, KHÔNG tạo doc ngay
      setNavUser(u);
      showPlanSelect();
      return;
    }
    // User cũ bị kick → thông báo admin
    const d = docSnap.data();
    if (d.status === 'kicked') notifyAdminKicked(u, d.kickReason);
    const approved = await checkApproval(u);
    setNavUser(u);
    if (approved){
      sec('app'); checkResume(); updateFreeBanner(); checkReaddWelcome();
      if (_kickPollTimer) clearInterval(_kickPollTimer);
      _kickPollTimer = setInterval(pollKickStatus, 30000);
    }
    else if (gUserData?.status === 'kicked'){
      sec('kicked');
      const el = document.getElementById('kickedReasonText');
      if (el) el.textContent = gUserData.kickReason ? `Lý do: ${gUserData.kickReason}` : 'Lý do: Vi phạm điều khoản sử dụng.';
    }
    else sec('pend');
  } catch(e){ setNavUser(u); sec('pend'); }
});

async function pollKickStatus(){
  if (!gUser || _adminBypassActive) return;
  try {
    const snap = await getDoc(doc(db,'users',gUser.uid));
    if (!snap.exists() || snap.data().status !== 'approved' || !snap.data().approved){
      if (_kickPollTimer){ clearInterval(_kickPollTimer); _kickPollTimer=null; }
      stopFlag=true; pauseFlag=false;
      if (_resumeResolve){ _resumeResolve(); _resumeResolve=null; }
      const d = snap.exists() ? snap.data() : {};
      gUserData = snap.exists() ? { id: gUser.uid, ...d } : null;
      sec('kicked');
      const el = document.getElementById('kickedReasonText');
      if (el) el.textContent = d.kickReason ? `Lý do: ${d.kickReason}` : 'Lý do: Vi phạm điều khoản sử dụng.';
    }
  } catch(e){ console.warn('pollKickStatus',e); }
}

async function checkApproval(u){
  const snap=await getDoc(doc(db,'users',u.uid));
  if (!snap.exists()) return false;
  const d=snap.data();
  gUserData = { id: u.uid, ...d };
  // Migration: old free users may not have freeUsedMB / freeResetAt
  if (d.plan==='free' && d.approved && (d.freeUsedMB===undefined || !d.freeResetAt)){
    const upd={};
    if (d.freeUsedMB===undefined){ upd.freeUsedMB=0; gUserData.freeUsedMB=0; }
    if (!d.freeResetAt){ upd.freeResetAt=serverTimestamp(); gUserData.freeResetAt={toMillis:()=>Date.now()}; }
    try{ await updateDoc(doc(db,'users',u.uid),upd); }catch(e){ console.warn('migration',e); }
  }
  return d.status!=='kicked'&&d.approved===true;
}

function _gasPost(payload){
  fetch('/api/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});
}
function sendRegEmail(u){
  _gasPost({type:'new_registration',userEmail:u.email,userName:u.displayName||u.email,plan:'free'});
}
function sendUpgradeRequestEmail(u){
  _gasPost({type:'upgrade_request',userEmail:u.email,userName:u.displayName||u.email});
}
function notifyAdminKicked(u,reason){
  _gasPost({type:'kick_alert',userEmail:u.email,userName:u.displayName||u.email,reason:reason||'?'});
}

// ── PLAN SELECTION (sau Google auth, user chưa có Firestore doc) ─────────
function showPlanSelect(){
  sec('land'); // hiện landing page phía sau modal thay vì spinner
  document.getElementById('planSelectModal')?.classList.add('active');
}
window.closePlanSelect = async () => {
  document.getElementById('planSelectModal')?.classList.remove('active');
  await signOut(auth);
};

// Tạo user gói Free và vào dashboard
window.createFreeUser = async () => {
  if (!gUser) return;
  document.getElementById('planSelectModal')?.classList.remove('active');
  sec('check');
  try {
    const userData = {
      email:gUser.email, displayName:gUser.displayName, photoURL:gUser.photoURL,
      approved:true, status:'approved', plan:'free',
      freeUsedMB:0, freeResetAt:serverTimestamp(),
      upgradeRequestedAt:null, createdAt:serverTimestamp()
    };
    await setDoc(doc(db,'users',gUser.uid), userData);
    gUserData = { id:gUser.uid, ...userData };
    sendRegEmail(gUser);
    setNavUser(gUser);
    sec('app'); checkResume(); updateFreeBanner();
    if (_kickPollTimer) clearInterval(_kickPollTimer);
    _kickPollTimer = setInterval(pollKickStatus, 30000);
  } catch(e){ toast('Lỗi tạo tài khoản: '+e.message,'err'); sec('land'); await signOut(auth); }
};

// Mở paymentModal từ planSelectModal (user mới, chưa có doc)
window.openPlanSelectPaid = () => {
  _paymentContext = 'new';
  document.getElementById('planSelectModal')?.classList.remove('active');
  const upgradeBtn = document.getElementById('paymentUpgradeBtn');
  const loginBtn   = document.getElementById('paymentLoginBtn');
  if (upgradeBtn) upgradeBtn.style.display = 'flex';
  if (loginBtn)   loginBtn.style.display   = 'none';
  document.getElementById('paymentModal')?.classList.add('active');
};

// Tạo user pending (paid intent, chưa thanh toán được xác nhận)
async function createPaidPendingUser(){
  if (!gUser) return;
  try {
    const userData = {
      email:gUser.email, displayName:gUser.displayName, photoURL:gUser.photoURL,
      approved:false, status:'pending', plan:'free',
      freeUsedMB:0, freeResetAt:serverTimestamp(),
      upgradeRequestedAt:serverTimestamp(), createdAt:serverTimestamp()
    };
    await setDoc(doc(db,'users',gUser.uid), userData);
    gUserData = { id:gUser.uid, ...userData };
    sendUpgradeRequestEmail(gUser);
    setNavUser(gUser);
    sec('pend');
  } catch(e){ toast('Lỗi: '+e.message,'err'); }
}

// Hiện modal xác nhận trước khi submit thanh toán
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
    btn.innerHTML = '✓';
    btn.style.color = '#099268';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 1500);
  }).catch(() => toast('Không copy được','err'));
};

// Xác nhận thanh toán — phân nhánh theo context
window.confirmPayment = async () => {
  document.getElementById('paymentConfirmModal')?.classList.remove('active');
  document.getElementById('paymentModal')?.classList.remove('active');
  if (_paymentContext === 'new') {
    await createPaidPendingUser();
  } else {
    await _doUpgradeRequestInternal();
  }
};

// ── READD WELCOME ─────────────────────────────────────────────
function checkReaddWelcome(){
  if (!gUser || !gUserData || !gUserData.readdedAt) return;
  const flagKey = 'swiftcopy_readd_'+gUser.uid;
  if (localStorage.getItem(flagKey)) return;
  localStorage.setItem(flagKey, '1');
  document.getElementById('readdWelcomeModal')?.classList.add('active');
}
window.closeReaddWelcome = () => {
  document.getElementById('readdWelcomeModal')?.classList.remove('active');
};

// ── DRIVE API ────────────────────────────────────────────────
const BASE='https://www.googleapis.com/drive/v3';
const FMIME='application/vnd.google-apps.folder';
const SMIME='application/vnd.google-apps.shortcut';
const CONCUR=8;
const FOLDER_CONCUR=3; // sibling folders processed in parallel during copy
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hdr=()=>({Authorization:'Bearer '+gToken,'Content-Type':'application/json'});

async function dget(path,p={}){
  if (!gToken) throw new Error('NO_TOKEN');
  const url=new URL(BASE+path);
  Object.entries(p).forEach(([k,v])=>url.searchParams.set(k,v));
  const r=await fetch(url,{headers:hdr()});
  if (r.status===401){ const t=await r.text(); throw new Error('AUTH_EXPIRED: '+t.slice(0,80)); }
  if (!r.ok){const t=await r.text();throw new Error('Drive '+r.status+': '+t.slice(0,80));}
  return r.json();
}
async function dpost(path,body){
  if (!gToken) throw new Error('NO_TOKEN');
  const r=await fetch(BASE+path,{method:'POST',headers:hdr(),body:JSON.stringify(body)});
  if (r.status===401){ const t=await r.text(); throw new Error('AUTH_EXPIRED: '+t.slice(0,80)); }
  if (!r.ok){const t=await r.text();throw new Error('Drive '+r.status+': '+t.slice(0,80));}
  return r.json();
}
function isAuthExpiredErr(e){ return e && typeof e.message==='string' && e.message.startsWith('AUTH_EXPIRED'); }
async function ddel(id){ try{await fetch(BASE+'/files/'+id+'?supportsAllDrives=true',{method:'DELETE',headers:hdr()});}catch{} }

function fid(s){
  s=s.trim();
  let m=s.match(/\/folders\/([a-zA-Z0-9_-]+)/); if(m) return m[1];
  m=s.match(/id=([a-zA-Z0-9_-]+)/); if(m) return m[1];
  if(/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
  throw new Error('Không nhận diện được Folder ID: '+s);
}
async function fname(id){ try{return (await dget('/files/'+id,{fields:'name',supportsAllDrives:true})).name;}catch(e){ if(isAuthExpiredErr(e)) throw e; return null; } }
async function listItems(folderId){
  let res=[],pt=null;
  do {
    const p={q:"'"+folderId+"' in parents and trashed=false",pageSize:1000,fields:'nextPageToken,files(id,name,mimeType,size)',supportsAllDrives:true,includeItemsFromAllDrives:true};
    if(pt) p.pageToken=pt;
    const r=await dget('/files',p); res.push(...(r.files||[])); pt=r.nextPageToken;
  } while(pt);
  return res;
}
async function existNames(folderId){ return new Set((await listItems(folderId)).map(i=>i.name)); }
async function copyFileSingle(fileId,destId){
  for(let i=0;i<4;i++){
    await pausePoint(); if(stopFlag) return {ok:false,reason:'Đã dừng',sizeMB:0};
    try{
      const resp=await dpost('/files/'+fileId+'/copy?fields=id,size&supportsAllDrives=true',{parents:[destId]});
      return {ok:true,sizeMB:parseFloat(resp.size||0)/(1024*1024)};
    }
    catch(e){
      if(isAuthExpiredErr(e)) throw e;
      const c=parseInt(e.message.match(/\d+/)?.[0]||'0');
      if([429,500,503].includes(c)){await sleep(Math.pow(2,i)*800);continue;}
      if(c===403) return {ok:false,reason:'Không có quyền copy',sizeMB:0};
      if(c===404) return {ok:false,reason:'File không tìm thấy',sizeMB:0};
      return {ok:false,reason:e.message.slice(0,60),sizeMB:0};
    }
  }
  return {ok:false,reason:'Hết số lần thử',sizeMB:0};
}
async function mkFolder(name,parentId){
  const r=await dget('/files',{q:"'"+parentId+"' in parents and name='"+name.replace(/'/g,"\\'")+"' and mimeType='"+FMIME+"' and trashed=false",fields:'files(id)',supportsAllDrives:true,includeItemsFromAllDrives:true});
  if(r.files?.length) return r.files[0].id;
  return (await dpost('/files',{name,mimeType:FMIME,parents:[parentId]})).id;
}

// ── FOLDER NAME PREVIEW ──────────────────────────────────────
let _previewTimers = { src:null, dest:null };
window.onInputChange = async (which) => {
  const inputId   = which==='src' ? 'srcInput'   : 'destInput';
  const previewId = which==='src' ? 'srcPreview' : 'destPreview';
  const val = document.getElementById(inputId).value.trim();
  const el  = document.getElementById(previewId);

  clearTimeout(_previewTimers[which]);
  if (!val){ el.style.display='none'; return; }

  // Show loading
  el.style.display='flex'; el.className='folder-preview loading';
  el.innerHTML='<div class="spin" style="width:12px;height:12px;border-width:2px"></div> Đang lấy tên...';

  _previewTimers[which] = setTimeout(async () => {
    if (!gToken){ el.className='folder-preview error'; el.innerHTML='<svg class="ic" style="color:var(--red)"><use href="#ic-warn"/></svg> Cần cấp quyền Drive trước'; return; }
    try {
      const id   = fid(val);
      const name = await fname(id);
      if (!name){ el.className='folder-preview error'; el.innerHTML='<svg class="ic" style="color:var(--red)"><use href="#ic-warn"/></svg> Không tìm thấy thư mục'; return; }
      el.className='folder-preview';
      el.innerHTML='<svg class="ic16" style="color:var(--green)"><use href="#ic-folder"/></svg> <span style="color:var(--green)">'+escH(name)+'</span>';
      // Load checklist only for src
      if (which==='src' && !clLoaded) loadChecklist(id);
    } catch(e){
      if(isAuthExpiredErr(e)){
        el.className='folder-preview error';
        el.innerHTML='<svg class="ic" style="color:var(--red)"><use href="#ic-warn"/></svg> Phiên cấp quyền đã hết hạn';
        handleAuthExpired();
        return;
      }
      el.className='folder-preview error';
      el.innerHTML='<svg class="ic" style="color:var(--red)"><use href="#ic-warn"/></svg> Link không hợp lệ';
    }
  }, 600);
};

// ── CHECKLIST ────────────────────────────────────────────────
async function loadChecklist(srcId) {
  const wrap = document.getElementById('checklistWrap');
  const body = document.getElementById('checklistBody');
  wrap.style.display = 'block';
  body.innerHTML = '<div class="cl-loading"><div class="spin"></div>Đang tải danh sách...</div>';
  clItems = []; clLoaded = false;

  try {
    const top = await listItems(srcId);
    clItems = top.map(item => ({
      id: item.id, name: item.name,
      mimeType: item.mimeType,
      size: item.size || 0,
      depth: 0,
      expanded: false,
      checked: true,
      indeterminate: false,
      children: null, // null = not loaded yet
      parentId: null
    }));
    clLoaded = true;
    renderChecklist();
    updateClInfo();
  } catch(e) {
    if(isAuthExpiredErr(e)){ body.innerHTML = '<div class="cl-empty">Phiên cấp quyền đã hết hạn</div>'; handleAuthExpired(); return; }
    body.innerHTML = '<div class="cl-empty">Lỗi tải danh sách: '+escH(e.message)+'</div>';
  }
}

function renderChecklist() {
  const body = document.getElementById('checklistBody');
  if (!clItems.length){ body.innerHTML='<div class="cl-empty">Không có mục nào.</div>'; return; }
  // Only show visible items (depth=0 + expanded children)
  const visible = getVisibleItems();
  body.innerHTML = visible.map(item => buildClRow(item)).join('');
}

function getVisibleItems() {
  const visible = [];
  function walk(items) {
    for (const item of items) {
      visible.push(item);
      if (item.mimeType===FMIME && item.expanded && item.children) {
        walk(item.children);
      }
    }
  }
  // Walk top-level
  walk(clItems.filter(i => i.depth===0));
  return visible;
}

function buildClRow(item) {
  const isFolder = item.mimeType === FMIME;
  const indent   = item.depth * 20;
  const chkCls   = item.checked ? 'checked' : (item.indeterminate ? 'indeterminate' : '');
  const expandIco = isFolder
    ? (item.children === null
        ? '<svg class="ic" style="color:var(--text3)"><use href="#ic-chev-r"/></svg>'
        : (item.expanded
            ? '<svg class="ic" style="color:var(--text3)"><use href="#ic-chev-d"/></svg>'
            : '<svg class="ic" style="color:var(--text3)"><use href="#ic-chev-r"/></svg>'))
    : '';
  const expandCls = isFolder ? '' : 'no-children';
  const folderIco = isFolder ? '📁' : '📄';
  const rowCls    = 'cl-row '+(isFolder?'is-folder ':'')+chkCls;

  return `<div class="${rowCls}" data-id="${escH(item.id)}" style="padding-left:${8+indent}px"
    onclick="clRowClick(event,'${escH(item.id)}')"
    data-drag-id="${escH(item.id)}">
    <span class="cl-expand ${expandCls}" onclick="clToggleExpand(event,'${escH(item.id)}')">${expandIco}</span>
    <span class="cl-cb"><span class="cl-cb-tick">✓</span><span class="cl-cb-dash">-</span></span>
    <span class="cl-icon">${folderIco}</span>
    <span class="cl-name">${escH(item.name)}</span>
    ${isFolder?'<span class="cl-meta">thư mục</span>':''}
  </div>`;
}

window.clRowClick = (e, id) => {
  // Don't fire if clicking expand arrow
  if (e.target.closest('.cl-expand')) return;
  const item = findClItem(id);
  if (!item) return;
  const newVal = !item.checked;
  setItemCheck(item, newVal);
  updateClInfo();
  renderChecklist();
};

window.clToggleExpand = async (e, id) => {
  e.stopPropagation();
  const item = findClItem(id);
  if (!item || item.mimeType !== FMIME) return;
  if (item.children === null) {
    // Load children
    const row = document.querySelector(`[data-id="${id}"]`);
    if (row) { const exp = row.querySelector('.cl-expand'); if(exp) exp.innerHTML='<div class="spin" style="width:12px;height:12px;border-width:2px"></div>'; }
    try {
      const children = await listItems(item.id);
      item.children = children.map(c => ({
        id:c.id, name:c.name, mimeType:c.mimeType,
        size: c.size || 0,
        depth: item.depth+1, expanded:false,
        checked: item.checked, indeterminate:false,
        children: c.mimeType===FMIME ? null : [],
        parentId: item.id
      }));
      item.expanded = true;
    } catch(e) { if(isAuthExpiredErr(e)){ handleAuthExpired(); return; } toast('Lỗi tải thư mục: '+e.message,'err'); }
  } else {
    item.expanded = !item.expanded;
  }
  renderChecklist();
};

function setItemCheck(item, val) {
  item.checked = val;
  item.indeterminate = false;
  // Propagate to children
  if (item.children) {
    item.children.forEach(c => setItemCheck(c, val));
  }
  // Update parent indeterminate state
  updateParentState(item.parentId);
}

function updateParentState(parentId) {
  if (!parentId) return;
  const parent = findClItem(parentId);
  if (!parent || !parent.children) return;
  const allChecked   = parent.children.every(c => c.checked && !c.indeterminate);
  const noneChecked  = parent.children.every(c => !c.checked && !c.indeterminate);
  if (allChecked)        { parent.checked=true;  parent.indeterminate=false; }
  else if (noneChecked)  { parent.checked=false; parent.indeterminate=false; }
  else                   { parent.checked=false; parent.indeterminate=true; }
  updateParentState(parent.parentId);
}

function findClItem(id) {
  function search(items) {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.children) { const f=search(item.children); if(f) return f; }
    }
    return null;
  }
  return search(clItems);
}

function calcSelectedBytes(){
  let total=0;
  function walk(items){ for(const item of items){ if(item.mimeType!==FMIME&&(item.checked||item.indeterminate)) total+=parseFloat(item.size||0); if(item.children) walk(item.children); } }
  walk(clItems); return total;
}

function updateClInfo() {
  const total    = clItems.length;
  const selected = clItems.filter(i => i.checked || i.indeterminate).length;
  document.getElementById('clTotal').textContent    = total;
  document.getElementById('clSelected').textContent = selected;

  const sizeEl = document.getElementById('clSizeInfo');
  if (!sizeEl) return;
  if (!clLoaded || !total){ sizeEl.style.display='none'; return; }
  sizeEl.style.display = 'block';
  const mb = calcSelectedBytes() / (1024*1024);
  const sizeStr = mb>=1024 ? (mb/1024).toFixed(2)+' GB' : mb.toFixed(0)+' MB';
  if (gUserData?.plan==='free'){
    const remainMB = Math.max(0, FREE_MB_LIMIT-(gUserData.freeUsedMB||0));
    if (mb > remainMB){
      const over = Math.ceil(mb-remainMB);
      sizeEl.innerHTML = `Đã chọn: <b>${sizeStr}</b> &nbsp;<span style="color:#e67700;font-weight:700;">⚠ Vượt ${over}MB còn lại — <a href="#" onclick="openUpgradeModal();return false;" style="color:#d97706;text-decoration:underline">Nâng cấp gói</a></span>`;
    } else {
      sizeEl.innerHTML = `Đã chọn: <b>${sizeStr}</b> <span style="color:#adb5bd;">(còn ${Math.round(remainMB)}MB / 500MB)</span>`;
    }
  } else {
    sizeEl.innerHTML = `Đã chọn: <b>${sizeStr}</b>`;
  }
}

window.clSelectAll   = () => { clItems.forEach(i=>setItemCheck(i,true));  updateClInfo(); renderChecklist(); };
window.clDeselectAll = () => { clItems.forEach(i=>setItemCheck(i,false)); updateClInfo(); renderChecklist(); };

// Drag-select
window.dragStart = (e) => {
  const row = e.target.closest('.cl-row');
  if (!row || e.target.closest('.cl-expand')) return;
  _dragActive = true;
  const item = findClItem(row.dataset.id);
  if (item) { _dragCheckValue = !item.checked; setItemCheck(item,_dragCheckValue); updateClInfo(); renderChecklist(); }
};
window.dragOver = (e) => {
  if (!_dragActive) return;
  const row = e.target.closest('.cl-row');
  if (!row || e.target.closest('.cl-expand')) return;
  const item = findClItem(row.dataset.id);
  if (item && item.checked !== _dragCheckValue) { setItemCheck(item,_dragCheckValue); updateClInfo(); renderChecklist(); }
};
window.dragEnd = () => { _dragActive=false; };
document.addEventListener('mouseup', () => { _dragActive=false; });

function getSelectedItems() {
  // Return only checked top-level items (and their checked sub-items)
  return clItems.filter(i => i.checked || i.indeterminate);
}

// ── GLOBAL PROGRESS COUNTERS (dynamic, no pre-scan) ───────────
let progDone = 0;
function progStart(){ progDone=0; setProgress(0,1, runMode==='scan'?'scanning':'running'); }
function progInc(n){ progDone+=(n||1); setStatusCount(); }
function progFinish(){ setProgress(1,1, stopFlag?'paused':'done'); }
function setStatusCount(){ /* hook used by callers to refresh the "(N mục)" label */ }

// ── SCAN ─────────────────────────────────────────────────────
async function startScan() {
  if (!gToken){ showNoAuth('Chưa cấp quyền Drive!','Bạn cần cấp quyền truy cập Google Drive trước khi kiểm tra.'); return; }
  const sv=document.getElementById('srcInput').value.trim();
  const dv=document.getElementById('destInput').value.trim();
  if (!sv||!dv){ toast('Nhập đủ Drive nguồn và đích!','warn'); return; }

  stopFlag=false; pauseFlag=false; runMode='scan'; _authExpiredHandled=false;
  stats=ns(); updStats();
  document.getElementById('scanResult').style.display='none';
  document.getElementById('logBox').innerHTML='';
  setBtnMode('scan');
  progStart();
  setStatus('Đang chuẩn bị kiểm tra...');

  const t0=Date.now();
  try {
    const srcId=fid(sv), destId=fid(dv);
    const sn=await fname(srcId);
    addLog('Bắt đầu kiểm tra quyền...','info');

    // Get items to scan (respect checklist selection)
    let topItems = await listItems(srcId);
    if (clLoaded && clItems.length > 0) {
      const selIds = new Set(clItems.filter(i=>i.checked||i.indeterminate).map(i=>i.id));
      topItems = topItems.filter(i=>selIds.has(i.id));
    }

    if (stopFlag){ setStatus('Đã dừng kiểm tra'); setBtnMode('idle'); return; }

    setStatus('Đang kiểm tra "'+sn+'"... (0 mục)');

    const tree = await scanNodes(topItems, destId, '', 0, sn);
    if (stopFlag){ if(!_authExpiredHandled) setStatus('Đã dừng kiểm tra'); setBtnMode('idle'); return; }

    const elapsed=Math.round((Date.now()-t0)/1000);
    const totalErr=cntErr(tree);
    progFinish();
    setStatus(totalErr===0?'Kiểm tra xong - Không có lỗi ('+elapsed+'s)':'Phát hiện '+totalErr+' vấn đề ('+elapsed+'s)');
    renderScanResult(tree,totalErr);
  } catch(e){
    if(isAuthExpiredErr(e)){ handleAuthExpired(); return; }
    addLog('Lỗi: '+e.message,'err'); setStatus('Lỗi kiểm tra');
    if(e.message==='NO_TOKEN') showNoAuth('Chưa cấp quyền Drive!','Nhấn nút bên dưới để cấp quyền.');
  } finally {
    runMode='idle'; setBtnMode('idle');
  }
}

const SCAN_FILE_CONCUR   = 8;
const SCAN_FOLDER_CONCUR = 4;

async function testFileCopy(item, destId){
  try{
    const r=await dpost('/files/'+item.id+'/copy',{name:'__swtest_'+item.name,parents:[destId]});
    await ddel(r.id);
    return null;
  } catch(e){
    if(isAuthExpiredErr(e)) throw e;
    const c=parseInt(e.message.match(/\d+/)?.[0]||'0');
    return c===403?'Không có quyền copy':'Lỗi API '+c;
  }
}

async function scanNodes(items, destId, path, depth, srcName) {
  const folderItems = items.filter(c=>c.mimeType===FMIME);
  const fileItems   = items.filter(c=>c.mimeType!==FMIME);

  const fileNodes = await scanFileNodes(fileItems, destId, path, depth, srcName);
  if(stopFlag) return [...fileNodes];

  const folderNodes = new Array(folderItems.length);
  let idx=0;
  async function worker(){
    while(true){
      const i=idx++; if(i>=folderItems.length) return;
      await pausePoint(); if(stopFlag) return;
      const item=folderItems[i];
      const fp=path?path+' > '+item.name:item.name;
      let children;
      try{ children=await listItems(item.id); }
      catch(e){ if(isAuthExpiredErr(e)) throw e; children=[]; }
      progInc(); setStatus('Đang kiểm tra "'+srcName+'"... ('+progDone+' mục) '+item.name);
      addLog('Thư mục: '+item.name,'info');

      const testFile=children.find(c=>c.mimeType!==FMIME&&c.mimeType!==SMIME);
      let selfErr=null;
      if (testFile){
        selfErr=await testFileCopy(testFile,destId);
        if(selfErr) addLog('Lỗi: '+item.name+' - '+selfErr,'err');
      }
      const subNodes = selfErr?[]:await scanNodes(children,destId,fp,depth+1,srcName);
      folderNodes[i]={name:item.name,path:fp,type:'folder',depth,error:selfErr,children:subNodes};
    }
  }
  const workers=[];
  for(let w=0;w<Math.min(SCAN_FOLDER_CONCUR,Math.max(folderItems.length,1));w++) workers.push(worker());
  try{ await Promise.all(workers); }
  catch(e){ if(isAuthExpiredErr(e)) throw e; }
  if(stopFlag) return [...fileNodes,...folderNodes.filter(Boolean)];

  return [...fileNodes,...folderNodes];
}

async function scanFileNodes(items,destId,path,depth,srcName){
  const nodes=new Array(items.length);
  for(let i=0;i<items.length;i+=SCAN_FILE_CONCUR){
    await pausePoint(); if(stopFlag) break;
    const batch=items.slice(i,i+SCAN_FILE_CONCUR);
    await Promise.all(batch.map(async (item,bi)=>{
      const realIdx=i+bi;
      await pausePoint(); if(stopFlag) return;
      const fp=path?path+' > '+item.name:item.name;
      if (item.mimeType===SMIME){
        progInc(); setStatus('Đang kiểm tra "'+srcName+'"... ('+progDone+' mục) '+item.name);
        nodes[realIdx]={name:item.name,path:fp,type:'file',depth,error:'Là shortcut - bỏ qua',children:[]};
        return;
      }
      addLog('Kiểm tra: '+item.name,'skip');
      let err;
      try{ err=await testFileCopy(item,destId); }
      catch(e){ if(isAuthExpiredErr(e)) throw e; err='Lỗi'; }
      if(err) addLog('Lỗi: '+item.name,'err'); else addLog('OK: '+item.name,'ok');
      progInc(); setStatus('Đang kiểm tra "'+srcName+'"... ('+progDone+' mục) '+item.name);
      nodes[realIdx]={name:item.name,path:fp,type:'file',depth,error:err,children:[]};
    }));
    if(stopFlag) break;
  }
  return nodes.filter(Boolean);
}

function cntErr(nodes){ let c=0; for(const n of nodes){if(n.error)c++;if(n.children?.length)c+=cntErr(n.children);} return c; }
function hasErr(node){ if(node.error)return true; return (node.children||[]).some(hasErr); }

function splitScanTree(nodes){
  const okNodes=[], errNodes=[];
  for(const n of nodes){
    if(n.type==='folder'){
      const childSplit=splitScanTree(n.children||[]);
      const folderHasErr = !!n.error || childSplit.errNodes.length>0;
      if(!folderHasErr){
        okNodes.push({...n, children: childSplit.okNodes});
      } else {
        errNodes.push({...n, children: childSplit.errNodes});
        if(childSplit.okNodes.length){
          okNodes.push({...n, error:null, children: childSplit.okNodes, _partial:true});
        }
      }
    } else {
      if(n.error) errNodes.push(n);
      else okNodes.push(n);
    }
  }
  return {okNodes, errNodes};
}

function renderScanResult(tree,totalErr){
  const el=document.getElementById('scanResult'); el.style.display='block';
  if (totalErr===0){
    el.innerHTML='<div class="tree-wrap"><div class="tree-head ok-head" style="justify-content:flex-start;gap:8px"><svg class="ic16" style="color:var(--green)"><use href="#ic-check-c"/></svg><span style="font-size:13px;font-weight:700;color:var(--green)">Tất cả đều có thể sao chép!</span></div></div>';
    return;
  }

  const {okNodes, errNodes} = splitScanTree(tree);
  const okCount  = countTreeNodes(okNodes);

  const errAllPaths=new Set();
  function epErr(nodes){nodes.forEach(n=>{if(n.type==='folder'){errAllPaths.add(n.path);epErr(n.children||[]);}}); }
  epErr(errNodes);

  let html = '<div class="tree-wrap"><div class="tree-head err-head"><span style="font-size:13px;font-weight:700;color:var(--red);display:flex;align-items:center;gap:7px"><svg class="ic16" style="color:var(--red)"><use href="#ic-warn"/></svg>'+totalErr+' mục bị lỗi quyền</span><span style="font-size:11px;font-weight:700;background:var(--red);color:#fff;padding:2px 8px;border-radius:999px">'+totalErr+'</span></div><div class="tree-body" id="scanErrTreeBody"></div><div class="tree-note"><svg class="ic" style="color:var(--text3);margin-right:4px"><use href="#ic-info"/></svg>Vào Drive nguồn → chuột phải → <b>Chia sẻ</b> → thêm email bạn quyền <b>Người chỉnh sửa</b></div></div>';

  if (okCount>0){
    const okAllPaths=new Set();
    function epOk(nodes){nodes.forEach(n=>{if(n.type==='folder'){okAllPaths.add(n.path);epOk(n.children||[]);}}); }
    epOk(okNodes);
    html += '<div class="tree-wrap"><div class="tree-head ok-head"><span style="font-size:13px;font-weight:700;color:var(--green);display:flex;align-items:center;gap:7px"><svg class="ic16" style="color:var(--green)"><use href="#ic-check-c"/></svg>Có quyền copy</span><span style="font-size:11px;font-weight:700;background:var(--green);color:#fff;padding:2px 8px;border-radius:999px">'+okCount+'</span></div><div class="tree-body" id="scanOkTreeBody"></div></div>';

    el.innerHTML = html;

    window._scanOkToggle=function(path){okAllPaths.has(path)?null:null; togglePathSet(_okOpenSet,path); document.getElementById('scanOkTreeBody').innerHTML=buildTreeHTML(okNodes,_okOpenSet,'_scanOkToggle');};
    var _okOpenSet=new Set(okAllPaths);
    document.getElementById('scanOkTreeBody').innerHTML=buildTreeHTML(okNodes,_okOpenSet,'_scanOkToggle');
  } else {
    el.innerHTML = html;
  }

  window._scanErrToggle=function(path){togglePathSet(_errOpenSet,path); document.getElementById('scanErrTreeBody').innerHTML=buildTreeHTML(errNodes,_errOpenSet,'_scanErrToggle');};
  var _errOpenSet=new Set(errAllPaths);
  document.getElementById('scanErrTreeBody').innerHTML=buildTreeHTML(errNodes,_errOpenSet,'_scanErrToggle');
}

function togglePathSet(set,path){ set.has(path)?set.delete(path):set.add(path); }

function countTreeNodes(nodes){
  let c=0;
  for(const n of nodes){ c++; if(n.children?.length) c+=countTreeNodes(n.children); }
  return c;
}

// ── VIDEO DETECTION ──────────────────────────────────────────
function isVideoItem(item){
  if (item.mimeType && VIDEO_MIME.test(item.mimeType)) return true;
  if (item.name && VIDEO_EXT.test(item.name)) return true;
  return false;
}
async function countVideoFiles(items, clFilterChildren){
  let count=0;
  let workItems=items;
  if (clFilterChildren){
    const allowedIds=new Set(clFilterChildren.filter(c=>c.checked||c.indeterminate).map(c=>c.id));
    workItems=items.filter(i=>allowedIds.has(i.id));
  }
  for(const item of workItems){
    await pausePoint(); if(stopFlag) return count;
    if(item.mimeType===FMIME){
      let children=[];
      try{ children=await listItems(item.id); }catch{ children=[]; }
      let subFilter=null;
      if(clFilterChildren){
        const clItem=clFilterChildren.find(c=>c.id===item.id);
        if(clItem && clItem.indeterminate && clItem.children) subFilter=clItem.children;
      }
      count+=await countVideoFiles(children,subFilter);
    } else if(item.mimeType!==SMIME){
      if(isVideoItem(item)) count++;
    }
  }
  return count;
}
const VIDWARN_KEY='swiftcopy_hide_video_warning';
window.closeVidWarn=()=>{ document.getElementById('vidWarnOv').classList.remove('on'); };
window.confirmVidWarn=()=>{
  if(document.getElementById('vidWarnDontShow').checked) localStorage.setItem(VIDWARN_KEY,'1');
  document.getElementById('vidWarnOv').classList.remove('on');
  _runCopyInternal(_pendingCopyResume);
};

// ── COPY ─────────────────────────────────────────────────────
let _videoWarnShown = false;
let _videoWarnResolve = null;
let _videoSeenCount = 0;

window.startCopy = async (isResume) => {
  if (!gToken){ showNoAuth('Chưa cấp quyền Drive!','Bạn cần cấp quyền truy cập Google Drive trước khi sao chép.'); return; }
  const sv=document.getElementById('srcInput').value.trim();
  const dv=document.getElementById('destInput').value.trim();
  if (!sv||!dv){ toast('Nhập đủ Drive nguồn và đích!','warn'); return; }
  // Kiểm tra giới hạn free trước khi copy (bỏ qua khi resume vì đã kiểm tra trước đó)
  if (!isResume && !(await checkFreeLimit())) return;
  await _runCopyInternal(isResume);
};

function videoGate(item){
  _videoSeenCount++;
  if (localStorage.getItem(VIDWARN_KEY)==='1') return Promise.resolve();
  if (_videoWarnShown) return Promise.resolve();
  _videoWarnShown = true;
  return new Promise(resolve=>{
    _videoWarnResolve = resolve;
    document.getElementById('vidWarnCount').textContent = '';
    document.getElementById('vidWarnTitleNote').style.display='block';
    document.getElementById('vidWarnOv').classList.add('on');
  });
}

async function _runCopyInternal(isResume) {
  const sv=document.getElementById('srcInput').value.trim();
  const dv=document.getElementById('destInput').value.trim();
  if (!sv||!dv){ toast('Nhập đủ Drive nguồn và đích!','warn'); return; }

  stopFlag=false; pauseFlag=false; runMode='copy'; _authExpiredHandled=false;
  if (!isResume){ stats=ns(); _sessionCopiedMB=0; }
  document.getElementById('logBox').innerHTML='';
  document.getElementById('scanResult').style.display='none';
  document.getElementById('statsRow').style.display='grid';
  updStats(); setBtnMode('copy');
  progStart();

  const t0=Date.now();
  let videoCountForCompletion=0;
  try {
    const srcId=fid(sv), destId=fid(dv);
    const sn=await fname(srcId), dn=await fname(destId);
    setStatus('Đang chuẩn bị "'+sn+'" -> "'+dn+'"');
    addLog('Nguồn: '+sn,'info'); addLog('Đích: '+dn,'info');
    saveSessionData({sv,dv,srcId,sn,destId,dn});

    let top=await listItems(srcId);
    // Filter by checklist selection
    let clFilter=null;
    if (clLoaded&&clItems.length>0){
      const selIds=new Set(clItems.filter(i=>i.checked||i.indeterminate).map(i=>i.id));
      top=top.filter(i=>selIds.has(i.id));
      clFilter=clItems;
    }
    if (!top.length){toast('Không có mục nào được chọn!','warn');setBtnMode('idle');runMode='idle';return;}

    if (stopFlag){ setStatus('Đã dừng sao chép'); setBtnMode('idle'); runMode='idle'; return; }

    // Cảnh báo video cho user free (chỉ tìm top-level để nhanh)
    if (gUserData?.plan==='free') {
      const hasTopVideo = top.some(i => isVideoItem(i));
      if (hasTopVideo) {
        addLog('⚠ Phát hiện video — gói miễn phí sẽ bỏ qua file video','warn');
        toast('Gói miễn phí bỏ qua video. Nâng cấp để copy toàn bộ','warn');
      }
    }

    // Track video count for completion summary (chỉ cho paid users)
    if (gUserData?.plan !== 'free') {
      try { videoCountForCompletion = await countVideoFiles(top, clFilter); } catch(e){ if(isAuthExpiredErr(e)) throw e; videoCountForCompletion=0; }
      if (stopFlag){ setStatus('Đã dừng sao chép'); setBtnMode('idle'); runMode='idle'; return; }
    }

    addLog((isResume?'Tiếp tục sao chép':'Bắt đầu sao chép')+' ('+CONCUR+' luồng song song)...','info');

    const dex=await existNames(destId);

    const topFolders=top.filter(i=>i.mimeType===FMIME);
    const topFiles  =top.filter(i=>i.mimeType!==FMIME&&i.mimeType!==SMIME);

    // Files: batches of CONCUR
    for(let i=0;i<topFiles.length;i+=CONCUR){
      await pausePoint(); if(stopFlag) break;
      const batch=topFiles.slice(i,i+CONCUR);
      await Promise.all(batch.map(async item=>{
        if(stopFlag) return; await pausePoint();
        if (dex.has(item.name)){addLog('Đã có: '+item.name,'skip');progInc();return;}
        // Bỏ qua video cho free user
        if(gUserData?.plan==='free'&&isVideoItem(item)){
          addLog('Bỏ qua video (miễn phí): '+item.name,'skip'); progInc(); return;
        }
        const res=await copyFileSingle(item.id,destId);
        const node={name:item.name,path:item.name,type:'file',depth:0,error:res.ok?null:(res.reason||'Lỗi'),children:[],link:res.ok?null:'https://drive.google.com/file/d/'+item.id+'/view'};
        if(res.ok){stats.copied++;stats.copiedFiles.push(node);addLog('OK: '+item.name,'ok');_sessionCopiedMB+=(res.sizeMB||0);}
        else{stats.failed++;stats.failedFiles.push(node);addLog('Lỗi: '+item.name+' - '+res.reason,'err');}
        updStats(); saveSession();
        progInc(); setStatus('('+progDone+' mục) '+item.name);
      }));
    }

    // Folders: bounded parallel workers
    if(!stopFlag && topFolders.length){
      let idx=0;
      async function folderWorker(){
        while(true){
          const i=idx++; if(i>=topFolders.length) return;
          await pausePoint(); if(stopFlag) return;
          const item=topFolders[i];
          const nid=await mkFolder(item.name,destId);
          let node=stats.folderList.find(f=>f.depth===0&&f.name===item.name&&f._srcId===item.id);
          if (!node){
            stats.folders++;
            node={name:item.name,path:item.name,type:'folder',depth:0,error:null,children:[],_srcId:item.id};
            stats.folderList.push(node);
          }
          addLog('Thư mục: '+item.name,'folder'); updStats(); saveSession();
          progInc(); setStatus('('+progDone+' mục) '+item.name);
          const clItem=clItems.find(ci=>ci.id===item.id);
          if (clItem&&clItem.indeterminate&&clItem.children){
            await copyRecTreeFiltered(item.id,nid,item.name,1,node.children,clItem);
          } else {
            await copyRecTree(item.id,nid,item.name,1,node.children);
          }
        }
      }
      const workers=[];
      for(let w=0;w<Math.min(FOLDER_CONCUR,topFolders.length);w++) workers.push(folderWorker());
      await Promise.all(workers);
    }

    const elapsed=Math.round((Date.now()-t0)/1000);
    progFinish();
    if (!stopFlag){
      setStatus('Hoàn thành '+elapsed+'s');
      clearSession();
      // Lưu lịch sử chỉ cho paid user
      if (gUserData?.plan !== 'free') await saveHist(srcId,sn,destId,dn,elapsed);
      // Cộng dồn MB đã dùng cho free user
      if (gUserData?.plan === 'free') await updateFreeUsedMB();
      showComplModal(elapsed, videoCountForCompletion);
    }
    else if(!_authExpiredHandled) setStatus('Đã dừng sao chép');
  } catch(e){
    if(isAuthExpiredErr(e)){ handleAuthExpired(); return; }
    addLog('Lỗi: '+e.message,'err'); setStatus('Lỗi sao chép');
    if(e.message==='NO_TOKEN') showNoAuth('Chưa cấp quyền Drive!','Nhấn nút bên dưới để cấp quyền.');
  } finally {
    runMode='idle'; setBtnMode('idle');
  }
}

async function copyRecTree(srcId,destId,path,depth,parentChildren){
  await pausePoint(); if(stopFlag) return;
  const items=await listItems(srcId);
  const dnames=await existNames(destId);
  const folders=items.filter(i=>i.mimeType===FMIME);
  const files=items.filter(i=>i.mimeType!==FMIME&&i.mimeType!==SMIME&&!dnames.has(i.name));
  const skippedFiles=items.filter(i=>i.mimeType!==FMIME&&i.mimeType!==SMIME&&dnames.has(i.name));
  skippedFiles.forEach(i=>{addLog('Đã có: '+i.name,'skip'); progInc();});
  for(let i=0;i<files.length;i+=CONCUR){
    await pausePoint(); if(stopFlag) break;
    await Promise.all(files.slice(i,i+CONCUR).map(async item=>{
      if(stopFlag)return; await pausePoint();
      const fp=path?path+' > '+item.name:item.name;
      // Bỏ qua video cho free user
      if(gUserData?.plan==='free'&&isVideoItem(item)){
        addLog('Bỏ qua video (miễn phí): '+item.name,'skip'); progInc(); return;
      }
      const res=await copyFileSingle(item.id,destId);
      const node={name:item.name,path:fp,type:'file',depth,error:res.ok?null:(res.reason||'Lỗi'),children:[],link:res.ok?null:'https://drive.google.com/file/d/'+item.id+'/view'};
      if(res.ok){stats.copied++;stats.copiedFiles.push(node);addLog('OK: '+item.name,'ok');_sessionCopiedMB+=(res.sizeMB||0);}
      else{stats.failed++;stats.failedFiles.push(node);addLog('Lỗi: '+item.name+' - '+res.reason,'err');}
      parentChildren.push(node); updStats(); saveSession();
      progInc(); setStatus('('+progDone+' mục) '+item.name);
    }));
  }
  if(stopFlag||!folders.length) return;
  let idx=0;
  async function worker(){
    while(true){
      const i=idx++; if(i>=folders.length) return;
      await pausePoint(); if(stopFlag) return;
      const f=folders[i];
      const fp=path?path+' > '+f.name:f.name;
      const nid=await mkFolder(f.name,destId);
      stats.folders++;
      const node={name:f.name,path:fp,type:'folder',depth,error:null,children:[]};
      stats.folderList.push(node); parentChildren.push(node);
      addLog('Thư mục: '+f.name,'folder'); updStats();
      progInc(); setStatus('('+progDone+' mục) '+f.name);
      await copyRecTree(f.id,nid,fp,depth+1,node.children);
    }
  }
  const workers=[];
  for(let w=0;w<Math.min(FOLDER_CONCUR,folders.length);w++) workers.push(worker());
  await Promise.all(workers);
}

async function copyRecTreeFiltered(srcId,destId,path,depth,parentChildren,clItem){
  await pausePoint(); if(stopFlag)return;
  const items=await listItems(srcId);
  const dnames=await existNames(destId);
  const checkedChildIds = clItem.children ? new Set(clItem.children.filter(c=>c.checked||c.indeterminate).map(c=>c.id)) : null;
  const filteredItems = checkedChildIds ? items.filter(i=>checkedChildIds.has(i.id)) : items;
  const folders=filteredItems.filter(i=>i.mimeType===FMIME);
  const files=filteredItems.filter(i=>i.mimeType!==FMIME&&i.mimeType!==SMIME&&!dnames.has(i.name));
  const skippedFiles=filteredItems.filter(i=>i.mimeType!==FMIME&&i.mimeType!==SMIME&&dnames.has(i.name));
  skippedFiles.forEach(i=>{addLog('Đã có: '+i.name,'skip'); progInc();});
  for(let i=0;i<files.length;i+=CONCUR){
    await pausePoint(); if(stopFlag)break;
    await Promise.all(files.slice(i,i+CONCUR).map(async item=>{
      if(stopFlag)return; await pausePoint();
      const fp=path?path+' > '+item.name:item.name;
      // Bỏ qua video cho free user
      if(gUserData?.plan==='free'&&isVideoItem(item)){
        addLog('Bỏ qua video (miễn phí): '+item.name,'skip'); progInc(); return;
      }
      const res=await copyFileSingle(item.id,destId);
      const node={name:item.name,path:fp,type:'file',depth,error:res.ok?null:(res.reason||'Lỗi'),children:[],link:res.ok?null:'https://drive.google.com/file/d/'+item.id+'/view'};
      if(res.ok){stats.copied++;stats.copiedFiles.push(node);addLog('OK: '+item.name,'ok');_sessionCopiedMB+=(res.sizeMB||0);}
      else{stats.failed++;stats.failedFiles.push(node);addLog('Lỗi: '+item.name+' - '+res.reason,'err');}
      parentChildren.push(node); updStats(); saveSession();
      progInc(); setStatus('('+progDone+' mục) '+item.name);
    }));
  }
  if(stopFlag||!folders.length) return;
  let idx=0;
  async function worker(){
    while(true){
      const i=idx++; if(i>=folders.length) return;
      await pausePoint(); if(stopFlag) return;
      const f=folders[i];
      const fp=path?path+' > '+f.name:f.name;
      const nid=await mkFolder(f.name,destId);
      stats.folders++;
      const node={name:f.name,path:fp,type:'folder',depth,error:null,children:[]};
      stats.folderList.push(node); parentChildren.push(node);
      addLog('Thư mục: '+f.name,'folder'); updStats();
      progInc(); setStatus('('+progDone+' mục) '+f.name);
      const subCl=clItem.children?clItem.children.find(c=>c.id===f.id):null;
      if(subCl&&subCl.indeterminate) await copyRecTreeFiltered(f.id,nid,fp,depth+1,node.children,subCl);
      else await copyRecTree(f.id,nid,fp,depth+1,node.children);
    }
  }
  const workers=[];
  for(let w=0;w<Math.min(FOLDER_CONCUR,folders.length);w++) workers.push(worker());
  await Promise.all(workers);
}

// ── TREE HTML ────────────────────────────────────────────────
function buildTreeHTML(nodes,openSet,toggleFn){
  toggleFn=toggleFn||'_scanToggle';
  let html='';
  for(const node of nodes){
    const indent=16+node.depth*20;
    const isFolder=node.type==='folder';
    const hasChildren=isFolder&&node.children?.length>0;
    const isOpen=!openSet||openSet.has(node.path);
    const nodeHasErr=!!node.error;
    const childHasErr=hasChildren&&node.children.some(hasErr);
    let statusIco='',rowCls='',nameClr='';
    if(isFolder){
      if(nodeHasErr||childHasErr){rowCls='tf has-err';nameClr='color:var(--text);font-weight:700';statusIco=isOpen?'<svg class="ic si-warn" style="opacity:.35"><use href="#ic-warn"/></svg>':'<svg class="ic si-warn"><use href="#ic-warn"/></svg>';}
      else{rowCls='tf all-ok';nameClr='color:var(--green);font-weight:700';statusIco='<svg class="ic si-ok"><use href="#ic-check-c"/></svg>';}
    } else {
      if(nodeHasErr){rowCls='tfile ferr';nameClr='color:var(--red)';statusIco='<svg class="ic si-err"><use href="#ic-x-c"/></svg>';}
      else{rowCls='tfile';nameClr='color:var(--text2)';statusIco='<svg class="ic si-ok"><use href="#ic-check-c"/></svg>';}
    }
    const chevron=isFolder?'<svg class="ic" style="color:var(--text3);flex-shrink:0"><use href="#ic-'+(isOpen?'chev-d':'chev-r')+'"/></svg>':'<span style="width:14px;flex-shrink:0;display:inline-block"></span>';
    const folderIco=isFolder?'<svg class="ic16" style="color:'+(nodeHasErr||childHasErr?'var(--text)':'var(--green)')+'"><use href="#ic-'+(isOpen?'folder-o':'folder')+'"/></svg>':'<svg class="ic" style="color:'+(nodeHasErr?'var(--red)':'var(--text3)')+'"><use href="#ic-file"/></svg>';
    const errPill=nodeHasErr?'<span class="tr-reason">'+escH(node.error)+'</span>':'';
    const warnBadge=(isFolder&&childHasErr&&!nodeHasErr)?'<span class="tr-badge" style="background:var(--orangel);color:var(--orange);border-color:var(--orangeb)">'+cntErr(node.children)+' lỗi bên trong</span>':'';
    const linkBtn=node.link?'<a href="'+node.link+'" target="_blank" style="color:var(--text3);flex-shrink:0;display:inline-flex"><svg class="ic"><use href="#ic-ext"/></svg></a>':'';
    const clickAttr=isFolder&&openSet?'onclick="window.'+toggleFn+'(\''+node.path.replace(/'/g,"\\'")+'\')"':'';
    html+='<div class="tr '+rowCls+'" style="padding:7px 16px 7px '+indent+'px" '+clickAttr+'>'+chevron+folderIco+'<span class="tr-name" style="'+nameClr+'">'+escH(node.name)+'</span>'+errPill+warnBadge+linkBtn+statusIco+'</div>';
    if(isFolder&&(isOpen||!openSet)&&hasChildren) html+=buildTreeHTML(node.children,openSet,toggleFn);
  }
  return html;
}

function escH(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ── SESSION ──────────────────────────────────────────────────
const SK='swiftcopy_session';
function saveSessionData(d){localStorage.setItem(SK,JSON.stringify({...d,stats,ts:Date.now()}));}
function saveSession(){const s=getSession();if(s){s.stats=stats;s.ts=Date.now();localStorage.setItem(SK,JSON.stringify(s));}}
function getSession(){try{return JSON.parse(localStorage.getItem(SK)||'null');}catch{return null;}}
function clearSession(){localStorage.removeItem(SK);document.getElementById('resumeBanner').style.display='none';}
function checkResume(){
  const s=getSession();if(!s)return;
  if((Date.now()-s.ts)/1000/60>120){clearSession();return;}
  const b=document.getElementById('resumeBanner');b.style.display='flex';
  document.getElementById('srcInput').value=s.sv||'';
  document.getElementById('destInput').value=s.dv||'';
  if(s.sv) window.onInputChange('src');
  if(s.dv) window.onInputChange('dest');
}
window.resumeSession=async()=>{
  const s=getSession();if(!s){clearSession();return;}
  if(s.stats){stats=s.stats;updStats();document.getElementById('statsRow').style.display='grid';}
  document.getElementById('resumeBanner').style.display='none';
  addLog('Tiếp tục phiên cũ - chỉ sao chép các mục chưa hoàn thành...','info');
  await window.startCopy(true);
};
window.clearSession=clearSession;

async function saveHist(si,sn,di,dn,el){
  try{await addDoc(collection(db,'history'),{uid:gUser.uid,email:gUser.email,srcId:si,srcName:sn,destId:di,destName:dn,copied:stats.copied,failed:stats.failed,folders:stats.folders,elapsed:el,createdAt:serverTimestamp()});}
  catch(e){console.warn('saveHist',e);}
}

// ── COMPLETION MODAL ─────────────────────────────────────────
window.closeComplModal=()=>{ document.getElementById('complOv').classList.remove('on'); };
function showComplModal(elapsed, videoCount){
  document.getElementById('complCopied').textContent  = stats.copied;
  document.getElementById('complFailed').textContent  = stats.failed;
  document.getElementById('complFolders').textContent = stats.folders;
  document.getElementById('complTime').textContent    = elapsed+'s';
  document.getElementById('complSub').textContent     = 'Hoàn thành trong '+elapsed+'s';
  const vbox=document.getElementById('complVideoBox');
  if (videoCount>0){
    document.getElementById('complVideoCount').textContent=videoCount;
    vbox.style.display='block';
  } else {
    vbox.style.display='none';
  }
  document.getElementById('complOv').classList.add('on');
}

// ── MODAL ────────────────────────────────────────────────────
const _mOpen=new Set();
window.openModal=(type)=>{
  const cfgMap={
    result:{label:'Kết quả sao chép',nodes:stats.folderList.length?stats.folderList:[...stats.copiedFiles,...stats.failedFiles]},
    failed:{label:'Lỗi',nodes:stats.failedFiles},
    folders:{label:'Thư mục',nodes:stats.folderList}
  };
  const cfg=cfgMap[type];if(!cfg)return;
  _mOpen.clear();
  function ea(nodes){nodes.forEach(n=>{if(n.type==='folder'){_mOpen.add(n.path);ea(n.children||[]);}}); }
  ea(cfg.nodes);
  document.getElementById('modalTitle').innerHTML='<span>'+cfg.label+'</span><span style="font-size:12px;background:var(--surface2);color:var(--text3);padding:2px 8px;border-radius:999px;font-family:monospace;margin-left:6px">'+cfg.nodes.length+'</span>';
  function rerender(){document.getElementById('modalBody').innerHTML=cfg.nodes.length===0?'<p style="color:var(--text3);text-align:center;padding:28px;font-size:13px">Không có mục nào.</p>':buildTreeHTML(cfg.nodes,_mOpen,'_treeToggle');}
  window._treeToggle=path=>{_mOpen.has(path)?_mOpen.delete(path):_mOpen.add(path);rerender();};
  rerender();
  document.getElementById('modalOv').classList.add('on');
};
window.closeModal=()=>document.getElementById('modalOv').classList.remove('on');

// ── FREE PLAN HELPERS ─────────────────────────────────────────
function updateFreeBanner() {
  const banner       = document.getElementById('freeBanner');
  const premiumBadge = document.getElementById('premiumBadge');
  if (!banner) return;

  // Plan 'paid' → hiện premium badge
  if (gUserData?.plan === 'paid') {
    banner.style.display = 'none';
    if (premiumBadge) premiumBadge.style.display = 'flex';
    return;
  }
  if (premiumBadge) premiumBadge.style.display = 'none';

  if (!gUserData || gUserData.plan !== 'free') {
    banner.style.display = 'none';
    return;
  }

  // Free user đang chờ nâng cấp được xác nhận
  if (gUserData.upgradeRequestedAt) {
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#7a5a00;font-weight:700;flex:1;">
        <span>⏳</span>
        <span>Gói Trọn đời — Đang chờ admin xác nhận thanh toán</span>
      </div>
      <div style="font-size:11px;color:#adb5bd;font-weight:500;flex-shrink:0;">Sẽ được kích hoạt sau khi xác nhận</div>
    `;
    banner.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#fffbea;border:1.5px solid #ffd43b;border-radius:12px;padding:10px 16px;margin-bottom:12px;';
    return;
  }

  // Free plan bình thường
  const usedMB  = gUserData.freeUsedMB || 0;
  const remainMB = Math.max(0, FREE_MB_LIMIT - usedMB).toFixed(0);
  const resetAt  = gUserData.freeResetAt?.toMillis ? gUserData.freeResetAt.toMillis() : Date.now();
  const resetStr = new Date(resetAt + FREE_RESET_MS).toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'});
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#7a5a00;font-weight:700;">
      <span>⚡</span>
      <span>Gói Miễn phí — Còn <b>${remainMB}</b> MB / 500 MB (reset lúc <b>${resetStr}</b>)</span>
    </div>
    <button onclick="openUpgradeModal()" style="flex-shrink:0;background:#212529;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;">Nâng cấp lên Trọn đời →</button>
  `;
  banner.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#fffbea;border:1.5px solid #ffd43b;border-radius:12px;padding:10px 16px;margin-bottom:12px;';
}

async function checkFreeLimit() {
  if (!gUserData || gUserData.plan !== 'free') return true;
  const now = Date.now();
  const resetAt = gUserData.freeResetAt?.toMillis ? gUserData.freeResetAt.toMillis() : 0;
  // Auto-reset nếu đã qua 5 giờ kể từ lần reset cuối
  if (now - resetAt > FREE_RESET_MS) {
    try {
      await updateDoc(doc(db,'users',gUser.uid), {freeUsedMB:0, freeResetAt:serverTimestamp()});
      gUserData.freeUsedMB = 0;
      gUserData.freeResetAt = { toMillis: () => Date.now() };
      updateFreeBanner();
    } catch(e) { console.warn('checkFreeLimit reset', e); }
    return true;
  }
  if ((gUserData.freeUsedMB || 0) >= FREE_MB_LIMIT) {
    showFreeLimitModal();
    return false;
  }
  return true;
}

async function updateFreeUsedMB() {
  if (!gUserData || gUserData.plan !== 'free' || !gUser) return;
  const newUsed = (gUserData.freeUsedMB || 0) + _sessionCopiedMB;
  try {
    await updateDoc(doc(db,'users',gUser.uid), {freeUsedMB: newUsed});
    gUserData.freeUsedMB = newUsed;
    updateFreeBanner();
  } catch(e) { console.warn('updateFreeUsedMB', e); }
}

// Mở paymentModal (context='upgrade') — từ freeBanner
window.openUpgradeModal = () => {
  _paymentContext = 'upgrade';
  const loginBtn   = document.getElementById('paymentLoginBtn');
  const upgradeBtn = document.getElementById('paymentUpgradeBtn');
  if (loginBtn)   loginBtn.style.display   = 'none';
  if (upgradeBtn) upgradeBtn.style.display = 'flex';
  document.getElementById('paymentModal')?.classList.add('active');
};

window.openUpgradeFromLimit = () => {
  window.closeFreeLimitModal();
  window.openUpgradeModal();
};

// Internal: thực sự gửi yêu cầu nâng cấp (gọi từ confirmPayment)
async function _doUpgradeRequestInternal(){
  if (!gUserData || !gUser) return;
  if (gUserData.upgradeRequestedAt) {
    toast('Yêu cầu nâng cấp đã được gửi, admin đang xử lý','info');
    return;
  }
  try {
    await updateDoc(doc(db,'users',gUser.uid), {upgradeRequestedAt: serverTimestamp()});
    gUserData.upgradeRequestedAt = { toMillis: () => Date.now() };
    sendUpgradeRequestEmail(gUser);
    updateFreeBanner(); // Thay freeBanner thành trạng thái "Chờ xác nhận"
    toast('Đã gửi yêu cầu! Admin sẽ xác nhận thanh toán và kích hoạt sớm nhất','ok');
  } catch(e) { toast('Lỗi: '+e.message,'err'); }
}

// Giữ backward compat nếu còn tham chiếu từ nơi khác
window.doUpgradeRequest = () => window.showPaymentConfirm();

function showFreeLimitModal() {
  const modal = document.getElementById('freeLimitModal');
  if (!modal) return;
  updateFreeLimitCountdown();
  modal.classList.add('active');
  if (_freeLimitTimer) clearInterval(_freeLimitTimer);
  _freeLimitTimer = setInterval(updateFreeLimitCountdown, 1000);
}

window.closeFreeLimitModal = () => {
  const modal = document.getElementById('freeLimitModal');
  if (modal) modal.classList.remove('active');
  if (_freeLimitTimer) { clearInterval(_freeLimitTimer); _freeLimitTimer = null; }
};

function updateFreeLimitCountdown() {
  if (!gUserData) return;
  const resetAt = gUserData.freeResetAt?.toMillis ? gUserData.freeResetAt.toMillis() : Date.now();
  const remaining = Math.max(0, resetAt + FREE_RESET_MS - Date.now());
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  const el = document.getElementById('freeLimitCountdown');
  if (el) el.textContent = `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  const elMB = document.getElementById('freeLimitUsedMB');
  if (elMB) elMB.textContent = Math.round(gUserData.freeUsedMB||0);
  if (remaining === 0) {
    window.closeFreeLimitModal();
    gUserData.freeUsedMB = 0;
    updateFreeBanner();
    toast('Đã hết thời gian chờ — bạn có thể sao chép tiếp!','ok');
  }
}

// ── UI HELPERS ───────────────────────────────────────────────
function sec(name, _noPush){
  ['land','check','pend','kicked','app'].forEach(s=>{const el=document.getElementById('s-'+s);if(el)el.style.display=s===name?'block':'none';});
  const nr=document.getElementById('navRight');if(nr)nr.style.display=name==='app'?'flex':'none';
  const ng=document.getElementById('navGuest');if(ng)ng.style.display=name==='app'?'none':'flex';
  if(!_noPush){
    if(name==='app'&&location.pathname!=='/copy-drive') history.pushState(null,'','/copy-drive');
    else if((name==='land'||name==='pend')&&location.pathname!=='/') history.pushState(null,'','/');
  }
}

// ── CLIENT-SIDE ROUTING ──────────────────────────────────────
window.addEventListener('popstate',()=>{
  if(location.pathname==='/copy-drive'){
    if(gUser) sec('app',true);
    else{ history.replaceState(null,'','/'); sec('land',true); }
  } else {
    sec('land',true);
  }
});
function setNavUser(u){
  document.getElementById('navAv').src=u.photoURL||'';
  document.getElementById('navName').textContent=u.displayName||u.email;
  document.getElementById('navEmail').textContent=u.email;
}
const BTN_BASE = {
  scan:  'flex-1 text-center py-2 text-[11px] font-bold rounded-lg transition select-none cursor-pointer active:scale-95',
  start: 'flex-1 text-center py-2 text-[11px] font-bold rounded-lg transition select-none cursor-pointer active:scale-95'
};
const BTN_STYLE = {
  scanIdle:  'border border-[#ffc9c9] text-[#fa5252] bg-[#fff5f5] hover:bg-[#fa5252] hover:text-white',
  scanScan:  'border border-[#fa5252] text-white bg-[#fa5252] hover:bg-[#e8291c]',
  startIdle: 'bg-[#ffc107] text-black hover:bg-[#e6ac00]',
  startCopy: 'bg-[#212529] text-white hover:bg-black'
};
function setBtnMode(mode){
  runMode=mode;
  const bs=document.getElementById('btnScan'),bst=document.getElementById('btnStart');
  const bsT=document.getElementById('btnScanTxt'),bstT=document.getElementById('btnStartTxt');
  const bp=document.getElementById('btnPause'),br=document.getElementById('btnResume');
  const bR=document.getElementById('btnReset');
  bs.disabled=false;bst.disabled=false;
  if(mode==='idle'){
    bs.className=BTN_BASE.scan+' '+BTN_STYLE.scanIdle; bsT.textContent='Kiểm tra trước';
    bst.className=BTN_BASE.start+' '+BTN_STYLE.startIdle; bstT.textContent='Bắt đầu sao chép';
    bp.style.display='none';br.style.display='none';bR.disabled=false;bR.style.opacity='1';
  } else if(mode==='scan'){
    bs.className=BTN_BASE.scan+' '+BTN_STYLE.scanScan; bsT.textContent='Dừng kiểm tra';
    bst.className=BTN_BASE.start+' '+BTN_STYLE.startIdle; bstT.textContent='Bắt đầu sao chép';
    bp.style.display='block';br.style.display='none';bR.disabled=true;bR.style.opacity='.4';
  } else if(mode==='copy'){
    bs.className=BTN_BASE.scan+' '+BTN_STYLE.scanIdle; bsT.textContent='Kiểm tra trước';
    bst.className=BTN_BASE.start+' '+BTN_STYLE.startCopy; bstT.textContent='Dừng sao chép';
    bp.style.display='block';br.style.display='none';bR.disabled=true;bR.style.opacity='.4';
  }
}
let _pv=0,_pm=1;
function setProgress(v,max,state){
  if(v!==null)_pv=v;if(max!==null)_pm=max;
  const f=document.getElementById('progFill');
  const track=f.parentElement;
  if(state==='scanning'||state==='running'){
    track.classList.add('indeterminate');
    f.style.width='';
  } else {
    track.classList.remove('indeterminate');
    if(state==='done'||state==='paused'){
      f.style.width='';
    } else {
      f.style.width=(_pm?Math.round(_pv/_pm*100):0)+'%';
    }
  }
  if(state)f.className='prog-fill '+state;
}
function setStatus(msg){document.getElementById('statusLbl').textContent=msg;document.getElementById('actionStatus').textContent=msg;}
function addLog(msg,lv='ok'){
  const C={ok:'#4ade80',err:'#f87171',info:'#93c5fd',skip:'#555',folder:'#c084fc',warn:'#fbbf24'};
  const I={ok:'✓',err:'✗',info:'→',skip:'⏭',folder:'▣',warn:'⏸'};
  const b=document.getElementById('logBox');
  const d=document.createElement('div');d.className='ll';
  const ts=new Date().toLocaleTimeString('vi-VN');
  d.innerHTML='<span class="ll-ts">'+ts+'</span><span class="ll-ic" style="color:'+(C[lv]||'#888')+'">'+(I[lv]||'·')+'</span><span class="ll-msg">'+escH(msg)+'</span>';
  b.appendChild(d);b.scrollTop=b.scrollHeight;
}
function updStats(){
  document.getElementById('sCopied').textContent=stats.copied;
  document.getElementById('sFailed').textContent=stats.failed;
  document.getElementById('sFolders').textContent=stats.folders;
}
function toast(msg,type='info'){
  const t=document.getElementById('toast');
  t.textContent=msg;t.className='toast on '+(type||'');
  setTimeout(()=>t.classList.remove('on'),3000);
}
window.toast = toast;
