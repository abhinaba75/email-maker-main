const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};

  const ENV_EMAIL    = process.env.FORGE_EMAIL;
  const ENV_PASSWORD = process.env.FORGE_PASSWORD;

  // Clear diagnostic error if env vars missing
  if (!ENV_EMAIL || !ENV_PASSWORD) {
    return res.status(500).json({
      error: 'ENV VARS NOT SET — add FORGE_EMAIL and FORGE_PASSWORD in Vercel project settings'
    });
  }

  if (email !== ENV_EMAIL || password !== ENV_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Build a simple signed token — secret falls back to a hash of the password if FORGE_SECRET not set
  const secret = process.env.FORGE_SECRET || crypto.createHash('sha256').update(ENV_PASSWORD).digest('hex');

  const payload = Buffer.from(JSON.stringify({
    email,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  })).toString('base64url');

  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const token = `${payload}.${sig}`;

  return res.status(200).json({ token });
};
