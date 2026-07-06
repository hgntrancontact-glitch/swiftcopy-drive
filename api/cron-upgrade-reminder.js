// Vercel Cron Job — sends upgrade reminder emails to Free users every 3 days
// Schedule: daily at 13:00 UTC (20:00 VN time) — configured in vercel.json
// Env vars required: FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, GAS_URL (optional fallback)
const crypto = require('crypto');

const SITE_URL    = 'https://swiftcopydrive.vercel.app';
const PROJECT_ID  = 'swiftcopy-drive';

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
  if (!d.access_token) throw new Error('JWT exchange failed: ' + JSON.stringify(d));
  return d.access_token;
}

async function firestoreQuery(token, structuredQuery) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery })
  });
  return r.json();
}

async function firestorePatch(token, docPath, fields) {
  const fieldPaths = Object.keys(fields).join(',');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}?updateMask.fieldPaths=${fieldPaths}`;
  const body = { fields: {} };
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'number') body.fields[k] = { integerValue: v };
    else if (typeof v === 'string') body.fields[k] = { stringValue: v };
    else body.fields[k] = { nullValue: null };
  }
  await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function fsVal(field) {
  if (!field) return undefined;
  return field.stringValue ?? field.integerValue ?? field.booleanValue ?? field.timestampValue ?? null;
}

module.exports = async function handler(req, res) {
  // Only allow Vercel Cron (or manual GET for testing)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const gasUrl      = process.env.GAS_URL;

  if (!clientEmail || !privateKey) {
    console.log('[cron-upgrade-reminder] Env vars not set — skipping');
    return res.json({ ok: true, skipped: true });
  }

  try {
    const token = await getAccessToken(clientEmail, privateKey);
    const now = Date.now();

    // Query all users with plan='free' and status != 'kicked'
    const queryResult = await firestoreQuery(token, {
      from: [{ collectionId: 'users' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'plan' },
          op: 'EQUAL',
          value: { stringValue: 'free' }
        }
      },
      limit: 500
    });

    let sent = 0, skipped = 0;
    const results = Array.isArray(queryResult) ? queryResult : [];

    for (const row of results) {
      if (!row.document) continue;
      const fields = row.document.fields || {};
      const docName = row.document.name; // full resource path
      const docId = docName.split('/').pop();

      const status = fsVal(fields.status);
      if (status === 'kicked') { skipped++; continue; }

      const email       = fsVal(fields.email);
      const displayName = fsVal(fields.displayName) || email;
      const createdAtTs = fields.createdAt?.timestampValue;
      if (!email || !createdAtTs) { skipped++; continue; }

      const createdMs = new Date(createdAtTs).getTime();
      const daysSince = Math.floor((now - createdMs) / 86400000);

      // Must be > 0, multiple of 3, and <= 730 days (2 years)
      if (daysSince <= 0 || daysSince % 3 !== 0 || daysSince > 730) { skipped++; continue; }

      // Dedup: skip if already sent for this day
      const lastReminderDay = parseInt(fsVal(fields.lastReminderDay) || '0');
      if (lastReminderDay === daysSince) { skipped++; continue; }

      // Send email via /api/email proxy (same origin) or direct GAS if available
      if (gasUrl) {
        try {
          await fetch(gasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'upgrade_reminder', toEmail: email, userName: displayName, siteUrl: SITE_URL })
          });
        } catch (emailErr) {
          console.error('[cron-upgrade-reminder] email error for', email, emailErr.message);
          skipped++;
          continue;
        }
      } else {
        console.log('[cron-upgrade-reminder] GAS_URL not set — would send to', email);
      }

      // Mark sent for today
      const docPath = `users/${docId}`;
      await firestorePatch(token, docPath, { lastReminderDay: daysSince });
      sent++;
    }

    console.log(`[cron-upgrade-reminder] done — sent: ${sent}, skipped: ${skipped}`);
    return res.json({ ok: true, sent, skipped });
  } catch (e) {
    console.error('[cron-upgrade-reminder]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
