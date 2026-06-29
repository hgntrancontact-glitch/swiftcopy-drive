/* ══════════════ DRIVE API WRAPPERS ══════════════
   Imports: state.js only.
   Exports: dget, dpost, ddel, isAuthExpiredErr, fid, fname,
            listItems, existNames, mkFolder,
            isVideoItem, copyFileSingle, copyVideoReUpload, testFileCopy
   ══════════════════════════════════════════════ */
import { st, FMIME, pausePoint } from './state.js';

const BASE = 'https://www.googleapis.com/drive/v3';
const VIDEO_EXT  = /\.(mp4|mov|mkv|avi|wmv|flv|webm|m4v|mpg|mpeg|3gp|ts|m2ts)$/i;
const VIDEO_MIME = /^video\//;
const VIDEO_CONCUR = 6;  // max concurrent video download+reupload (memory safety)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hdr = () => ({ Authorization: 'Bearer ' + st.gToken, 'Content-Type': 'application/json' });

// ── Core HTTP helpers ─────────────────────────────────────────
export async function dget(path, p = {}) {
  if (!st.gToken) throw new Error('NO_TOKEN');
  const url = new URL(BASE + path);
  Object.entries(p).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, { headers: hdr(), signal: st.abortCtrl?.signal });
  if (r.status === 401) { const t = await r.text(); throw new Error('AUTH_EXPIRED: ' + t.slice(0, 80)); }
  if (!r.ok) { const t = await r.text(); throw new Error('Drive ' + r.status + ': ' + t.slice(0, 80)); }
  return r.json();
}

export async function dpost(path, body) {
  if (!st.gToken) throw new Error('NO_TOKEN');
  const r = await fetch(BASE + path, { method: 'POST', headers: hdr(), body: JSON.stringify(body), signal: st.abortCtrl?.signal });
  if (r.status === 401) { const t = await r.text(); throw new Error('AUTH_EXPIRED: ' + t.slice(0, 80)); }
  if (!r.ok) { const t = await r.text(); throw new Error('Drive ' + r.status + ': ' + t.slice(0, 80)); }
  return r.json();
}

export async function ddel(id) {
  try { await fetch(BASE + '/files/' + id + '?supportsAllDrives=true', { method: 'DELETE', headers: hdr() }); } catch {}
}

export function isAuthExpiredErr(e) {
  return e && typeof e.message === 'string' && e.message.startsWith('AUTH_EXPIRED');
}

// ── Folder/file helpers ───────────────────────────────────────
export function fid(s) {
  s = s.trim();
  let m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/); if (m) return m[1];
  m = s.match(/id=([a-zA-Z0-9_-]+)/); if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
  throw new Error('Không nhận diện được Folder ID: ' + s);
}

export async function fname(id) {
  try { return (await dget('/files/' + id, { fields: 'name', supportsAllDrives: true })).name; }
  catch (e) { if (isAuthExpiredErr(e)) throw e; return null; }
}

export async function listItems(folderId) {
  let res = [], pt = null;
  do {
    const p = {
      q: "'" + folderId + "' in parents and trashed=false",
      pageSize: 1000,
      fields: 'nextPageToken,files(id,name,mimeType,size)',
      orderBy: 'folder,name_natural',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    };
    if (pt) p.pageToken = pt;
    const r = await dget('/files', p);
    res.push(...(r.files || []));
    pt = r.nextPageToken;
  } while (pt);
  return res;
}

export async function existNames(folderId) {
  return new Set((await listItems(folderId)).map(i => i.name));
}

