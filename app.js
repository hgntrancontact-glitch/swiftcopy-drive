/* ══════════════ APP.JS — copy/scan/checklist/progress/UI ══════════════
   Auth logic  → auth.js
   Drive API   → drive-api.js
   Shared state → state.js
   ══════════════════════════════════════════════════════════════════ */
import { st, IS_DASHBOARD, FMIME, FREE_MB_LIMIT, FREE_RESET_MS, pausePoint, ns } from './state.js';
import {
  isAuthExpiredErr, fid, fname,
  listItems, existNames, mkFolder,
  isVideoItem, copyFileSingle, testFileCopy
} from './drive-api.js';
import { db, _handleAuthExpired as handleAuthExpired } from './auth.js';
import { doc, addDoc, updateDoc, collection, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Module constants (app.js only) ───────────────────────────
const SMIME          = 'application/vnd.google-apps.shortcut';
const CONCUR         = 16;
const FOLDER_CONCUR  = 8;
const SCAN_FILE_CONCUR   = 12;
const SCAN_FOLDER_CONCUR = 6;
const VIDWARN_KEY    = 'swiftcopy_hide_video_warning';
const SK             = 'swiftcopy_session';
const _mOpen         = new Set();
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

// ── Module-level state (app.js only) ─────────────────────────
let _stopPendingFn = null;
let _calcAnimTimer = null;
let _calcAnimStep  = 0;
let _calcAnimSel   = 0;
let _lastScanOkNodes     = [];
let _lastScanErrNodes    = [];
let _lastScanOkCount     = 0;
let _lastScanTotalErr    = 0;
let _scanDetailActiveTab = 'ok';

// ── Init ──────────────────────────────────────────────────────
st.stats = ns();

// Set up cross-module callbacks (called by auth.js + drive-api.js)
// These run before any async callbacks fire, so they're always available.
function _initCallbacks() {
  st.addLog          = addLog;
  st.sec             = sec;
  st.toast           = toast;
  st.setNavUser      = setNavUser;
  st.updateFreeBanner= updateFreeBanner;
  st.checkResume     = checkResume;
  st.showNoAuth      = showNoAuth;
}
_initCallbacks();

if (!IS_DASHBOARD) sec('land', true);

// ── OVERLAY ──────────────────────────────────────────────────
window.closeNoAuth = () => {
  document.getElementById('noAuthBackdrop').classList.remove('show');
  document.getElementById('noAuthPanel').classList.remove('show');
  st._authExpiredHandled = false;
  st._resumeAfterReauth  = null;
};
window.reAuthFromOverlay = async () => {
  const pendingResume = st._resumeAfterReauth;
  window.closeNoAuth();
  st._resumeAfterReauth = pendingResume;
  await window.reAuth?.();
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

// ── PAUSE / RESUME ────────────────────────────────────────────
window.doPause = () => {
  st.pauseFlag = true;
  document.getElementById('btnPause').style.display  = 'none';
  document.getElementById('btnResume').style.display = 'inline-flex';
  setProgress(null, null, 'paused');
  addLog('Tạm dừng', 'warn');
};
window.doResume = () => {
  st.pauseFlag = false;
  document.getElementById('btnPause').style.display  = 'inline-flex';
  document.getElementById('btnResume').style.display = 'none';
  setProgress(null, null, st.runMode === 'scan' ? 'scanning' : 'running');
  addLog('Tiếp tục', 'info');
  if (st._resumeResolve) { st._resumeResolve(); st._resumeResolve = null; }
};

window.handleScanBtn  = () => { if (st.runMode === 'scan') doStopScan();  else startScan(); };
window.handleStartBtn = () => { if (st.runMode === 'copy') doStopCopy();  else window.startCopy(); };

function doStopScan() {
  const t = document.getElementById('stopConfirmTitle');
  if (t) t.textContent = 'Dừng kiểm tra?';
  document.getElementById('stopConfirmModal').classList.add('active');
  _stopPendingFn = _execStop;
}
function doStopCopy() {
  const t = document.getElementById('stopConfirmTitle');
  if (t) t.textContent = 'Dừng sao chép?';
  document.getElementById('stopConfirmModal').classList.add('active');
  _stopPendingFn = _execStop;
}
function _execStop() {
  st.stopFlag = true; st.pauseFlag = false;
  st.abortCtrl?.abort(); st.abortCtrl = null;
  if (st._resumeResolve) { st._resumeResolve(); st._resumeResolve = null; }
  while (st._videoWaiters.length) st._videoWaiters.shift()();
  const f = document.getElementById('progFill');
  if (f && !f.className.includes('done')) f.className = 'prog-fill paused';
}
window.confirmStop = () => {
  document.getElementById('stopConfirmModal').classList.remove('active');
  _stopPendingFn?.();
  _stopPendingFn = null;
};
window.cancelStop = () => {
  document.getElementById('stopConfirmModal').classList.remove('active');
  _stopPendingFn = null;
};

window.doReset = () => {
  st.stopFlag = true; st.pauseFlag = false;
  st.abortCtrl?.abort(); st.abortCtrl = null;
  if (st._resumeResolve) { st._resumeResolve(); st._resumeResolve = null; }
  while (st._videoWaiters.length) st._videoWaiters.shift()();
  st.stats = ns(); updStats();
  _stopCalcAnim();
  st.clItems = []; st.clLoaded = false; st._totalDeepCount = 0;
  document.getElementById('srcInput').value  = '';
  document.getElementById('destInput').value = '';
  document.getElementById('srcPreview').style.display  = 'none';
  document.getElementById('destPreview').style.display = 'none';
  document.getElementById('checklistWrap').style.display = 'none';
  const _rf = document.getElementById('progFill');
  _rf.style.transition = 'none'; _rf.style.width = '0%'; _rf.className = 'prog-fill';
  _rf.parentElement.classList.remove('indeterminate');
  requestAnimationFrame(() => { _rf.style.transition = ''; });
  const _pi = document.getElementById('progInfo');
  if (_pi) { _pi.style.display = 'none'; _pi.innerHTML = ''; }
  document.getElementById('logBox').innerHTML = '';
  document.getElementById('scanRepModal')?.classList.remove('active');
  hideScanSummaryBanner();
  document.getElementById('statsRow').style.display = 'none';
  setStatus('Chưa bắt đầu');
  clearSession(); setBtnMode('idle');
  toast('Đã reset toàn bộ', 'ok');
};

// ── FOLDER NAME PREVIEW ───────────────────────────────────────
window.onInputChange = async (which) => {
  const inputId   = which === 'src' ? 'srcInput'   : 'destInput';
  const previewId = which === 'src' ? 'srcPreview' : 'destPreview';
  const val = document.getElementById(inputId).value.trim();
  const el  = document.getElementById(previewId);

  clearTimeout(st._previewTimers[which]);
  if (which === 'src') {
    st.clItems = []; st.clLoaded = false; st._totalDeepCount = 0;
    document.getElementById('checklistWrap').style.display = 'none';
    // Bug 2: reset khu vực Tiến trình đồng bộ khi đổi link nguồn
    if (st.runMode === 'idle') {
      st.stats = ns(); updStats();
      const _rf = document.getElementById('progFill');
      _rf.style.transition = 'none'; _rf.style.width = '0%'; _rf.className = 'prog-fill';
      requestAnimationFrame(() => { _rf.style.transition = ''; });
      const _pi = document.getElementById('progInfo');
      if (_pi) { _pi.style.display = 'none'; _pi.innerHTML = ''; }
      document.getElementById('logBox').innerHTML = '';
      document.getElementById('scanRepModal')?.classList.remove('active');
      hideScanSummaryBanner();
      document.getElementById('statsRow').style.display = 'none';
      setStatus('Chưa bắt đầu');
    }
  }
  if (!val) { el.style.display = 'none'; return; }

  el.style.display = 'flex'; el.className = 'folder-preview loading';
  el.innerHTML = '<div class="spin" style="width:12px;height:12px;border-width:2px"></div> Đang lấy tên...';

  st._previewTimers[which] = setTimeout(async () => {
    if (!st.gToken) { el.className = 'folder-preview error'; el.innerHTML = '<svg class="ic" style="color:var(--red)"><use href="#ic-warn"/></svg> Cần cấp quyền Drive trước'; return; }
    try {
      const id   = fid(val);
      const name = await fname(id);
      if (!name) { el.className = 'folder-preview error'; el.innerHTML = '<svg class="ic" style="color:var(--red)"><use href="#ic-warn"/></svg> Không tìm thấy thư mục'; return; }
      el.className = 'folder-preview';
      el.innerHTML = '<svg class="ic16" style="color:var(--green)"><use href="#ic-folder"/></svg> <span style="color:var(--green)">' + escH(name) + '</span>';
      if (which === 'src') loadChecklist(id);
    } catch (e) {
      if (isAuthExpiredErr(e)) { el.className = 'folder-preview error'; el.innerHTML = '<svg class="ic" style="color:var(--red)"><use href="#ic-warn"/></svg> Phiên cấp quyền đã hết hạn'; handleAuthExpired(); return; }
      el.className = 'folder-preview error';
      el.innerHTML = '<svg class="ic" style="color:var(--red)"><use href="#ic-warn"/></svg> Link không hợp lệ';
    }
  }, 600);
};

// ── CHECKLIST ─────────────────────────────────────────────────
async function loadChecklist(srcId) {
  const wrap = document.getElementById('checklistWrap');
  const body = document.getElementById('checklistBody');
  wrap.style.display = 'block';
  body.innerHTML = '<div class="cl-loading"><div class="spin"></div>Đang tải danh sách...</div>';
  st.clItems = []; st.clLoaded = false;

  try {
    const top = await listItems(srcId);
    st.clItems = top.map(item => ({
      id: item.id, name: item.name,
      mimeType: item.mimeType,
      size: parseInt(item.size) || 0,
      depth: 0,
      expanded: false,
      checked: true,
      indeterminate: false,
      children: null,
      parentId: null
    }));
    st.clLoaded = true;
    st._totalDeepCount = 0;
    renderChecklist();
    updateClInfo();
    const thisScanId = ++st._deepScanId;
    deepLoadAllFolders(thisScanId);
  } catch (e) {
    if (isAuthExpiredErr(e)) { body.innerHTML = '<div class="cl-empty">Phiên cấp quyền đã hết hạn</div>'; handleAuthExpired(); return; }
    body.innerHTML = '<div class="cl-empty">Lỗi tải danh sách: ' + escH(e.message) + '</div>';
  }
}

function countAllDeepItems() {
  let total = 0;
  function walk(items) {
    for (const item of items) {
      if (!item.checked && !item.indeterminate) continue;
      if (item.mimeType === FMIME) { total++; if (item.children) walk(item.children); }
      else if (item.mimeType !== SMIME) { total++; }
    }
  }
  walk(st.clItems);
  return total;
}

async function deepLoadAllFolders(scanId) {
  function collectUnloaded() {
    const found = [];
    function walk(items) {
      for (const item of items) {
        if (item.mimeType !== FMIME) continue;
        if (item.children === null) { found.push(item); }
        else { walk(item.children); }
      }
    }
    walk(st.clItems);
    return found;
  }
  const DEEP_CONCUR = 4;
  let unloaded = collectUnloaded();
  while (unloaded.length > 0) {
    if (st._deepScanId !== scanId) return;
    const batch = unloaded.splice(0, DEEP_CONCUR);
    await Promise.all(batch.map(async (item) => {
      if (st._deepScanId !== scanId || item.children !== null) return;
      try {
        const children = await listItems(item.id);
        if (st._deepScanId !== scanId) return;
        item.children = children.map(c => ({
          id: c.id, name: c.name, mimeType: c.mimeType,
          size: parseInt(c.size) || 0,
          depth: item.depth + 1, expanded: false,
          checked: item.checked, indeterminate: false,
          children: c.mimeType === FMIME ? null : [],
          parentId: item.id
        }));
      } catch (e2) {
        if (isAuthExpiredErr(e2)) { handleAuthExpired(); return; }
        item.children = [];
      }
    }));
    if (st._deepScanId !== scanId) return;
    updateClInfo();
    st._totalDeepCount = countAllDeepItems();
    unloaded = collectUnloaded();
  }
  if (st._deepScanId === scanId) { updateClInfo(); st._totalDeepCount = countAllDeepItems(); }
}

function renderChecklist() {
  const body = document.getElementById('checklistBody');
  if (!st.clItems.length) { body.innerHTML = '<div class="cl-empty">Không có mục nào.</div>'; return; }
  const visible = getVisibleItems();
  body.innerHTML = visible.map(item => buildClRow(item)).join('');
}

function getVisibleItems() {
  const visible = [];
  function walk(items) {
    for (const item of items) {
      visible.push(item);
      if (item.mimeType === FMIME && item.expanded && item.children) walk(item.children);
    }
  }
  walk(st.clItems.filter(i => i.depth === 0));
  return visible;
}

function buildClRow(item) {
  const isFolder  = item.mimeType === FMIME;
  const indent    = item.depth * 20;
  const chkCls    = item.checked ? 'checked' : (item.indeterminate ? 'indeterminate' : '');
  const expandIco = isFolder
    ? (item.children === null
        ? '<svg class="ic" style="color:var(--text3)"><use href="#ic-chev-r"/></svg>'
        : (item.expanded
            ? '<svg class="ic" style="color:var(--text3)"><use href="#ic-chev-d"/></svg>'
            : '<svg class="ic" style="color:var(--text3)"><use href="#ic-chev-r"/></svg>'))
    : '';
  const expandCls = isFolder ? '' : 'no-children';
  const folderIco = isFolder ? '📁' : '📄';
  const rowCls    = 'cl-row ' + (isFolder ? 'is-folder ' : '') + chkCls;
  return `<div class="${rowCls}" data-id="${escH(item.id)}" style="padding-left:${8 + indent}px"
    onclick="clRowClick(event,'${escH(item.id)}')"
    data-drag-id="${escH(item.id)}">
    <span class="cl-expand ${expandCls}" onclick="clToggleExpand(event,'${escH(item.id)}')">${expandIco}</span>
    <span class="cl-cb"><span class="cl-cb-tick">✓</span><span class="cl-cb-dash">-</span></span>
    <span class="cl-icon">${folderIco}</span>
    <span class="cl-name">${escH(item.name)}</span>
    ${isFolder ? '<span class="cl-meta">thư mục</span>' : ''}
  </div>`;
}

window.clRowClick = (e, id) => {
  if (e.target.closest('.cl-expand')) return;
  const item = findClItem(id);
  if (!item) return;
  setItemCheck(item, !item.checked);
  updateClInfo(); renderChecklist();
};

window.clToggleExpand = async (e, id) => {
  e.stopPropagation();
  const item = findClItem(id);
  if (!item || item.mimeType !== FMIME) return;
  if (item.children === null) {
    const row = document.querySelector(`[data-id="${id}"]`);
    if (row) { const exp = row.querySelector('.cl-expand'); if (exp) exp.innerHTML = '<div class="spin" style="width:12px;height:12px;border-width:2px"></div>'; }
    try {
      const children = await listItems(item.id);
      item.children = children.map(c => ({
        id: c.id, name: c.name, mimeType: c.mimeType,
        size: parseInt(c.size) || 0,
        depth: item.depth + 1, expanded: false,
        checked: item.checked, indeterminate: false,
        children: c.mimeType === FMIME ? null : [],
        parentId: item.id
      }));
      item.expanded = true;
    } catch (e) { if (isAuthExpiredErr(e)) { handleAuthExpired(); return; } toast('Lỗi tải thư mục: ' + e.message, 'err'); }
  } else {
    item.expanded = !item.expanded;
  }
  renderChecklist(); updateClInfo();
};

function setItemCheck(item, val) {
  item.checked = val; item.indeterminate = false;
  if (item.children) item.children.forEach(c => setItemCheck(c, val));
  updateParentState(item.parentId);
}

function updateParentState(parentId) {
  if (!parentId) return;
  const parent = findClItem(parentId);
  if (!parent || !parent.children) return;
  const allChecked  = parent.children.every(c => c.checked && !c.indeterminate);
  const noneChecked = parent.children.every(c => !c.checked && !c.indeterminate);
  if (allChecked)       { parent.checked = true;  parent.indeterminate = false; }
  else if (noneChecked) { parent.checked = false; parent.indeterminate = false; }
  else                  { parent.checked = false; parent.indeterminate = true;  }
  updateParentState(parent.parentId);
}

function findClItem(id) {
  function search(items) {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.children) { const f = search(item.children); if (f) return f; }
    }
    return null;
  }
  return search(st.clItems);
}

