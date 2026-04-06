import test from 'node:test';
import assert from 'node:assert/strict';
import { __resetJwksCacheForTests, verifyFirebaseToken } from '../src/lib/auth.js';

function encodeBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function createSignedJwt(payloadOverrides = {}) {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const kid = crypto.randomUUID();
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = encodeBase64Url(JSON.stringify({
    aud: 'email-maker-forge-ad61',
    iss: 'https://securetoken.google.com/email-maker-forge-ad61',
    sub: 'user-123',
    user_id: 'user-123',
    email: 'user@example.com',
    name: 'Example User',
    exp: now + 300,
    nbf: now - 10,
    ...payloadOverrides,
  }));
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  const token = `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
  return { token, jwk };
}

function installJwksMocks(jwk) {
  __resetJwksCacheForTests();
  const cache = new Map();
  globalThis.caches = {
    default: {
      async match(request) {
        return cache.get(request.url) || null;
      },
      async put(request, response) {
        cache.set(request.url, response.clone());
      },
    },
  };
  globalThis.fetch = async () => new Response(
    JSON.stringify({ keys: [jwk] }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=300',
      },
    },
  );
}

test('verifyFirebaseToken accepts a valid token', async () => {
  const { token, jwk } = await createSignedJwt();
  installJwksMocks(jwk);

  const user = await verifyFirebaseToken(token, {
    FIREBASE_PROJECT_ID: 'email-maker-forge-ad61',
  });

  assert.equal(user.id, 'user-123');
  assert.equal(user.email, 'user@example.com');
});

test('verifyFirebaseToken rejects tokens with a future nbf claim', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { token, jwk } = await createSignedJwt({
    nbf: now + 600,
  });
  installJwksMocks(jwk);

  await assert.rejects(
    () => verifyFirebaseToken(token, { FIREBASE_PROJECT_ID: 'email-maker-forge-ad61' }),
    /not active yet/i,
  );
});

test('verifyFirebaseToken rejects expired tokens', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { token, jwk } = await createSignedJwt({
    exp: now - 600,
  });
  installJwksMocks(jwk);

  await assert.rejects(
    () => verifyFirebaseToken(token, { FIREBASE_PROJECT_ID: 'email-maker-forge-ad61' }),
    /expired/i,
  );
});
