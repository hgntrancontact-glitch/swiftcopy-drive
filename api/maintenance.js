// Vercel serverless function — reads maintenance settings from Firestore using service account
// Bypasses Firestore Security Rules → works for both authenticated and unauthenticated users
// Env vars required: FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (from Firebase service account JSON)
const crypto = require('crypto');

function b64url(str) {
  return Buffer.from(str).toString('base64url');
}

async function getAccessToken(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail, sub: clientEmail,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore'
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const sig = signer.sign(privateKey).toString('base64url');
  const jwt = `${header}.${payload}.${sig}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const d = await r.json();
  return d.access_token;
}

module.exports = async function handler(req, res) {
  // Short cache — maintenance changes should propagate within ~15s
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    // Env vars not set — silently return off (maintenance feature disabled)
    return res.json({ mode: 'off', allowedEmails: [] });
  }

  try {
    const token = await getAccessToken(clientEmail, privateKey);
    const fsRes = await fetch(
      'https://firestore.googleapis.com/v1/projects/swiftcopy-drive/databases/(default)/documents/settings/maintenance',
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!fsRes.ok) return res.json({ mode: 'off', allowedEmails: [] });

    const { fields = {} } = await fsRes.json();
    const mode   = fields.mode?.stringValue || (fields.enabled?.booleanValue ? 'all' : 'off');
    const emails = (fields.allowedEmails?.arrayValue?.values || [])
      .map(v => v.stringValue).filter(Boolean);

    res.json({ mode, allowedEmails: emails });
  } catch (e) {
    console.error('[maintenance]', e.message);
    res.json({ mode: 'off', allowedEmails: [] });
  }
};