function calcSelectedBytes() {
  let total = 0;
  function walk(items) { for (const item of items) { if (item.mimeType !== FMIME && (item.checked || item.indeterminate)) total += (parseInt(item.size) || 0); if (item.children) walk(item.children); } }
  walk(st.clItems); return total;
}

function collectSelectedExtensions() {
  const sizes = new Map();
  function add(ext, size) { sizes.set(ext, (sizes.get(ext) || 0) + (size || 0)); }
  function walk(items) {
    for (const item of items) {
      if (item.mimeType === FMIME) { if (item.children) walk(item.children); continue; }
      if (!item.checked && !item.indeterminate) continue;
      if (item.mimeType === SMIME) continue;
      const sz = parseInt(item.size) || 0;
      if (item.mimeType === 'application/vnd.google-apps.document')     { add('doc',   sz); continue; }
      if (item.mimeType === 'application/vnd.google-apps.spreadsheet')  { add('sheet', sz); continue; }
      if (item.mimeType === 'application/vnd.google-apps.presentation') { add('slide', sz); continue; }
      if (item.mimeType.startsWith('application/vnd.google-apps.'))     { add('gdrive',sz); continue; }
      const dot = item.name.lastIndexOf('.');
      if (dot > 0 && dot < item.name.length - 1) add(item.name.slice(dot + 1).toLowerCase(), sz);
    }
  }
  walk(st.clItems);
  return [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([ext]) => ext);
}

function countUnloadedSelectedFolders() {
  let n = 0;
  function walk(items) {
    for (const item of items) {
      if (item.mimeType !== FMIME) continue;
      if ((item.checked || item.indeterminate) && item.children === null) { n++; }
      else if (item.children) { walk(item.children); }
    }
  }
  walk(st.clItems); return n;
}

// ── Calc animation helpers ────────────────────────────────────
function _startCalcAnim(selected) {
  _calcAnimSel = selected;
  if (_calcAnimTimer) return;
  _calcAnimStep = 0;
  _tickCalcAnim();
}
function _stopCalcAnim() {
  if (_calcAnimTimer) { clearTimeout(_calcAnimTimer); _calcAnimTimer = null; }
}
function _tickCalcAnim() {
  _calcAnimTimer = null;
  const sizeEl = document.getElementById('clSizeInfo');
  if (!sizeEl) return;
  if (countUnloadedSelectedFolders() === 0) { updateClInfo(); return; }
  const step = _calcAnimStep;
  _calcAnimStep = (_calcAnimStep + 1) % 4;
  const sel = _calcAnimSel;
  sizeEl.style.display = 'block';
  if (step < 3) {
    const dots = '.'.repeat(step + 1);
    sizeEl.innerHTML = `Đã chọn: <b>${sel} mục</b> <span class="calc-dot-pulse">●</span> <span style="color:#adb5bd;font-size:11px">Đang tính dung lượng${dots}</span>`;
    _calcAnimTimer = setTimeout(_tickCalcAnim, 500);
  } else {
    sizeEl.innerHTML = `Đã chọn: <b>${sel} mục</b> <span class="calc-shimmer-wrap"><span class="calc-shimmer-bar"></span></span>`;
    _calcAnimTimer = setTimeout(_tickCalcAnim, 1500);
  }
}

