import { parseBearerToken } from './http.js';

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const encoder = new TextEncoder();
const CLOCK_SKEW_SECONDS = 30;

let jwksCache = {
  keys: [],
  expiresAt: 0,
};

export function __resetJwksCacheForTests() {
  jwksCache = {
    keys: [],
    expiresAt: 0,
  };
}

function decodeBase64Url(input) {
  const base = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base.length % 4 === 0 ? '' : '='.repeat(4 - (base.length % 4));
  const binary = atob(base + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseJwt(token) {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) {
    throw new Error('Malformed token');
  }
  const parsedHeader = JSON.parse(new TextDecoder().decode(decodeBase64Url(header)));
  const parsedPayload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
  return {
    signingInput: `${header}.${payload}`,
    header: parsedHeader,
    payload: parsedPayload,
    signature: decodeBase64Url(signature),
  };
}

function parseMaxAge(value) {
  const match = String(value || '').match(/max-age=(\d+)/i);
  return match ? Number(match[1]) : 300;
}

async function getFirebaseJwks() {
  if (Date.now() < jwksCache.expiresAt && jwksCache.keys.length) {
    return jwksCache.keys;
  }
  const cache = caches.default;
  const cacheRequest = new Request(JWKS_URL, { method: 'GET' });
  const cached = await cache.match(cacheRequest);
  if (cached?.ok) {
    const body = await cached.json();
    jwksCache = {
      keys: body.keys || [],
      expiresAt: Date.now() + parseMaxAge(cached.headers.get('cache-control')) * 1000,
    };
    return jwksCache.keys;
  }

  const response = await fetch(JWKS_URL, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!response.ok) {
    throw new Error('Failed to fetch Firebase signing keys');
  }
  await cache.put(cacheRequest, response.clone());
  const body = await response.json();
  jwksCache = {
    keys: body.keys || [],
    expiresAt: Date.now() + parseMaxAge(response.headers.get('cache-control')) * 1000,
  };
  return jwksCache.keys;
}

async function verifySignature(token, jwk) {
  const { signingInput, signature } = parseJwt(token);
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    signature,
    encoder.encode(signingInput),
  );
}

export async function verifyFirebaseToken(token, env) {
  const projectId = env.FIREBASE_PROJECT_ID || env.PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Missing FIREBASE_PROJECT_ID');
  const parsed = parseJwt(token);
  const keys = await getFirebaseJwks();
  const jwk = keys.find((entry) => entry.kid === parsed.header.kid);
  if (!jwk) throw new Error('Unknown Firebase signing key');
  if (!(await verifySignature(token, jwk))) {
    throw new Error('Invalid Firebase signature');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (parsed.payload.aud !== projectId) throw new Error('Invalid Firebase audience');
  if (parsed.payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Invalid Firebase issuer');
  }
  if (!parsed.payload.sub) throw new Error('Missing Firebase subject');
  if (parsed.payload.exp <= nowSeconds - CLOCK_SKEW_SECONDS) throw new Error('Firebase token expired');
  if (parsed.payload.nbf && parsed.payload.nbf > nowSeconds + CLOCK_SKEW_SECONDS) {
    throw new Error('Firebase token is not active yet');
  }

  return {
    id: parsed.payload.user_id || parsed.payload.sub,
    email: parsed.payload.email || '',
    displayName: parsed.payload.name || parsed.payload.email || 'Google User',
    photoUrl: parsed.payload.picture || '',
  };
}

export async function requireUser(request, env) {
  const token = parseBearerToken(request);
  if (!token) throw new Error('Missing bearer token');
  return verifyFirebaseToken(token, env);
}
