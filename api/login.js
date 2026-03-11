import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  const ENV_EMAIL    = process.env.FORGE_EMAIL;
  const ENV_PASSWORD = process.env.FORGE_PASSWORD;
  const ENV_SECRET   = process.env.FORGE_SECRET;

  if (!ENV_EMAIL || !ENV_PASSWORD || !ENV_SECRET) {
    return res.status(500).json({ error: 'Server not configured — set FORGE_EMAIL, FORGE_PASSWORD, FORGE_SECRET in Vercel env vars.' });
  }

  const emailMatch    = email === ENV_EMAIL;
  const passwordMatch = password === ENV_PASSWORD;

  if (!emailMatch || !passwordMatch) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Create signed token: base64(payload).base64(hmac)
  const payload = Buffer.from(JSON.stringify({
    email,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
  })).toString('base64');

  const sig = crypto
    .createHmac('sha256', ENV_SECRET)
    .update(payload)
    .digest('base64');

  const token = `${payload}.${sig}`;
  return res.status(200).json({ token });
}