function updateClInfo() {
  const total    = st.clItems.length;
  const selected = st.clItems.filter(i => i.checked || i.indeterminate).length;
  document.getElementById('clTotal').textContent    = total;
  document.getElementById('clSelected').textContent = selected;

  const sizeEl = document.getElementById('clSizeInfo');
  if (!sizeEl) return;
  if (!st.clLoaded || !total) { _stopCalcAnim(); sizeEl.style.display = 'none'; return; }
  sizeEl.style.display = 'block';

  const unloaded = countUnloadedSelectedFolders();
  if (unloaded > 0) {
    _startCalcAnim(selected);
    return;
  }
  _stopCalcAnim();
  const rawMb = calcSelectedBytes() / (1024 * 1024);
  const mb = isNaN(rawMb) ? 0 : rawMb;
  const sizeStr = mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(1) + ' MB';
  const exts    = collectSelectedExtensions();
  const extTip  = exts.length > 0 ? ` <span style="color:#adb5bd;font-size:11px">(${exts.join(', ')})</span>` : '';
  if (st.gUserData?.plan === 'free') {
    const remainMB = Math.max(0, FREE_MB_LIMIT - (st.gUserData.freeUsedMB || 0));
    if (mb > remainMB) {
      const over = Math.ceil(mb - remainMB);
      sizeEl.innerHTML = `Đã chọn: <b>${sizeStr}</b>${extTip} &nbsp;<span style="color:#e67700;font-weight:700;">⚠ Vượt ${over}MB còn lại — <a href="#" onclick="openUpgradeModal();return false;" style="color:#d97706;text-decoration:underline">Nâng cấp gói</a></span>`;
    } else {
      sizeEl.innerHTML = `Đã chọn: <b>${sizeStr}</b>${extTip} <span style="color:#adb5bd;">(còn ${Math.round(remainMB)}MB / 500MB)</span>`;
    }
  } else {
    sizeEl.innerHTML = `Đã chọn: <b>${sizeStr}</b>${extTip}`;
  }
}

function updateSrcTotalInfo() {
  const el = document.getElementById('srcTotalSize');
  if (!el || !st.clLoaded) return;
  let totalBytes = 0, nativeCount = 0, folderCount = 0;
  for (const item of st.clItems) {
    if (item.mimeType === FMIME)  { folderCount++; continue; }
    if (item.mimeType === SMIME)  { continue; }
    if (item.mimeType.startsWith('application/vnd.google-apps.')) { nativeCount++; continue; }
    totalBytes += item.size || 0;
  }
  const mb = totalBytes / (1024 * 1024);
  const sizeStr = mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(1) + ' MB';
  const parts = [];
  if (totalBytes > 0 || (!nativeCount && !folderCount)) parts.push('~' + sizeStr);
  if (nativeCount > 0) parts.push(nativeCount + ' Google file');
  if (folderCount > 0) parts.push(folderCount + ' thư mục');
  el.textContent = 'Thư mục nguồn: ' + parts.join(' · ');
  el.style.display = 'block';
}

window.clSelectAll   = () => { st.clItems.forEach(i => setItemCheck(i, true));  updateClInfo(); renderChecklist(); };
window.clDeselectAll = () => { st.clItems.forEach(i => setItemCheck(i, false)); updateClInfo(); renderChecklist(); };

window.dragStart = (e) => {
  const row = e.target.closest('.cl-row');
  if (!row || e.target.closest('.cl-expand')) return;
  st._dragActive = true;
  const item = findClItem(row.dataset.id);
  if (item) { st._dragCheckValue = !item.checked; setItemCheck(item, st._dragCheckValue); updateClInfo(); renderChecklist(); }
};
window.dragOver = (e) => {
  if (!st._dragActive) return;
  const row = e.target.closest('.cl-row');
  if (!row || e.target.closest('.cl-expand')) return;
  const item = findClItem(row.dataset.id);
  if (item && item.checked !== st._dragCheckValue) { setItemCheck(item, st._dragCheckValue); updateClInfo(); renderChecklist(); }
};
window.dragEnd = () => { st._dragActive = false; };
document.addEventListener('mouseup', () => { st._dragActive = false; });

function getSelectedItems() {
  return st.clItems.filter(i => i.checked || i.indeterminate);
}

// ── PROGRESS ──────────────────────────────────────────────────
function _updateProgBar() {
  const f = document.getElementById('progFill');
  if (!f || f.className.includes('done') || f.className.includes('paused')) return;
  const total = Math.max(st._progTotal, st._totalDeepCount, 1);
  let pct;
  if (st.progDone <= total) {
    pct = Math.min(95, Math.round(st.progDone / total * 95));
  } else {
    const excess = st.progDone - total;
    pct = Math.min(99, Math.round(95 + 4 * excess / (excess + total)));
  }
  if (st._totalDeepCount > 0 && total === st._totalDeepCount) {
    f.style.width = pct + '%';
  } else {
    if (pct < st._maxPct - 35) st._maxPct = pct + 15;
    else st._maxPct = Math.max(st._maxPct, pct);
    f.style.width = st._maxPct + '%';
  }
}

function updateProgInfo(fileName, isDone) {
  const el = document.getElementById('progInfo');
  if (!el) return;
  if (!isDone && st.progDone === 0) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const x = st.progDone;
  const y = Math.max(x, st._totalDeepCount);
  const xColor = isDone ? '#099268' : '#212529';
  const yColor = isDone ? '#099268' : '#dc3545';
  const fileHtml = fileName ? ` <span style="color:#adb5bd;font-weight:400">${escH(fileName)}</span>` : '';
  el.innerHTML = `<b style="color:${xColor}">${x}</b> / <b style="color:${yColor}">${y}</b><b> mục</b>${fileHtml}`;
}

function progStart(startDone = 0) {
  st.progDone = startDone; st._maxPct = 0;
  const f = document.getElementById('progFill');
  if (f) {
    f.style.transition = 'none';
    f.style.width = '0%';
    f.className = 'prog-fill ' + (st.runMode === 'scan' ? 'scanning' : 'running');
    f.parentElement.classList.remove('indeterminate');
    if (startDone > 0) _updateProgBar();
    requestAnimationFrame(() => { f.style.transition = ''; });
  }
  const pi = document.getElementById('progInfo');
  if (pi) { pi.style.display = 'none'; pi.innerHTML = ''; }
}
function progInc(n) { st.progDone += (n || 1); _updateProgBar(); }
function progFinish() {
  const f = document.getElementById('progFill');
  if (st.stopFlag) {
    if (f && !f.className.includes('done')) f.className = 'prog-fill paused';
    updateProgInfo(null, false);
  } else {
    if (f) { f.style.width = '100%'; f.className = 'prog-fill done'; }
    updateProgInfo(null, true);
  }
}

// ── SCAN ──────────────────────────────────────────────────────
async function startScan() {
  if (!st.gToken) { showNoAuth('Chưa cấp quyền Drive!', 'Bạn cần cấp quyền truy cập Google Drive trước khi kiểm tra.'); return; }
  const sv = document.getElementById('srcInput').value.trim();
  const dv = document.getElementById('destInput').value.trim();
  if (!sv || !dv) { toast('Nhập đủ Drive nguồn và đích!', 'warn'); return; }

  st.stopFlag = false; st.pauseFlag = false; st.runMode = 'scan'; st._authExpiredHandled = false;
  st.abortCtrl = new AbortController();
  st.stats = ns();
  document.getElementById('scanRepModal')?.classList.remove('active');
  document.getElementById('statsRow').style.display = 'none';
  document.getElementById('logBox').innerHTML = '';
  setBtnMode('scan');
  setStatus('Đang chuẩn bị kiểm tra...');

  const t0 = Date.now();
  try {
    const srcId = fid(sv), destId = fid(dv);
    const sn = await fname(srcId);
    addLog('Bắt đầu kiểm tra quyền...', 'info');

    let topItems = await listItems(srcId);
    if (st.clLoaded && st.clItems.length > 0) {
      const selIds = new Set(st.clItems.filter(i => i.checked || i.indeterminate).map(i => i.id));
      topItems = topItems.filter(i => selIds.has(i.id));
    }
    if (st.stopFlag) { setStatus('Đã dừng kiểm tra'); setBtnMode('idle'); return; }

    st._progTotal = st._totalDeepCount > 0 ? st._totalDeepCount : topItems.length;
    progStart();
    setStatus('Đang kiểm tra "' + sn + '"...');

    const tree = await scanNodes(topItems, destId, '', 0, sn);
    if (st.stopFlag) { if (!st._authExpiredHandled) setStatus('Đã dừng kiểm tra'); setBtnMode('idle'); return; }

    const elapsed  = Math.round((Date.now() - t0) / 1000);
    const totalErr = cntErr(tree);
    progFinish();
    setStatus(totalErr === 0 ? 'Kiểm tra xong - Không có lỗi (' + elapsed + 's)' : 'Phát hiện ' + totalErr + ' vấn đề (' + elapsed + 's)');
    renderScanResult(tree, totalErr);
  } catch (e) {
    if (e.name === 'AbortError') { if (!st._authExpiredHandled) setStatus('Đã dừng kiểm tra'); return; }
    if (isAuthExpiredErr(e)) { handleAuthExpired(); return; }
    st.stopFlag = true; st.abortCtrl?.abort(); st.abortCtrl = null;
    addLog('Lỗi nghiêm trọng: ' + (e.message || e), 'err'); setStatus('Lỗi kiểm tra');
    if (e.message === 'NO_TOKEN') showNoAuth('Chưa cấp quyền Drive!', 'Nhấn nút bên dưới để cấp quyền.');
  } finally {
    st.runMode = 'idle'; setBtnMode('idle');
  }
}

