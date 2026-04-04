import test from 'node:test';
import assert from 'node:assert/strict';

import { decryptText, encryptText } from '../src/lib/crypto.js';
import {
  buildCloudflareTargets,
  buildIngressAddress,
  normalizeDeliveryMode,
  normalizeSubject,
  slugifyLocalPart,
} from '../src/lib/mail.js';

test('normalizeSubject removes reply prefixes recursively', () => {
  assert.equal(normalizeSubject('Re: Fwd: RE: Status Update'), 'status update');
});

test('slugifyLocalPart converts arbitrary input to mail-safe local part', () => {
  assert.equal(slugifyLocalPart(' Sales Team / West '), 'sales.team.west');
});

test('normalizeDeliveryMode falls back to inbox_only', () => {
  assert.equal(normalizeDeliveryMode('bogus'), 'inbox_only');
});

test('buildCloudflareTargets preserves ingress for inbox delivery and deduplicates forwards', () => {
  const ingress = buildIngressAddress('alr_123', 'ingest.aliasforge.test');
  const targets = buildCloudflareTargets({
    mode: 'inbox_and_forward',
    ingressAddress: ingress,
    forwardAddresses: ['alice@example.com', 'alice@example.com', 'bob@example.com'],
  });
  assert.deepEqual(targets, [ingress, 'alice@example.com', 'bob@example.com']);
});

test('encryptText and decryptText round-trip values', async () => {
  const cipher = await encryptText('super-secret-passphrase', 'forge');
  const plain = await decryptText('super-secret-passphrase', cipher);
  assert.equal(plain, 'forge');
});
