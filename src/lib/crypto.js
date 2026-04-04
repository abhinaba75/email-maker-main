const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(input) {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(secret) {
  let keyBytes;
  try {
    keyBytes = fromBase64(secret);
    if (keyBytes.byteLength !== 32) throw new Error('bad key length');
  } catch {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
    keyBytes = new Uint8Array(digest);
  }
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptText(secret, plainText) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(secret);
  const payload = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plainText));
  return `${toBase64(iv)}.${toBase64(payload)}`;
}

export async function decryptText(secret, encrypted) {
  const [ivPart, payloadPart] = String(encrypted || '').split('.');
  if (!ivPart || !payloadPart) return '';
  const iv = fromBase64(ivPart);
  const payload = fromBase64(payloadPart);
  const key = await deriveKey(secret);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, payload);
  return decoder.decode(plain);
}

export function maskSecret(secret) {
  if (!secret) return '';
  if (secret.length <= 8) return `${secret.slice(0, 2)}••••`;
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