async function scanNodes(items, destId, path, depth, srcName) {
  const folderItems = items.filter(c => c.mimeType === FMIME);
  const fileItems   = items.filter(c => c.mimeType !== FMIME);

  const fileNodes = await scanFileNodes(fileItems, destId, path, depth, srcName);
  if (st.stopFlag) return [...fileNodes];

  const folderNodes = new Array(folderItems.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++; if (i >= folderItems.length) return;
      await pausePoint(); if (st.stopFlag) return;
      const item = folderItems[i];
      const fp   = path ? path + ' > ' + item.name : item.name;
      let children;
      try { children = await listItems(item.id); }
      catch (e) { if (isAuthExpiredErr(e)) throw e; if (e.name === 'AbortError') throw e; children = []; }
      if (st._totalDeepCount === 0) st._progTotal += children.length;
      progInc(); updateProgInfo(item.name);
      st.stats.folders++; if (depth === 0) st.stats.topFolders++;
      addLog('Thư mục: ' + item.name, 'info');

      const testFile = children.find(c => c.mimeType !== FMIME && c.mimeType !== SMIME);
      let selfErr = null;
      if (testFile) {
        selfErr = await testFileCopy(testFile, destId);
        if (selfErr) addLog('Lỗi: ' + item.name + ' - ' + selfErr, 'err');
      }
      const subNodes = selfErr ? [] : await scanNodes(children, destId, fp, depth + 1, srcName);
      folderNodes[i] = { name: item.name, path: fp, type: 'folder', depth, error: selfErr, children: subNodes };
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(SCAN_FOLDER_CONCUR, Math.max(folderItems.length, 1)); w++) workers.push(worker());
  try { await Promise.all(workers); }
  catch (e) { if (isAuthExpiredErr(e)) throw e; if (e.name === 'AbortError') throw e; }
  if (st.stopFlag) return [...fileNodes, ...folderNodes.filter(Boolean)];
  return [...fileNodes, ...folderNodes];
}

async function scanFileNodes(items, destId, path, depth, srcName) {
  const nodes = new Array(items.length);
  for (let i = 0; i < items.length; i += SCAN_FILE_CONCUR) {
    await pausePoint(); if (st.stopFlag) break;
    const batch = items.slice(i, i + SCAN_FILE_CONCUR);
    await Promise.all(batch.map(async (item, bi) => {
      const realIdx = i + bi;
      await pausePoint(); if (st.stopFlag) return;
      const fp = path ? path + ' > ' + item.name : item.name;
      if (item.mimeType === SMIME) { progInc(); updateProgInfo(item.name); return; }
      addLog('Kiểm tra: ' + item.name, 'skip');
      let err;
      try { err = await testFileCopy(item, destId); }
      catch (e) { if (isAuthExpiredErr(e)) throw e; if (e.name === 'AbortError') throw e; err = 'Lỗi'; }
      if (err) { addLog('Lỗi: ' + item.name, 'err'); st.stats.failed++; }
      else      { addLog('OK: ' + item.name, 'ok'); st.stats.copied++; }
      progInc(); updateProgInfo(item.name);
      nodes[realIdx] = { name: item.name, path: fp, type: 'file', depth, error: err, children: [] };
    }));
    if (st.stopFlag) break;
  }
  return nodes.filter(Boolean);
}

function cntErr(nodes) { let c = 0; for (const n of nodes) { if (n.error) c++; if (n.children?.length) c += cntErr(n.children); } return c; }
function hasErr(node)  { if (node.error) return true; return (node.children || []).some(hasErr); }

function splitScanTree(nodes) {
  const okNodes = [], errNodes = [];
  for (const n of nodes) {
    if (n.type === 'folder') {
      const childSplit   = splitScanTree(n.children || []);
      const folderHasErr = !!n.error || childSplit.errNodes.length > 0;
      if (!folderHasErr) {
        okNodes.push({ ...n, children: childSplit.okNodes });
      } else {
        errNodes.push({ ...n, children: childSplit.errNodes });
        if (childSplit.okNodes.length) okNodes.push({ ...n, error: null, children: childSplit.okNodes, _partial: true });
      }
    } else {
      if (n.error) errNodes.push(n); else okNodes.push(n);
    }
  }
  return { okNodes, errNodes };
}

function renderScanResult(tree, totalErr) {
  const modal   = document.getElementById('scanRepModal');
  const content = document.getElementById('scanRepContent');
  const { okNodes, errNodes } = splitScanTree(tree);
  const okCount = countTreeNodes(okNodes);
  _lastScanOkNodes  = okNodes;
  _lastScanErrNodes = errNodes;
  _lastScanOkCount  = okCount;
  _lastScanTotalErr = totalErr;

  const headerBg   = totalErr === 0 ? '#ebfbee' : '#fff9db';
  const headerIcon = totalErr === 0
    ? '<svg style="width:26px;height:26px;color:#099268" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><use href="#ic-check-c"/></svg>'
    : '<svg style="width:26px;height:26px;color:#f59f00" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><use href="#ic-warn"/></svg>';
  const headerTitle = totalErr === 0 ? 'Kiểm tra xong — Không có lỗi!' : 'Phát hiện ' + totalErr + ' mục có vấn đề';

  const okBtnStyle  = 'display:flex;align-items:center;justify-content:center;gap:7px;padding:10px 18px;border-radius:10px;font-size:13.5px;font-weight:700;cursor:pointer;border:1.5px solid #c3fae8;background:#e6fcf5;color:#099268;transition:all .15s';
  const errBtnStyle = totalErr > 0
    ? 'display:flex;align-items:center;justify-content:center;gap:7px;padding:10px 18px;border-radius:10px;font-size:13.5px;font-weight:700;cursor:pointer;border:1.5px solid #ffe3e3;background:#fff5f5;color:#fa5252;transition:all .15s'
    : 'display:flex;align-items:center;justify-content:center;gap:7px;padding:10px 18px;border-radius:10px;font-size:13.5px;font-weight:700;cursor:default;pointer-events:none;opacity:0.6;border:1.5px solid #e9ecef;background:#f8f9fa;color:#adb5bd';
  const errBtnClick = totalErr > 0 ? 'onclick="window.toggleScanDetail(\'err\')"' : '';
  const okHover  = `onmouseenter="this.style.background='#d3f9d8';this.style.borderColor='#8ce99a'" onmouseleave="this.style.background='#e6fcf5';this.style.borderColor='#c3fae8'"`;
  const errHover = totalErr > 0 ? `onmouseenter="this.style.background='#ffe3e3';this.style.borderColor='#ffa8a8'" onmouseleave="this.style.background='#fff5f5';this.style.borderColor='#ffe3e3'"` : '';

  content.innerHTML = `
  <div style="text-align:center;padding-bottom:20px;border-bottom:1px solid #f1f3f5;margin-bottom:20px">
    <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:${headerBg};margin-bottom:12px">${headerIcon}</div>
    <div style="font-size:18px;font-weight:800;color:#212529;margin-bottom:4px">${headerTitle}</div>
    <div style="font-size:13px;color:#868e96">Kết quả kiểm tra quyền trước khi bắt đầu sao chép</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
    <button id="scanRepOkBtn" onclick="window.toggleScanDetail('ok')" ${okHover} style="${okBtnStyle}">
      <svg style="width:15px;height:15px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><use href="#ic-check-c"/></svg>
      <b>${okCount}</b> sẽ copy thành công
    </button>
    <button id="scanRepErrBtn" ${errBtnClick} ${errHover} style="${errBtnStyle}">
      <svg style="width:15px;height:15px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><use href="#ic-warn"/></svg>
      <b>${totalErr}</b> sẽ lỗi
    </button>
  </div>
  <div id="scanDetailOk" style="display:none;margin-bottom:14px;border:1px solid #c3fae8;border-radius:10px;overflow:hidden;max-height:300px;overflow-y:auto">
    <div class="tree-body" id="scanDetailOkBody"></div>
  </div>
  <div id="scanDetailErr" style="display:none;margin-bottom:14px;border:1px solid #ffe3e3;border-radius:10px;overflow:hidden;max-height:300px;overflow-y:auto">
    <div style="padding:10px 14px 4px;font-size:12px;color:#868e96;border-bottom:1px solid #fff0f0"><svg style="width:13px;height:13px;vertical-align:-2px;color:#adb5bd;margin-right:4px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#ic-info"/></svg>Vào Drive nguồn → chuột phải → <b>Chia sẻ</b> → thêm email bạn quyền <b>Người chỉnh sửa</b></div>
    <div class="tree-body" id="scanDetailErrBody"></div>
  </div>
  <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;padding-top:16px;border-top:1px solid #f1f3f5">
    <button onclick="window.closeScanReportReview()" style="padding:10px 20px;border-radius:10px;font-size:13.5px;font-weight:700;cursor:pointer;border:1.5px solid #ffc9c9;background:#fff5f5;color:#fa5252;transition:all .15s">Để tôi kiểm tra lại</button>
    <button onclick="window.closeScanReportAndStart()" style="padding:10px 20px;border-radius:10px;font-size:13.5px;font-weight:700;cursor:pointer;border:none;background:#ffc107;color:#212529;box-shadow:0 2px 8px rgba(255,193,7,.35);transition:all .15s">Bắt đầu sao chép ngay →</button>
  </div>`;

  _setupScanDetailTree('ok', okNodes);
  _setupScanDetailTree('err', errNodes);
  modal.classList.add('active');
}

function _setupScanDetailTree(type, nodes) {
  const bodyId = type === 'ok' ? 'scanDetailOkBody' : 'scanDetailErrBody';
  const fnName = type === 'ok' ? '_scanRepOkToggle' : '_scanRepErrToggle';
  const firstFolder = nodes.find(n => n.type === 'folder' && n.depth === 0);
  const openSet = new Set();
  window[fnName] = function (path) {
    togglePathSet(openSet, path);
    const body = document.getElementById(bodyId);
    if (body) body.innerHTML = buildTreeHTML(nodes, openSet, fnName);
  };
  const body = document.getElementById(bodyId);
  if (body) body.innerHTML = nodes.length ? buildTreeHTML(nodes, openSet, fnName) : '<p style="color:#868e96;text-align:center;padding:20px;font-size:13px">Không có mục nào.</p>';
  if (firstFolder) window[fnName](firstFolder.path);
}

window.toggleScanDetail = function (type) {
  const okEl  = document.getElementById('scanDetailOk');
  const errEl = document.getElementById('scanDetailErr');
  if (!okEl || !errEl) return;
  if (type === 'ok')  { const show = okEl.style.display === 'none';  okEl.style.display = show ? 'block' : 'none'; errEl.style.display = 'none'; }
  else                { const show = errEl.style.display === 'none'; errEl.style.display = show ? 'block' : 'none'; okEl.style.display  = 'none'; }
};

