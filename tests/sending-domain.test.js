import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveSendingDomainPlan, SEND_CAPABILITY } from '../src/lib/sending.js';

const domains = [
  { id: 'dom_one', hostname: 'mail.example.com', resend_domain_id: 'rsd_one' },
  { id: 'dom_two', hostname: 'inbound.example.net', resend_domain_id: null },
];

test('deriveSendingDomainPlan leaves every domain receive-only when nothing is selected', () => {
  const plan = deriveSendingDomainPlan(domains, {
    selectedSendingDomainId: null,
    resendConnected: true,
  });

  assert.equal(plan.selectedSendingDomainId, null);
  assert.equal(plan.sendingDomainId, null);
  assert.equal(plan.sendingStatusMessage, 'Choose one provisioned domain to use for sending.');
  assert.deepEqual(
    plan.domainPlans.map((item) => ({ domainId: item.domainId, sendCapability: item.sendCapability })),
    [
      { domainId: 'dom_one', sendCapability: SEND_CAPABILITY.RECEIVE_ONLY },
      { domainId: 'dom_two', sendCapability: SEND_CAPABILITY.RECEIVE_ONLY },
    ],
  );
});

test('deriveSendingDomainPlan enables only the selected domain when Resend is connected', () => {
  const plan = deriveSendingDomainPlan(domains, {
    selectedSendingDomainId: 'dom_one',
    resendConnected: true,
  });

  assert.equal(plan.selectedSendingDomainId, 'dom_one');
  assert.equal(plan.sendingDomainId, 'dom_one');
  assert.equal(plan.sendingStatusMessage, null);
  assert.deepEqual(
    plan.domainPlans.map((item) => ({ domainId: item.domainId, sendCapability: item.sendCapability })),
    [
      { domainId: 'dom_one', sendCapability: SEND_CAPABILITY.ENABLED },
      { domainId: 'dom_two', sendCapability: SEND_CAPABILITY.RECEIVE_ONLY },
    ],
  );
});

test('deriveSendingDomainPlan marks the selected domain unavailable when Resend is missing', () => {
  const plan = deriveSendingDomainPlan(domains, {
    selectedSendingDomainId: 'dom_one',
    resendConnected: false,
  });

  assert.equal(plan.selectedSendingDomainId, 'dom_one');
  assert.equal(plan.sendingDomainId, null);
  assert.equal(plan.sendingStatusMessage, 'Connect Resend to send from mail.example.com.');
  assert.deepEqual(
    plan.domainPlans.map((item) => ({ domainId: item.domainId, sendCapability: item.sendCapability })),
    [
      { domainId: 'dom_one', sendCapability: SEND_CAPABILITY.UNAVAILABLE },
      { domainId: 'dom_two', sendCapability: SEND_CAPABILITY.RECEIVE_ONLY },
    ],
  );
});

test('deriveSendingDomainPlan ignores stale selected domains that no longer exist', () => {
  const plan = deriveSendingDomainPlan(domains, {
    selectedSendingDomainId: 'dom_missing',
    resendConnected: true,
  });

  assert.equal(plan.selectedSendingDomainId, null);
  assert.equal(plan.sendingDomainId, null);
  assert.equal(plan.sendingStatusMessage, 'Choose one provisioned domain to use for sending.');
  assert.deepEqual(
    plan.domainPlans.map((item) => item.sendCapability),
    [SEND_CAPABILITY.RECEIVE_ONLY, SEND_CAPABILITY.RECEIVE_ONLY],
  );
});
