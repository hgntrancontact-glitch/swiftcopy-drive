/* ══════════════ SHARED STATE — imported by app.js, auth.js, drive-api.js ══════════════ */

// ── Page detection ────────────────────────────────────────────
export const IS_DASHBOARD = !!document.getElementById('s-app');

// ── Shared constants ──────────────────────────────────────────
export const TRIAL_MB_LIMIT = 2048; // 2 GB — max size for a single trial copy session
export const FMIME = 'application/vnd.google-apps.folder';

// ── Stats factory ─────────────────────────────────────────────
export function ns() {
  return { copied:0, failed:0, folders:0, topFolders:0, copiedFiles:[], failedFiles:[], folderList:[], rootFiles:[] };
}

// ── Mutable state object ──────────────────────────────────────
// All files import the same object reference — mutations are visible everywhere.
export const st = {
  // Auth (written by auth.js, read by app.js)
  gUser: null, gToken: null, gUserData: null,
  _paymentContext: null, _loginMode: 'register',
  _kickPollTimer: null, _maintenancePromise: null,
  _authExpiredHandled: false, _resumeAfterReauth: null,
  _pendingPlanChoice: null,  // 'trial' | 'credit' | 'lifetime' | null — plan chosen from auto-popup before auth
  _planModalSource: null,    // 'auto' | null — 'auto' when the 30s timer opens planSelectModal

  // Execution control (read/written by app.js + drive-api.js)
  pauseFlag: false, stopFlag: false, runMode: 'idle',
  _pauseWaiters: [], abortCtrl: null,
  stats: null, // initialised below

  // Video semaphore (written by drive-api.js, drained on stop by app.js)
  _videoActive: 0, _videoWaiters: [], _videoTotalInRun: 0, _videoDownloadActive: 0,

  // Checklist (app.js only but declared here so doReset in app.js can clear cleanly)
  clItems: [], clLoaded: false, _deepScanId: 0, _totalDeepCount: 0,
  _dragActive: false, _dragCheckValue: null,

  // Copy session (app.js only)
  _freeLimitTimer: null,

  // Progress (app.js only)
  progDone: 0, _maxPct: 0, _progTotal: 0,

  _videoFilesCount: 0,

  // UI (app.js only)
  _previewTimers: { src: null, dest: null },
  _pv: 0, _pm: 1,

  // Cross-module callbacks — set by app.js at module init, called by auth.js + drive-api.js
  addLog: null,
  sec: null, toast: null, setNavUser: null,
  updateFreeBanner: null, checkResume: null, showNoAuth: null,
};
st.stats = ns();

// ── pausePoint — used by both drive-api.js and app.js ─────────
// Every concurrent caller queues its own resolver in _pauseWaiters instead of
// overwriting a single slot, so resume/stop can wake ALL paused workers at once
// (same pattern as the _videoWaiters semaphore below).
export function pausePoint() {
  return st.pauseFlag
    ? new Promise(r => { st._pauseWaiters.push(r); })
    : Promise.resolve();
}

// ── releasePauseWaiters — wake every worker currently blocked in pausePoint() ──
export function releasePauseWaiters() {
  while (st._pauseWaiters.length) st._pauseWaiters.shift()();
}