window.closeScanReport = () => { document.getElementById('scanRepModal')?.classList.remove('active'); };
window.closeScanReportReview = () => {
  document.getElementById('scanRepModal')?.classList.remove('active');
  showScanSummaryBanner();
};
window.closeScanReportAndStart = () => {
  document.getElementById('scanRepModal')?.classList.remove('active');
  hideScanSummaryBanner();
  window.startCopy();
};
window.openScanDetailModal = (tab) => {
  tab = tab || (_lastScanTotalErr > 0 ? 'err' : 'ok');
  const modal = document.getElementById('scanDetailModal');
  if (!modal) return;
  const okCountEl  = document.getElementById('scanDetailOkCount');
  const errCountEl = document.getElementById('scanDetailErrCount');
  if (okCountEl)  okCountEl.textContent  = _lastScanOkCount;
  if (errCountEl) errCountEl.textContent = _lastScanTotalErr;
  const errBtn = document.getElementById('scanDetailTabErrBtn');
  if (errBtn) {
    errBtn.style.pointerEvents = _lastScanTotalErr > 0 ? '' : 'none';
    errBtn.style.opacity       = _lastScanTotalErr > 0 ? '' : '0.45';
  }
  _scanDetailActiveTab = tab;
  _renderScanDetailTab(tab);
  modal.classList.add('active');
};
window.closeScanDetailModal = () => {
  document.getElementById('scanDetailModal')?.classList.remove('active');
};
window.switchScanDetailTab = (tab) => {
  if (tab === 'err' && _lastScanTotalErr === 0) return;
  _scanDetailActiveTab = tab;
  _renderScanDetailTab(tab);
};

function showScanSummaryBanner() {
  const el = document.getElementById('scanSummaryBanner');
  if (!el) return;
  const okNumEl  = document.getElementById('scanSumOkNum');
  const errNumEl = document.getElementById('scanSumErrNum');
  if (okNumEl)  okNumEl.textContent  = _lastScanOkCount;
  if (errNumEl) errNumEl.textContent = _lastScanTotalErr;
  const errCell = document.getElementById('scanSumErrCell');
  if (errCell) {
    if (_lastScanTotalErr > 0) {
      errCell.style.opacity = '1'; errCell.style.cursor = 'pointer';
      errCell.onclick = () => window.openScanDetailModal('err');
    } else {
      errCell.style.opacity = '0.45'; errCell.style.cursor = 'default';
      errCell.onclick = null;
    }
  }
  el.style.display = 'block';
}
function hideScanSummaryBanner() {
  const el = document.getElementById('scanSummaryBanner');
  if (el) el.style.display = 'none';
}
function _renderScanDetailTab(tab) {
  const okBtn   = document.getElementById('scanDetailTabOkBtn');
  const errBtn  = document.getElementById('scanDetailTabErrBtn');
  const content = document.getElementById('scanDetailModalContent');
  const hint    = document.getElementById('scanDetailErrHint');
  if (!content) return;
  const activeStyle   = 'padding:11px 18px;font-size:13px;font-weight:800;border:none;background:transparent;cursor:pointer;border-bottom:2px solid #212529;color:#212529;margin-bottom:-2px;transition:all .15s';
  const inactiveStyle = 'padding:11px 18px;font-size:13px;font-weight:600;border:none;background:transparent;cursor:pointer;border-bottom:2px solid transparent;color:#868e96;margin-bottom:-2px;transition:all .15s';
  if (okBtn)  okBtn.style.cssText  = tab === 'ok'  ? activeStyle : inactiveStyle;
  if (errBtn) {
    errBtn.style.cssText = tab === 'err' ? activeStyle : inactiveStyle;
    if (_lastScanTotalErr === 0) { errBtn.style.pointerEvents = 'none'; errBtn.style.opacity = '0.45'; }
  }
  if (hint) hint.style.display = tab === 'err' ? 'block' : 'none';
  const isOk   = tab === 'ok';
  const nodes  = isOk ? _lastScanOkNodes : _lastScanErrNodes;
  const fnName = isOk ? '_scanDtlOkToggle' : '_scanDtlErrToggle';
  const openSet = new Set();
  const firstFolder = nodes.find(n => n.type === 'folder' && n.depth === 0);
  window[fnName] = function (path) {
    togglePathSet(openSet, path);
    content.innerHTML = nodes.length
      ? buildTreeHTML(nodes, openSet, fnName)
      : '<p style="color:#868e96;text-align:center;padding:28px;font-size:13px">Không có mục nào.</p>';
  };
  content.innerHTML = nodes.length
    ? buildTreeHTML(nodes, openSet, fnName)
    : '<p style="color:#868e96;text-align:center;padding:28px;font-size:13px">Không có mục nào.</p>';
  if (firstFolder) window[fnName](firstFolder.path);
}

window.doProgressReset = () => {
  if (st.runMode !== 'idle') {
    st.stopFlag = true; st.pauseFlag = false;
    if (st._resumeResolve) { st._resumeResolve(); st._resumeResolve = null; }
  }
  st.stats = ns();
  const _rf = document.getElementById('progFill');
  _rf.style.transition = 'none'; _rf.style.width = '0%'; _rf.className = 'prog-fill';
  _rf.parentElement.classList.remove('indeterminate');
  requestAnimationFrame(() => { _rf.style.transition = ''; });
  const _pi = document.getElementById('progInfo');
  if (_pi) { _pi.style.display = 'none'; _pi.innerHTML = ''; }
  document.getElementById('logBox').innerHTML = '';
  document.getElementById('scanRepModal')?.classList.remove('active');
  hideScanSummaryBanner();
  document.getElementById('statsRow').style.display = 'none';
  setStatus('Chưa bắt đầu');
  st.runMode = 'idle'; setBtnMode('idle');
  toast('Đã reset tiến trình', 'ok');
};

function togglePathSet(set, path) { set.has(path) ? set.delete(path) : set.add(path); }

function countTreeNodes(nodes) {
  let c = 0;
  for (const n of nodes) { c++; if (n.children?.length) c += countTreeNodes(n.children); }
  return c;
}

// ── VIDEO WARN (dead legacy + new modal) ─────────────────────
async function countVideoFiles(items, clFilterChildren) {
  let count = 0;
  let workItems = items;
  if (clFilterChildren) {
    const allowedIds = new Set(clFilterChildren.filter(c => c.checked || c.indeterminate).map(c => c.id));
    workItems = items.filter(i => allowedIds.has(i.id));
  }
  for (const item of workItems) {
    await pausePoint(); if (st.stopFlag) return count;
    if (item.mimeType === FMIME) {
      let children = [];
      try { children = await listItems(item.id); } catch { children = []; }
      let subFilter = null;
      if (clFilterChildren) { const clItem = clFilterChildren.find(c => c.id === item.id); if (clItem && clItem.indeterminate && clItem.children) subFilter = clItem.children; }
      count += await countVideoFiles(children, subFilter);
    } else if (item.mimeType !== SMIME) {
      if (isVideoItem(item)) count++;
    }
  }
  return count;
}
window.closeVidWarn  = () => { document.getElementById('vidWarnOv').classList.remove('on'); };
window.confirmVidWarn = () => {
  if (document.getElementById('vidWarnDontShow').checked) localStorage.setItem(VIDWARN_KEY, '1');
  document.getElementById('vidWarnOv').classList.remove('on');
  _runCopyInternal(st._pendingCopyResume);
};

function showVideoWarn(count, mode) {
  st._videoWarnMode = mode;
  document.getElementById('videoWarnCount').textContent = count;
  const btn = document.getElementById('videoWarnBtn');
  if (mode === 'before') { btn.textContent = 'Đã hiểu, bắt đầu sao chép'; btn.onclick = () => window.confirmVideoWarn(); }
  else                   { btn.textContent = 'Đã hiểu'; btn.onclick = () => window.closeVideoWarn(); }
  document.getElementById('videoWarnModal').classList.add('active');
}
window.confirmVideoWarn = () => { document.getElementById('videoWarnModal').classList.remove('active'); _runCopyInternal(st._pendingCopyResume); };
window.closeVideoWarn   = () => { document.getElementById('videoWarnModal').classList.remove('active'); };

// ── COPY ──────────────────────────────────────────────────────
window.startCopy = async (isResume) => {
  if (!st.gToken) { showNoAuth('Chưa cấp quyền Drive!', 'Bạn cần cấp quyền truy cập Google Drive trước khi sao chép.'); return; }
  const sv = document.getElementById('srcInput').value.trim();
  const dv = document.getElementById('destInput').value.trim();
  if (!sv || !dv) { toast('Nhập đủ Drive nguồn và đích!', 'warn'); return; }
  if (!isResume) { st.stopFlag = false; setBtnMode('copy'); }
  if (!isResume && !(await checkFreeLimit())) { setBtnMode('idle'); return; }
  await _runCopyInternal(isResume);
};

function videoGate(item) {
  st._videoSeenCount++;
  if (localStorage.getItem(VIDWARN_KEY) === '1') return Promise.resolve();
  if (st._videoWarnShown) return Promise.resolve();
  st._videoWarnShown = true;
  return new Promise(resolve => {
    st._videoWarnResolve = resolve;
    document.getElementById('vidWarnCount').textContent = '';
    document.getElementById('vidWarnTitleNote').style.display = 'block';
    document.getElementById('vidWarnOv').classList.add('on');
  });
}