export async function mkFolder(name, parentId) {
  const r = await dget('/files', {
    q: "'" + parentId + "' in parents and name='" + name.replace(/'/g, "\\'") + "' and mimeType='" + FMIME + "' and trashed=false",
    fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true
  });
  if (r.files?.length) return r.files[0].id;
  return (await dpost('/files', { name, mimeType: FMIME, parents: [parentId] })).id;
}

// ── Video detection ───────────────────────────────────────────
export function isVideoItem(item) {
  if (item.mimeType && VIDEO_MIME.test(item.mimeType)) return true;
  if (item.name && VIDEO_EXT.test(item.name)) return true;
  return false;
}

// ── File copy — server-side for non-video, download+reupload for video ────
export async function copyFileSingle(item, destId) {
  if (isVideoItem(item)) return copyVideoReUpload(item, destId);
  for (let i = 0; i < 4; i++) {
    await pausePoint(); if (st.stopFlag) return { ok: false, reason: 'Đã dừng', sizeMB: 0 };
    try {
      const resp = await dpost('/files/' + item.id + '/copy?fields=id,size&supportsAllDrives=true', { parents: [destId] });
      return { ok: true, sizeMB: (parseInt(resp.size) || 0) / (1024 * 1024) };
    } catch (e) {
      if (e.name === 'AbortError') return { ok: false, reason: 'Đã dừng', sizeMB: 0 };
      if (isAuthExpiredErr(e)) throw e;
      const c = parseInt(e.message.match(/\d+/)?.[0] || '0');
      if ([429, 500, 503].includes(c)) { await sleep(Math.pow(2, i) * 500); continue; }
      if (c === 403) return { ok: false, reason: 'Không có quyền copy', sizeMB: 0 };
      if (c === 404) return { ok: false, reason: 'File không tìm thấy', sizeMB: 0 };
      return { ok: false, reason: e.message.slice(0, 60), sizeMB: 0 };
    }
  }
  return { ok: false, reason: 'Hết số lần thử', sizeMB: 0 };
}

export async function copyVideoReUpload(item, destId) {
  // Promise-based semaphore — waiter wakes instantly when a slot frees
  while (st._videoActive >= VIDEO_CONCUR) {
    if (st.stopFlag) return { ok: false, reason: 'Đã dừng', sizeMB: 0 };
    await new Promise(r => st._videoWaiters.push(r));
    if (st.stopFlag) return { ok: false, reason: 'Đã dừng', sizeMB: 0 };
  }
  st._videoActive++;
  try {
    st.addLog?.('Tải xuống+ghi video: ' + item.name, 'info');
    for (let attempt = 0; attempt < 4; attempt++) {
      await pausePoint(); if (st.stopFlag) return { ok: false, reason: 'Đã dừng', sizeMB: 0 };
      try {
        if (!st.gToken) throw new Error('NO_TOKEN');
        const dlRes = await fetch(BASE + '/files/' + item.id + '?alt=media&supportsAllDrives=true',
          { headers: { Authorization: 'Bearer ' + st.gToken }, signal: st.abortCtrl?.signal });
        if (dlRes.status === 401) throw new Error('AUTH_EXPIRED: video dl');
        if (!dlRes.ok) { const t = await dlRes.text(); throw new Error('Drive ' + dlRes.status + ': ' + t.slice(0, 80)); }
        const blob = await dlRes.blob();
        const mime = item.mimeType || 'application/octet-stream';
        const meta = JSON.stringify({ name: item.name, parents: [destId], mimeType: mime });
        const boundary = 'swiftcopy_vid_' + Date.now().toString(36);
        const CRLF = '\r\n';
        const upBody = new Blob([
          '--' + boundary + CRLF + 'Content-Type: application/json; charset=UTF-8' + CRLF + CRLF + meta + CRLF,
          '--' + boundary + CRLF + 'Content-Type: ' + mime + CRLF + CRLF,
          blob,
          CRLF + '--' + boundary + '--'
        ]);
        const upRes = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,size',
          { method: 'POST', headers: { Authorization: 'Bearer ' + st.gToken, 'Content-Type': 'multipart/related; boundary=' + boundary }, body: upBody, signal: st.abortCtrl?.signal });
        if (upRes.status === 401) throw new Error('AUTH_EXPIRED: video ul');
        if (!upRes.ok) { const t = await upRes.text(); throw new Error('Drive ' + upRes.status + ': ' + t.slice(0, 80)); }
        const resp = await upRes.json();
        return { ok: true, sizeMB: (parseInt(resp.size) || 0) / (1024 * 1024) };
      } catch (e) {
        if (e.name === 'AbortError') return { ok: false, reason: 'Đã dừng', sizeMB: 0 };
        if (isAuthExpiredErr(e)) throw e;
        const c = parseInt(e.message.match(/\d+/)?.[0] || '0');
        if ([429, 500, 503].includes(c)) { await sleep(Math.pow(2, attempt) * 500); continue; }
        if (c === 403) return { ok: false, reason: 'Không có quyền copy', sizeMB: 0 };
        if (c === 404) return { ok: false, reason: 'File không tìm thấy', sizeMB: 0 };
        return { ok: false, reason: e.message.slice(0, 60), sizeMB: 0 };
      }
    }
    return { ok: false, reason: 'Hết số lần thử', sizeMB: 0 };
  } finally {
    st._videoActive--;
    st._videoWaiters.shift()?.(); // wake next waiter immediately
  }
}

export async function testFileCopy(item, destId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await dpost('/files/' + item.id + '/copy', { name: '__swtest_' + item.name, parents: [destId] });
      await ddel(r.id);
      return null;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (isAuthExpiredErr(e)) throw e;
      const c = parseInt(e.message.match(/\d+/)?.[0] || '0');
      if ([429, 500, 503].includes(c)) { await sleep(Math.pow(2, attempt) * 500); continue; }
      return c === 403 ? 'Không có quyền copy' : 'Lỗi API ' + c;
    }
  }
  return 'Hết số lần thử';
}
