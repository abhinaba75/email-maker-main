import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveSendingDomainPlan, SEND_CAPABILITY } from '../src/lib/sending.js';

const domains = [
  { id: 'dom_one', hostname: 'mail.example.com' },
  { id: 'dom_two', hostname: 'inbound.example.net' },
];

test('deriveSendingDomainPlan marks all domains unavailable without a Resend connection', () => {
  const plan = deriveSendingDomainPlan(domains, {
    resendConnected: false,
    resendDomains: [],
  });

  assert.equal(plan.sendingDomainId, null);
  assert.equal(plan.sendingStatusMessage, 'Connect Resend to enable sending from one exact-match domain.');
  assert.deepEqual(
    plan.domainPlans.map((item) => ({ domainId: item.domainId, sendCapability: item.sendCapability, resendStatus: item.resendStatus })),
    [
      { domainId: 'dom_one', sendCapability: SEND_CAPABILITY.UNAVAILABLE, resendStatus: 'not_connected' },
      { domainId: 'dom_two', sendCapability: SEND_CAPABILITY.UNAVAILABLE, resendStatus: 'not_connected' },
    ],
  );
});

test('deriveSendingDomainPlan enables sending only on the exact matched verified domain', () => {
  const plan = deriveSendingDomainPlan(domains, {
    resendConnected: true,
    resendDomains: [
      { id: 'rsd_one', name: 'mail.example.com', status: 'not_started', capabilities: { sending: 'enabled' } },
    ],
  });

  assert.equal(plan.sendingDomainId, 'dom_one');
  assert.equal(plan.sendingStatusMessage, null);
  assert.deepEqual(
    plan.domainPlans.map((item) => ({ domainId: item.domainId, sendCapability: item.sendCapability, resendStatus: item.resendStatus })),
    [
      { domainId: 'dom_one', sendCapability: SEND_CAPABILITY.ENABLED, resendStatus: 'not_started' },
      { domainId: 'dom_two', sendCapability: SEND_CAPABILITY.RECEIVE_ONLY, resendStatus: 'not_configured' },
    ],
  );
});

test('deriveSendingDomainPlan leaves domains receive-only when the verified Resend domain does not match', () => {
  const plan = deriveSendingDomainPlan(domains, {
    resendConnected: true,
    resendDomains: [
      { id: 'rsd_other', name: 'sender.example.org', status: 'not_started', capabilities: { sending: 'enabled' } },
    ],
  });

  assert.equal(plan.sendingDomainId, null);
  assert.equal(
    plan.sendingStatusMessage,
    'Send-enabled Resend domain sender.example.org does not exactly match any Cloudflare mail domain.',
  );
  assert.deepEqual(
    plan.domainPlans.map((item) => item.sendCapability),
    [SEND_CAPABILITY.RECEIVE_ONLY, SEND_CAPABILITY.RECEIVE_ONLY],
  );
});

test('deriveSendingDomainPlan ignores unrelated send-enabled Resend domains when only one provisioned domain matches', () => {
  const plan = deriveSendingDomainPlan(domains, {
    resendConnected: true,
    resendDomains: [
      { id: 'rsd_one', name: 'mail.example.com', status: 'verified', capabilities: { sending: 'enabled' } },
      { id: 'rsd_unrelated', name: 'newsletter.example.org', status: 'verified', capabilities: { sending: 'enabled' } },
    ],
  });

  assert.equal(plan.sendingDomainId, 'dom_one');
  assert.equal(plan.sendingStatusMessage, null);
  assert.deepEqual(
    plan.domainPlans.map((item) => ({ domainId: item.domainId, sendCapability: item.sendCapability, resendStatus: item.resendStatus })),
    [
      { domainId: 'dom_one', sendCapability: SEND_CAPABILITY.ENABLED, resendStatus: 'verified' },
      { domainId: 'dom_two', sendCapability: SEND_CAPABILITY.RECEIVE_ONLY, resendStatus: 'not_configured' },
    ],
  );
});

test('deriveSendingDomainPlan disables sending when multiple send-enabled Resend domains match provisioned domains', () => {
  const plan = deriveSendingDomainPlan(domains, {
    resendConnected: true,
    resendDomains: [
      { id: 'rsd_one', name: 'mail.example.com', status: 'verified', capabilities: { sending: 'enabled' } },
      { id: 'rsd_two', name: 'inbound.example.net', status: 'verified', capabilities: { sending: 'enabled' } },
    ],
  });

  assert.equal(plan.sendingDomainId, null);
  assert.equal(
    plan.sendingStatusMessage,
    'Multiple send-enabled Resend domains match provisioned Cloudflare mail domains. Alias Forge requires exactly one matched sending domain.',
  );
  assert.deepEqual(
    plan.domainPlans.map((item) => item.sendCapability),
    [SEND_CAPABILITY.UNAVAILABLE, SEND_CAPABILITY.UNAVAILABLE],
  );
});