async function _runCopyInternal(isResume) {
  const sv = document.getElementById('srcInput').value.trim();
  const dv = document.getElementById('destInput').value.trim();
  if (!sv || !dv) { toast('Nhập đủ Drive nguồn và đích!', 'warn'); return; }

  st.stopFlag = false; st.pauseFlag = false; st.runMode = 'copy'; st._authExpiredHandled = false;
  st.abortCtrl = new AbortController(); st._videoActive = 0; st._videoWaiters.length = 0;
  if (!isResume) { st.stats = ns(); st._sessionCopiedMB = 0; }
  document.getElementById('logBox').innerHTML = '';
  document.getElementById('scanRepModal')?.classList.remove('active');
  hideScanSummaryBanner();
  document.getElementById('statsRow').style.display = 'grid';
  updStats(); setBtnMode('copy');

  const t0 = Date.now();
  st._videoFilesCount = 0;
  try {
    const srcId = fid(sv), destId = fid(dv);
    const sn = await fname(srcId), dn = await fname(destId);
    setStatus('Đang chuẩn bị "' + sn + '" -> "' + dn + '"');
    addLog('Nguồn: ' + sn, 'info'); addLog('Đích: ' + dn, 'info');
    saveSessionData({ sv, dv, srcId, sn, destId, dn });

    let top = await listItems(srcId);
    let clFilter = null;
    if (st.clLoaded && st.clItems.length > 0) {
      const selIds = new Set(st.clItems.filter(i => i.checked || i.indeterminate).map(i => i.id));
      top = top.filter(i => selIds.has(i.id));
      clFilter = st.clItems;
    }
    if (!top.length) { toast('Không có mục nào được chọn!', 'warn'); setBtnMode('idle'); st.runMode = 'idle'; return; }
    if (st.stopFlag) { setStatus('Đã dừng sao chép'); setBtnMode('idle'); st.runMode = 'idle'; return; }

    const _savedSess = isResume ? getSession() : null;
    st._progTotal = _savedSess?.progTotal || (st._totalDeepCount > 0 ? st._totalDeepCount : top.length);
    const _startDone = isResume ? (_savedSess?.progDone || 0) : 0;
    progStart(_startDone);
    if (_startDone > 0) updateProgInfo('', false);
    setStatus('Đang sao chép...');

    if (st.gUserData?.plan === 'free') {
      const hasTopVideo = top.some(i => isVideoItem(i));
      if (hasTopVideo) { addLog('⚠ Phát hiện video — gói miễn phí sẽ bỏ qua file video', 'warn'); toast('Gói miễn phí bỏ qua video. Nâng cấp để copy toàn bộ', 'warn'); }
    }
    addLog((isResume ? 'Tiếp tục sao chép' : 'Bắt đầu sao chép') + ' (' + CONCUR + ' luồng song song)...', 'info');

    const dex = await existNames(destId);
    const topFolders = top.filter(i => i.mimeType === FMIME);
    const topFiles   = top.filter(i => i.mimeType !== FMIME && i.mimeType !== SMIME);

    if (topFiles.length) {
      let fIdx = 0;
      const topFileWorker = async () => {
        while (true) {
          if (st.stopFlag) return;
          const item = topFiles[fIdx++]; if (!item) return;
          await pausePoint(); if (st.stopFlag) return;
          if (dex.has(item.name)) { addLog('Đã có: ' + item.name, 'skip'); progInc(); updateProgInfo(item.name); continue; }
          if (st.gUserData?.plan === 'free' && isVideoItem(item)) { addLog('Bỏ qua video (miễn phí): ' + item.name, 'skip'); progInc(); updateProgInfo(item.name); continue; }
          const res = await copyFileSingle(item, destId);
          if (st.stopFlag) return;
          const node = { name: item.name, path: item.name, type: 'file', depth: 0, error: res.ok ? null : (res.reason || 'Lỗi'), children: [], link: res.ok ? null : 'https://drive.google.com/file/d/' + item.id + '/view' };
          if (res.ok) { st.stats.copied++; st.stats.copiedFiles.push(node); addLog('OK: ' + item.name, 'ok'); st._sessionCopiedMB += (res.sizeMB || 0); if (st.gUserData?.plan !== 'free' && isVideoItem(item)) st._videoFilesCount++; }
          else        { st.stats.failed++; st.stats.failedFiles.push(node); addLog('Lỗi: ' + item.name + ' - ' + res.reason, 'err'); }
          updStats(); saveSession();
          progInc(); updateProgInfo(item.name);
        }
      };
      const fw = [];
      for (let w = 0; w < Math.min(CONCUR, topFiles.length); w++) fw.push(topFileWorker());
      await Promise.all(fw);
    }

    if (!st.stopFlag && topFolders.length) {
      let idx = 0;
      async function folderWorker() {
        while (true) {
          const i = idx++; if (i >= topFolders.length) return;
          await pausePoint(); if (st.stopFlag) return;
          const item = topFolders[i];
          const nid  = await mkFolder(item.name, destId);
          let node = st.stats.folderList.find(f => f.depth === 0 && f.name === item.name && f._srcId === item.id);
          if (!node) {
            st.stats.folders++; st.stats.topFolders++;
            node = { name: item.name, path: item.name, type: 'folder', depth: 0, error: null, children: [], _srcId: item.id };
            st.stats.folderList.push(node);
          }
          addLog('Thư mục: ' + item.name, 'folder'); updStats(); saveSession();
          progInc(); updateProgInfo(item.name);
          const clItem = st.clItems.find(ci => ci.id === item.id);
          if (clItem && clItem.indeterminate && clItem.children) {
            await copyRecTreeFiltered(item.id, nid, item.name, 1, node.children, clItem);
          } else {
            await copyRecTree(item.id, nid, item.name, 1, node.children);
          }
        }
      }
      const workers = [];
      for (let w = 0; w < Math.min(FOLDER_CONCUR, topFolders.length); w++) workers.push(folderWorker());
      await Promise.all(workers);
    }

    const elapsed = Math.round((Date.now() - t0) / 1000);
    progFinish();
    if (!st.stopFlag) {
      setStatus('Hoàn thành ' + elapsed + 's');
      clearSession();
      if (st.gUserData?.plan !== 'free') await saveHist(srcId, sn, destId, dn, elapsed);
      if (st.gUserData?.plan === 'free') await updateFreeUsedMB();
      showComplModal(elapsed, st._videoFilesCount);
    } else if (!st._authExpiredHandled) {
      setStatus('Đã dừng sao chép');
    }
  } catch (e) {
    if (e.name === 'AbortError') { if (!st._authExpiredHandled) setStatus('Đã dừng sao chép'); return; }
    if (isAuthExpiredErr(e)) { handleAuthExpired(); return; }
    st.stopFlag = true; st.abortCtrl?.abort(); st.abortCtrl = null;
    while (st._videoWaiters.length) st._videoWaiters.shift()();
    addLog('Lỗi nghiêm trọng: ' + (e.message || e), 'err'); setStatus('Lỗi sao chép');
    if (e.message === 'NO_TOKEN') showNoAuth('Chưa cấp quyền Drive!', 'Nhấn nút bên dưới để cấp quyền.');
  } finally {
    st.runMode = 'idle'; setBtnMode('idle');
  }
}

async function copyRecTree(srcId, destId, path, depth, parentChildren) {
  await pausePoint(); if (st.stopFlag) return;
  const items = await listItems(srcId);
  if (st._totalDeepCount === 0) st._progTotal += items.length;
  const dnames = await existNames(destId);
  const folders      = items.filter(i => i.mimeType === FMIME);
  const files        = items.filter(i => i.mimeType !== FMIME && i.mimeType !== SMIME && !dnames.has(i.name));
  const skippedFiles = items.filter(i => i.mimeType !== FMIME && i.mimeType !== SMIME && dnames.has(i.name));
  skippedFiles.forEach(i => { addLog('Đã có: ' + i.name, 'skip'); progInc(); updateProgInfo(i.name); });
  if (files.length) {
    let fIdx = 0;
    const fw = async () => {
      while (true) {
        if (st.stopFlag) return;
        const item = files[fIdx++]; if (!item) return;
        await pausePoint(); if (st.stopFlag) return;
        const fp = path ? path + ' > ' + item.name : item.name;
        if (st.gUserData?.plan === 'free' && isVideoItem(item)) { addLog('Bỏ qua video (miễn phí): ' + item.name, 'skip'); progInc(); updateProgInfo(item.name); continue; }
        const res = await copyFileSingle(item, destId);
        if (st.stopFlag) return;
        const node = { name: item.name, path: fp, type: 'file', depth, error: res.ok ? null : (res.reason || 'Lỗi'), children: [], link: res.ok ? null : 'https://drive.google.com/file/d/' + item.id + '/view' };
        if (res.ok) { st.stats.copied++; st.stats.copiedFiles.push(node); addLog('OK: ' + item.name, 'ok'); st._sessionCopiedMB += (res.sizeMB || 0); if (st.gUserData?.plan !== 'free' && isVideoItem(item)) st._videoFilesCount++; }
        else        { st.stats.failed++; st.stats.failedFiles.push(node); addLog('Lỗi: ' + item.name + ' - ' + res.reason, 'err'); }
        parentChildren.push(node); updStats(); saveSession();
        progInc(); updateProgInfo(item.name);
      }
    };
    const ww = [];
    for (let w = 0; w < Math.min(CONCUR, files.length); w++) ww.push(fw());
    await Promise.all(ww);
  }
  if (st.stopFlag || !folders.length) return;
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++; if (i >= folders.length) return;
      await pausePoint(); if (st.stopFlag) return;
      const f  = folders[i];
      const fp = path ? path + ' > ' + f.name : f.name;
      const nid = await mkFolder(f.name, destId);
      st.stats.folders++;
      const node = { name: f.name, path: fp, type: 'folder', depth, error: null, children: [] };
      st.stats.folderList.push(node); parentChildren.push(node);
      addLog('Thư mục: ' + f.name, 'folder'); updStats();
      progInc(); updateProgInfo(f.name);
      await copyRecTree(f.id, nid, fp, depth + 1, node.children);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(FOLDER_CONCUR, folders.length); w++) workers.push(worker());
  await Promise.all(workers);
}

