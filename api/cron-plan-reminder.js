// Vercel Cron Job — sends plan reminder emails to trial/credit users
// Schedule: daily at 13:00 UTC (20:00 VN time) — configured in vercel.json
// - trial users: reminder on day 1, 3, 7, 14 after trialLockedAt (if trialUsed=true)
// - credit users: reminder on day 1, 3 after creditsLockedAt (if creditsRemaining=0)
// Env vars required: FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, GAS_URL (optional)
const crypto = require('crypto');

const SITE_URL   = 'https://swiftcopydrive.vercel.app';
const PROJECT_ID = 'swiftcopy-drive';

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

async function sendEmail(gasUrl, payload) {
  if (!gasUrl) return;
  await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const gasUrl      = process.env.GAS_URL;

  if (!clientEmail || !privateKey) {
    console.log('[cron-plan-reminder] Env vars not set — skipping');
    return res.json({ ok: true, skipped: true });
  }

  try {
    const token = await getAccessToken(clientEmail, privateKey);
    const now = Date.now();

    // Query trial users with trialUsed=true (locked accounts)
    const trialResults = await firestoreQuery(token, {
      from: [{ collectionId: 'users' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'plan' }, op: 'EQUAL', value: { stringValue: 'trial' } } },
            { fieldFilter: { field: { fieldPath: 'trialUsed' }, op: 'EQUAL', value: { booleanValue: true } } }
          ]
        }
      },
      limit: 500
    });

    // Query credit users with creditsRemaining <= 0 (exhausted)
    const creditResults = await firestoreQuery(token, {
      from: [{ collectionId: 'users' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'plan' }, op: 'EQUAL', value: { stringValue: 'credit' } } },
            { fieldFilter: { field: { fieldPath: 'creditsRemaining' }, op: 'LESS_THAN_OR_EQUAL', value: { integerValue: 0 } } }
          ]
        }
      },
      limit: 500
    });

    let sent = 0, skipped = 0;
    const TRIAL_REMINDER_DAYS = [1, 3, 7, 14]; // days after trial lock
    const CREDIT_REMINDER_DAYS = [1, 3];        // days after credits exhausted

    // Process trial locked users
    for (const row of (Array.isArray(trialResults) ? trialResults : [])) {
      if (!row.document) continue;
      const fields = row.document.fields || {};
      const docId = row.document.name.split('/').pop();

      const status = fsVal(fields.status);
      if (status === 'kicked') { skipped++; continue; }

      const email       = fsVal(fields.email);
      const displayName = fsVal(fields.displayName) || email;
      const lockedTs    = fields.trialLockedAt?.timestampValue;
      if (!email || !lockedTs) { skipped++; continue; }

      const lockedMs   = new Date(lockedTs).getTime();
      const daysSince  = Math.floor((now - lockedMs) / 86400000);
      if (!TRIAL_REMINDER_DAYS.includes(daysSince)) { skipped++; continue; }

      const lastDay = parseInt(fsVal(fields.lastPlanReminderDay) || '0');
      if (lastDay === daysSince) { skipped++; continue; }

      try {
        await sendEmail(gasUrl, {
          type: 'trial_used_up_reminder',
          toEmail: email,
          userName: displayName,
          daysSince,
          siteUrl: SITE_URL
        });
        await firestorePatch(token, `users/${docId}`, { lastPlanReminderDay: daysSince });
        sent++;
      } catch (e) {
        console.error('[cron-plan-reminder] trial email error for', email, e.message);
        skipped++;
      }
    }

    // Process credit exhausted users
    for (const row of (Array.isArray(creditResults) ? creditResults : [])) {
      if (!row.document) continue;
      const fields = row.document.fields || {};
      const docId = row.document.name.split('/').pop();

      const status = fsVal(fields.status);
      if (status === 'kicked') { skipped++; continue; }

      const email       = fsVal(fields.email);
      const displayName = fsVal(fields.displayName) || email;
      const lockedTs    = fields.creditsLockedAt?.timestampValue;
      if (!email || !lockedTs) { skipped++; continue; }

      const lockedMs  = new Date(lockedTs).getTime();
      const daysSince = Math.floor((now - lockedMs) / 86400000);
      if (!CREDIT_REMINDER_DAYS.includes(daysSince)) { skipped++; continue; }

      const lastDay = parseInt(fsVal(fields.lastPlanReminderDay) || '0');
      if (lastDay === daysSince) { skipped++; continue; }

      try {
        await sendEmail(gasUrl, {
          type: 'credit_used_up_reminder',
          toEmail: email,
          userName: displayName,
          daysSince,
          siteUrl: SITE_URL
        });
        await firestorePatch(token, `users/${docId}`, { lastPlanReminderDay: daysSince });
        sent++;
      } catch (e) {
        console.error('[cron-plan-reminder] credit email error for', email, e.message);
        skipped++;
      }
    }

    console.log(`[cron-plan-reminder] done — sent: ${sent}, skipped: ${skipped}`);
    return res.json({ ok: true, sent, skipped });
  } catch (e) {
    console.error('[cron-plan-reminder]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
