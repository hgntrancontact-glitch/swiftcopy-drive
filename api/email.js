// Vercel serverless function — proxy email requests to GAS
// GAS_URL is stored in Vercel dashboard (Settings → Environment Variables)
// Never exposed to the browser or GitHub
module.exports = async function (req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
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
