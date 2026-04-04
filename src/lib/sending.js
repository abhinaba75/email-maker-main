export const SEND_CAPABILITY = {
  ENABLED: 'send_enabled',
  RECEIVE_ONLY: 'receive_only',
  UNAVAILABLE: 'send_unavailable',
};

export function normalizeHostname(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '');
}

export function getResendDomainHostname(domain) {
  return normalizeHostname(domain?.name || domain?.domain || domain?.hostname || '');
}

export function getResendDomainStatus(domain) {
  return String(domain?.status || domain?.data?.status || 'not_started');
}

export function isSendEnabledResendDomain(domain) {
  return String(domain?.capabilities?.sending || '').toLowerCase() === 'enabled';
}

export function getWorkspaceSendingStatus({ resendConnected, selectedDomain }) {
  if (!selectedDomain) {
    return resendConnected
      ? 'Choose one provisioned domain to use for sending.'
      : 'Connect Resend and choose one provisioned domain to enable sending.';
  }
  if (!resendConnected) {
    return `Connect Resend to send from ${selectedDomain.hostname}.`;
  }
  return null;
}

export function deriveSendingDomainPlan(domains, { selectedSendingDomainId = null, resendConnected = false } = {}) {
  const selectedDomain = domains.find((domain) => domain.id === selectedSendingDomainId) || null;
  const domainPlans = domains.map((domain) => ({
    domainId: domain.id,
    sendCapability: selectedDomain
      ? (domain.id === selectedDomain.id
        ? (resendConnected ? SEND_CAPABILITY.ENABLED : SEND_CAPABILITY.UNAVAILABLE)
        : SEND_CAPABILITY.RECEIVE_ONLY)
      : SEND_CAPABILITY.RECEIVE_ONLY,
  }));

  return {
    domainPlans,
    selectedSendingDomainId: selectedDomain?.id || null,
    sendingDomainId: resendConnected ? (selectedDomain?.id || null) : null,
    sendingStatusMessage: getWorkspaceSendingStatus({
      resendConnected,
      selectedDomain,
    }),
  };
}
