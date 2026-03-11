import crypto from 'crypto';

export function verifyToken(token) {
  try {
    const secret = process.env.FORGE_SECRET;
    if (!secret) return false;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64');
    if (expected !== sig) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64').toString());
    if (Date.now() > data.exp) return false;
    return true;
  } catch {
    return false;
  }
}
