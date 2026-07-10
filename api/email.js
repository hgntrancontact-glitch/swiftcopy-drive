// Vercel serverless function — proxy email requests to GAS
// GAS_URL is stored in Vercel dashboard (Settings → Environment Variables)
// Never exposed to the browser or GitHub
//
// Auth: caller must present a valid Firebase ID token (Authorization: Bearer <token>).
// Recipient restriction: every email-looking value found in the payload must be
// either the caller's own verified email or ADMIN_EMAIL — unless the caller IS
// admin, who may target anyone. Prevents anonymous/bot abuse of this endpoint
// to blast arbitrary third-party addresses using our GAS quota + brand.
const crypto = require('crypto');

const PROJECT_ID  = 'swiftcopy-drive';
const ADMIN_EMAIL = 'hgntran.contact@gmail.com';
const EMAIL_RE     = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let _certsCache = null, _certsCacheExp = 0;

function b64urlToBuf(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function getGoogleCerts() {
  if (_certsCache && Date.now() < _certsCacheExp) return _certsCache;
  const r = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  const certs = await r.json();
  _certsCache = certs;
  _certsCacheExp = Date.now() + 30 * 60 * 1000; // cache 30 phút
  return certs;
}

// Verify a Firebase Auth ID token without the firebase-admin SDK (no npm deps,
// giữ đúng phong cách các file api/* khác — chỉ dùng crypto module có sẵn).
async function verifyFirebaseIdToken(idToken) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [headerB64, payloadB64, sigB64] = parts;
  const header  = JSON.parse(b64urlToBuf(headerB64).toString('utf8'));
  const payload = JSON.parse(b64urlToBuf(payloadB64).toString('utf8'));

  const certs = await getGoogleCerts();
  const certPem = certs[header.kid];
  if (!certPem) throw new Error('unknown key id');

  const publicKey = crypto.createPublicKey(certPem);
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  if (!verifier.verify(publicKey, b64urlToBuf(sigB64))) throw new Error('invalid signature');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('token expired');
  if (payload.iat > now + 60) throw new Error('token issued in future');
  if (payload.aud !== PROJECT_ID) throw new Error('wrong audience');
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) throw new Error('wrong issuer');
  if (!payload.sub) throw new Error('missing sub');

  return payload; // payload.email, payload.sub (uid)...
}

function collectEmailLikeValues(obj, out) {
  for (const v of Object.values(obj || {})) {
    if (typeof v === 'string' && EMAIL_RE.test(v)) out.push(v.toLowerCase());
    else if (v && typeof v === 'object') collectEmailLikeValues(v, out);
  }
  return out;
}

module.exports = async function (req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) { res.status(401).json({ ok: false, error: 'missing token' }); return; }

  let claims;
  try {
    claims = await verifyFirebaseIdToken(idToken);
  } catch (e) {
    res.status(401).json({ ok: false, error: 'invalid token' });
    return;
  }

  const callerEmail   = (claims.email || '').toLowerCase();
  const isAdminCaller = callerEmail === ADMIN_EMAIL.toLowerCase();

  if (!isAdminCaller) {
    const targets = collectEmailLikeValues(req.body, []);
    const allowed = targets.every(e => e === callerEmail || e === ADMIN_EMAIL.toLowerCase());
    if (!allowed) { res.status(403).json({ ok: false, error: 'recipient not allowed' }); return; }
  }

  const GAS_URL = process.env.GAS_URL;
  if (!GAS_URL) { res.status(200).json({ ok: true }); return; }
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(req.body),
      redirect: 'follow',
    });
  } catch (_) { /* best-effort — email là phụ, không để crash request */ }
  res.status(200).json({ ok: true });
};