async function copyRecTreeFiltered(srcId, destId, path, depth, parentChildren, clItem) {
  await pausePoint(); if (st.stopFlag) return;
  const items = await listItems(srcId);
  if (st._totalDeepCount === 0) st._progTotal += items.length;
  const dnames = await existNames(destId);
  const checkedChildIds = clItem.children ? new Set(clItem.children.filter(c => c.checked || c.indeterminate).map(c => c.id)) : null;
  const filteredItems   = checkedChildIds ? items.filter(i => checkedChildIds.has(i.id)) : items;
  const folders      = filteredItems.filter(i => i.mimeType === FMIME);
  const files        = filteredItems.filter(i => i.mimeType !== FMIME && i.mimeType !== SMIME && !dnames.has(i.name));
  const skippedFiles = filteredItems.filter(i => i.mimeType !== FMIME && i.mimeType !== SMIME && dnames.has(i.name));
  skippedFiles.forEach(i => { addLog('Đã có: ' + i.name, 'skip'); progInc(); updateProgInfo(i.name); });
  if (files.length) {
    let fIdx = 0;
    const fw = async () => {
      while (true) {
        if (st.stopFlag) return;
        const item = files[fIdx++]; if (!item) return;
        await pausePoint(); if (st.stopFlag) return;
        const fp = path ? path + ' > ' + item.name : item.name;
        if (st.gUserData?.plan === 'free' && isVideoItem(item)) { addLog('Bỏ qua video (miễn phí): ' + item.name, 'skip'); progInc(); updateProgInfo(item.name); continue; }
        const res = await copyFileSingle(item, destId);
        if (st.stopFlag) return;
        const node = { name: item.name, path: fp, type: 'file', depth, error: res.ok ? null : (res.reason || 'Lỗi'), children: [], link: res.ok ? null : 'https://drive.google.com/file/d/' + item.id + '/view' };
        if (res.ok) { st.stats.copied++; st.stats.copiedFiles.push(node); addLog('OK: ' + item.name, 'ok'); st._sessionCopiedMB += (res.sizeMB || 0); if (st.gUserData?.plan !== 'free' && isVideoItem(item)) st._videoFilesCount++; }
        else        { st.stats.failed++; st.stats.failedFiles.push(node); addLog('Lỗi: ' + item.name + ' - ' + res.reason, 'err'); }
        parentChildren.push(node); updStats(); saveSession();
        progInc(); updateProgInfo(item.name);
      }
    };
    const ww = [];
    for (let w = 0; w < Math.min(CONCUR, files.length); w++) ww.push(fw());
    await Promise.all(ww);
  }
  if (st.stopFlag || !folders.length) return;
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++; if (i >= folders.length) return;
      await pausePoint(); if (st.stopFlag) return;
      const f  = folders[i];
      const fp = path ? path + ' > ' + f.name : f.name;
      const nid = await mkFolder(f.name, destId);
      st.stats.folders++;
      const node = { name: f.name, path: fp, type: 'folder', depth, error: null, children: [] };
      st.stats.folderList.push(node); parentChildren.push(node);
      addLog('Thư mục: ' + f.name, 'folder'); updStats();
      progInc(); updateProgInfo(f.name);
      const subCl = clItem.children ? clItem.children.find(c => c.id === f.id) : null;
      if (subCl && subCl.indeterminate) await copyRecTreeFiltered(f.id, nid, fp, depth + 1, node.children, subCl);
      else await copyRecTree(f.id, nid, fp, depth + 1, node.children);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(FOLDER_CONCUR, folders.length); w++) workers.push(worker());
  await Promise.all(workers);
}

