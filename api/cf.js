export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cf-token, x-cf-zone');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path } = req.query;
  if (!path) return res.status(400).json({ error: 'Missing path' });

  const token = req.headers['x-cf-token'];
  const zone  = req.headers['x-cf-zone'];
  if (!token || !zone) return res.status(400).json({ error: 'Missing x-cf-token or x-cf-zone headers' });

  const cfPath = Array.isArray(path) ? path.join('/') : path;
  const cfUrl  = `https://api.cloudflare.com/client/v4/zones/${zone}/${cfPath}`;

  try {
    const cfRes = await fetch(cfUrl, {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: ['POST','PUT','PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined,
    });
    const data = await cfRes.json();
    return res.status(cfRes.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