// ── TREE HTML ─────────────────────────────────────────────────
function buildTreeHTML(nodes, openSet, toggleFn) {
  toggleFn = toggleFn || '_scanToggle';
  let html = '';
  for (const node of nodes) {
    const indent      = 16 + node.depth * 20;
    const isFolder    = node.type === 'folder';
    const hasChildren = isFolder && node.children?.length > 0;
    const isOpen      = !openSet || openSet.has(node.path);
    const nodeHasErr  = !!node.error;
    const childHasErr = hasChildren && node.children.some(hasErr);
    let statusIco = '', rowCls = '', nameClr = '';
    if (isFolder) {
      if (nodeHasErr || childHasErr) { rowCls = 'tf has-err'; nameClr = 'color:var(--text);font-weight:700'; statusIco = isOpen ? '<svg class="ic si-warn" style="opacity:.35"><use href="#ic-warn"/></svg>' : '<svg class="ic si-warn"><use href="#ic-warn"/></svg>'; }
      else                           { rowCls = 'tf all-ok';  nameClr = 'color:var(--green);font-weight:700'; statusIco = '<svg class="ic si-ok"><use href="#ic-check-c"/></svg>'; }
    } else {
      if (nodeHasErr) { rowCls = 'tfile ferr'; nameClr = 'color:var(--red)';   statusIco = '<svg class="ic si-err"><use href="#ic-x-c"/></svg>'; }
      else            { rowCls = 'tfile';       nameClr = 'color:var(--text2)'; statusIco = '<svg class="ic si-ok"><use href="#ic-check-c"/></svg>'; }
    }
    const chevron   = isFolder ? '<svg class="ic" style="color:var(--text3);flex-shrink:0"><use href="#ic-' + (isOpen ? 'chev-d' : 'chev-r') + '"/></svg>' : '<span style="width:14px;flex-shrink:0;display:inline-block"></span>';
    const folderIco = isFolder ? '<svg class="ic16" style="color:' + (nodeHasErr || childHasErr ? 'var(--text)' : 'var(--green)') + '"><use href="#ic-' + (isOpen ? 'folder-o' : 'folder') + '"/></svg>' : '<svg class="ic" style="color:' + (nodeHasErr ? 'var(--red)' : 'var(--text3)') + '"><use href="#ic-file"/></svg>';
    const errPill   = nodeHasErr ? '<span class="tr-reason">' + escH(node.error) + '</span>' : '';
    const warnBadge = (isFolder && childHasErr && !nodeHasErr) ? '<span class="tr-badge" style="background:var(--orangel);color:var(--orange);border-color:var(--orangeb)">' + cntErr(node.children) + ' lỗi bên trong</span>' : '';
    const linkBtn   = node.link ? '<a href="' + node.link + '" target="_blank" style="color:var(--text3);flex-shrink:0;display:inline-flex"><svg class="ic"><use href="#ic-ext"/></svg></a>' : '';
    const clickAttr = isFolder && openSet ? 'onclick="window.' + toggleFn + '(\'' + node.path.replace(/'/g, "\\'") + '\')"' : '';
    html += '<div class="tr ' + rowCls + '" style="padding:7px 16px 7px ' + indent + 'px" ' + clickAttr + '>' + chevron + folderIco + '<span class="tr-name" style="' + nameClr + '">' + escH(node.name) + '</span>' + errPill + warnBadge + linkBtn + statusIco + '</div>';
    if (isFolder && (isOpen || !openSet) && hasChildren) html += buildTreeHTML(node.children, openSet, toggleFn);
  }
  return html;
}

function escH(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── SESSION ───────────────────────────────────────────────────
function saveSessionData(d) { localStorage.setItem(SK, JSON.stringify({ ...d, stats: st.stats, progDone: st.progDone, progTotal: st._progTotal, ts: Date.now() })); }
function saveSession()      { const s = getSession(); if (s) { s.stats = st.stats; s.progDone = st.progDone; s.progTotal = st._progTotal; s.ts = Date.now(); localStorage.setItem(SK, JSON.stringify(s)); } }
function getSession()       { try { return JSON.parse(localStorage.getItem(SK) || 'null'); } catch { return null; } }
function clearSession()     { localStorage.removeItem(SK); document.getElementById('resumeBanner').style.display = 'none'; }
function checkResume() {
  const s = getSession(); if (!s) return;
  if ((Date.now() - s.ts) / 1000 / 60 > 120) { clearSession(); return; }
  const b = document.getElementById('resumeBanner'); b.style.display = 'flex';
  document.getElementById('srcInput').value  = s.sv || '';
  document.getElementById('destInput').value = s.dv || '';
  if (s.sv) window.onInputChange('src');
  if (s.dv) window.onInputChange('dest');
}
window.resumeSession = async () => {
  const s = getSession(); if (!s) { clearSession(); return; }
  if (s.stats) { st.stats = s.stats; updStats(); document.getElementById('statsRow').style.display = 'grid'; }
  if (s.progDone) st.progDone = s.progDone;
  if (s.progTotal) st._progTotal = s.progTotal;
  document.getElementById('resumeBanner').style.display = 'none';
  addLog('Tiếp tục phiên cũ - chỉ sao chép các mục chưa hoàn thành...', 'info');
  await window.startCopy(true);
};
window.clearSession = clearSession;

async function saveHist(si, sn, di, dn, el) {
  try { await addDoc(collection(db, 'history'), { uid: st.gUser.uid, email: st.gUser.email, srcId: si, srcName: sn, destId: di, destName: dn, copied: st.stats.copied, failed: st.stats.failed, folders: st.stats.folders, elapsed: el, createdAt: serverTimestamp() }); }
  catch (e) { console.warn('saveHist', e); }
}

// ── COMPLETION MODAL ──────────────────────────────────────────
window.closeComplModal = () => {
  document.getElementById('complOv').classList.remove('on');
};
function showComplModal(elapsed, videoCount) {
  document.getElementById('complCopied').textContent  = st.stats.copied;
  document.getElementById('complFailed').textContent  = st.stats.failed;
  document.getElementById('complFolders').textContent = st.stats.folders;
  document.getElementById('complTime').textContent    = elapsed + 's';
  document.getElementById('complSub').textContent     = 'Hoàn thành trong ' + elapsed + 's';
  const vbox = document.getElementById('complVideoBox');
  if (videoCount > 0) { document.getElementById('complVideoCount').textContent = videoCount; vbox.style.display = 'block'; }
  else { vbox.style.display = 'none'; }
  document.getElementById('complOv').classList.add('on');
}

// ── MODAL ─────────────────────────────────────────────────────
window.openModal = (type) => {
  const cfgMap = {
    result:  { label: 'Kết quả sao chép', nodes: st.stats.folderList.length ? st.stats.folderList : [...st.stats.copiedFiles, ...st.stats.failedFiles] },
    failed:  { label: 'Lỗi',     nodes: st.stats.failedFiles },
    folders: { label: 'Thư mục', nodes: st.stats.folderList }
  };
  const cfg = cfgMap[type]; if (!cfg) return;
  _mOpen.clear();
  const firstFolder = cfg.nodes.find(n => n.type === 'folder');
  if (firstFolder) _mOpen.add(firstFolder.path);
  document.getElementById('modalTitle').innerHTML = '<span>' + cfg.label + '</span><span style="font-size:12px;background:#f1f3f5;color:#868e96;padding:2px 8px;border-radius:999px;font-family:monospace;margin-left:6px">' + cfg.nodes.length + '</span>';
  function rerender() { document.getElementById('modalBody').innerHTML = cfg.nodes.length === 0 ? '<p style="color:#868e96;text-align:center;padding:28px;font-size:13px">Không có mục nào.</p>' : buildTreeHTML(cfg.nodes, _mOpen, '_treeToggle'); }
  window._treeToggle = path => { _mOpen.has(path) ? _mOpen.delete(path) : _mOpen.add(path); rerender(); };
  rerender();
  document.getElementById('modalOv').classList.add('active');
};
window.closeModal = () => document.getElementById('modalOv').classList.remove('active');

// ── FREE PLAN ─────────────────────────────────────────────────
function updateFreeBanner() {
  const banner       = document.getElementById('freeBanner');
  const premiumBadge = document.getElementById('premiumBadge');
  if (!banner) return;
  if (st.gUserData?.plan === 'paid') {
    banner.style.display = 'none';
    if (premiumBadge) premiumBadge.style.display = 'flex';
    return;
  }
  if (premiumBadge) premiumBadge.style.display = 'none';
  if (!st.gUserData || st.gUserData.plan !== 'free') { banner.style.display = 'none'; return; }
  if (st.gUserData.upgradeRequestedAt) {
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#7a5a00;font-weight:700;flex:1;"><span>⏳</span><span>Gói Trọn đời — Đang chờ admin xác nhận thanh toán</span></div>
      <div style="font-size:11px;color:#adb5bd;font-weight:500;flex-shrink:0;">Sẽ được kích hoạt sau khi xác nhận</div>`;
    banner.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#fffbea;border:1.5px solid #ffd43b;border-radius:12px;padding:10px 16px;margin-bottom:12px;';
    return;
  }
  const usedMB   = st.gUserData.freeUsedMB || 0;
  const remainMB = Math.max(0, FREE_MB_LIMIT - usedMB).toFixed(0);
  const resetAt  = st.gUserData.freeResetAt?.toMillis ? st.gUserData.freeResetAt.toMillis() : Date.now();
  const resetStr = new Date(resetAt + FREE_RESET_MS).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#7a5a00;font-weight:700;"><span>⚡</span><span>Gói Miễn phí — Còn <b>${remainMB}</b> MB / 500 MB (reset lúc <b>${resetStr}</b>)</span></div>
    <button onclick="openUpgradeModal()" style="flex-shrink:0;background:#212529;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;">Nâng cấp lên Trọn đời →</button>`;
  banner.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#fffbea;border:1.5px solid #ffd43b;border-radius:12px;padding:10px 16px;margin-bottom:12px;';
}

async function checkFreeLimit() {
  if (!st.gUserData || st.gUserData.plan !== 'free') return true;
  const now     = Date.now();
  const resetAt = st.gUserData.freeResetAt?.toMillis ? st.gUserData.freeResetAt.toMillis() : 0;
  if (now - resetAt > FREE_RESET_MS) {
    try {
      await updateDoc(doc(db, 'users', st.gUser.uid), { freeUsedMB: 0, freeResetAt: serverTimestamp() });
      st.gUserData.freeUsedMB = 0;
      st.gUserData.freeResetAt = { toMillis: () => Date.now() };
      updateFreeBanner();
    } catch (e) { console.warn('checkFreeLimit reset', e); }
    return true;
  }
  if ((st.gUserData.freeUsedMB || 0) >= FREE_MB_LIMIT) { showFreeLimitModal(); return false; }
  return true;
}

async function updateFreeUsedMB() {
  if (!st.gUserData || st.gUserData.plan !== 'free' || !st.gUser) return;
  const newUsed = (st.gUserData.freeUsedMB || 0) + st._sessionCopiedMB;
  try {
    await updateDoc(doc(db, 'users', st.gUser.uid), { freeUsedMB: newUsed });
    st.gUserData.freeUsedMB = newUsed;
    updateFreeBanner();
  } catch (e) { console.warn('updateFreeUsedMB', e); }
}

function showFreeLimitModal() {
  const modal = document.getElementById('freeLimitModal');
  if (!modal) return;
  updateFreeLimitCountdown();
  modal.classList.add('active');
  if (st._freeLimitTimer) clearInterval(st._freeLimitTimer);
  st._freeLimitTimer = setInterval(updateFreeLimitCountdown, 1000);
}
window.closeFreeLimitModal = () => {
  const modal = document.getElementById('freeLimitModal');
  if (modal) modal.classList.remove('active');
  if (st._freeLimitTimer) { clearInterval(st._freeLimitTimer); st._freeLimitTimer = null; }
};
function updateFreeLimitCountdown() {
  if (!st.gUserData) return;
  const resetAt    = st.gUserData.freeResetAt?.toMillis ? st.gUserData.freeResetAt.toMillis() : Date.now();
  const remaining  = Math.max(0, resetAt + FREE_RESET_MS - Date.now());
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  const el = document.getElementById('freeLimitCountdown');
  if (el) el.textContent = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const elMB = document.getElementById('freeLimitUsedMB');
  if (elMB) elMB.textContent = Math.round(st.gUserData.freeUsedMB || 0);
  if (remaining === 0) {
    window.closeFreeLimitModal();
    st.gUserData.freeUsedMB = 0;
    updateFreeBanner();
    toast('Đã hết thời gian chờ — bạn có thể sao chép tiếp!', 'ok');
  }
}

// ── UI HELPERS ────────────────────────────────────────────────
function sec(name, _noPush) {
  if (!IS_DASHBOARD && !['land', 'maintenance'].includes(name)) {
    if (!_noPush) window.location.href = '/copy-drive';
    return;
  }
  if (IS_DASHBOARD && name === 'land' && !_noPush) { window.location.href = '/'; return; }
  ['land', 'pend', 'kicked', 'app', 'maintenance'].forEach(s => {
    const el = document.getElementById('s-' + s); if (el) el.style.display = s === name ? 'block' : 'none';
  });
  const nr = document.getElementById('navRight'); if (nr) nr.style.display = name === 'app' ? 'flex' : 'none';
  const ng = document.getElementById('navGuest'); if (ng) ng.style.display = name === 'app' ? 'none' : 'flex';
}

window.addEventListener('popstate', () => {
  if (!IS_DASHBOARD) { sec('land', true); return; }
  if (st.gUser) sec('app', true);
  else window.location.href = '/';
});

function setNavUser(u) {
  document.getElementById('navAv').src            = u.photoURL || '';
  document.getElementById('navName').textContent  = u.displayName || u.email;
  document.getElementById('navEmail').textContent = u.email;
}

function setBtnMode(mode) {
  st.runMode = mode;
  const bs  = document.getElementById('btnScan'),  bst  = document.getElementById('btnStart');
  const bsT = document.getElementById('btnScanTxt'), bstT = document.getElementById('btnStartTxt');
  const bp  = document.getElementById('btnPause'), br  = document.getElementById('btnResume');
  const bR  = document.getElementById('btnReset');
  bs.disabled = false; bst.disabled = false;
  if (mode === 'idle') {
    bs.className  = BTN_BASE.scan  + ' ' + BTN_STYLE.scanIdle;  bsT.textContent  = 'Kiểm tra trước';
    bst.className = BTN_BASE.start + ' ' + BTN_STYLE.startIdle; bstT.textContent = 'Bắt đầu sao chép';
    bp.style.display = 'none'; br.style.display = 'none'; bR.disabled = false; bR.style.opacity = '1';
  } else if (mode === 'scan') {
    bs.className  = BTN_BASE.scan  + ' ' + BTN_STYLE.scanScan;  bsT.textContent  = 'Dừng kiểm tra';
    bst.className = BTN_BASE.start + ' ' + BTN_STYLE.startIdle; bstT.textContent = 'Bắt đầu sao chép';
    bst.disabled = true; // Bug 1: khoá nút kia khi đang scan
    bp.style.display = 'block'; br.style.display = 'none'; bR.disabled = true; bR.style.opacity = '.4';
  } else if (mode === 'copy') {
    bs.className  = BTN_BASE.scan  + ' ' + BTN_STYLE.scanIdle;  bsT.textContent  = 'Kiểm tra trước';
    bs.disabled = true; // Bug 1: khoá nút kia khi đang copy
    bst.className = BTN_BASE.start + ' ' + BTN_STYLE.startCopy; bstT.textContent = 'Dừng sao chép';
    bp.style.display = 'block'; br.style.display = 'none'; bR.disabled = true; bR.style.opacity = '.4';
  }
}

let _pvLocal = 0, _pmLocal = 1;
function setProgress(v, max, state) {
  if (v !== null) _pvLocal = v; if (max !== null) _pmLocal = max;
  const f = document.getElementById('progFill');
  if (!f) return;
  f.parentElement.classList.remove('indeterminate');
  if (state === 'done')                          { f.style.width = '100%'; f.className = 'prog-fill done'; }
  else if (state === 'paused')                   { f.className = 'prog-fill paused'; }
  else if (state === 'scanning' || state === 'running') { _updateProgBar(); f.className = 'prog-fill ' + state; }
  else { f.style.width = (_pmLocal ? Math.round(_pvLocal / _pmLocal * 100) : 0) + '%'; if (state) f.className = 'prog-fill ' + state; }
}

function setStatus(msg) {
  document.getElementById('statusLbl').textContent    = msg;
  document.getElementById('actionStatus').textContent = msg;
}
window.setStatus = setStatus;

function addLog(msg, lv = 'ok') {
  const C = { ok: '#4ade80', err: '#f87171', info: '#93c5fd', skip: '#555', folder: '#c084fc', warn: '#fbbf24' };
  const I = { ok: '✓', err: '✗', info: '→', skip: '⏭', folder: '▣', warn: '⏸' };
  const b = document.getElementById('logBox');
  const d = document.createElement('div'); d.className = 'll';
  const ts = new Date().toLocaleTimeString('vi-VN');
  d.innerHTML = '<span class="ll-ts">' + ts + '</span><span class="ll-ic" style="color:' + (C[lv] || '#888') + '">' + (I[lv] || '·') + '</span><span class="ll-msg">' + escH(msg) + '</span>';
  b.appendChild(d); b.scrollTop = b.scrollHeight;
}

function updStats() {
  document.getElementById('sCopied').textContent  = st.stats.copied + st.stats.folders;
  document.getElementById('sFailed').textContent  = st.stats.failed;
  document.getElementById('sFolders').textContent = st.stats.topFolders;
}

function toast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast on ' + (type || '');
  setTimeout(() => t.classList.remove('on'), 3000);
}
window.toast = toast;
