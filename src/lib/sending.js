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

export function getWorkspaceSendingStatus({
  resendConnected,
  resendLookupFailed,
  sendEnabledDomains,
  matchedSendEnabledDomains,
  singleSendEnabledHostname,
  sendingDomainId,
}) {
  if (!resendConnected) {
    return 'Connect Resend to enable sending from one exact-match domain.';
  }
  if (resendLookupFailed) {
    return 'Unable to load Resend domains right now. Receiving still works, but sending is unavailable.';
  }
  if (!sendEnabledDomains.length) {
    return 'Resend has no send-enabled domains. Receiving still works, but sending is unavailable.';
  }
  if (!matchedSendEnabledDomains.length) {
    if (sendEnabledDomains.length === 1 && singleSendEnabledHostname && !sendingDomainId) {
      return `Send-enabled Resend domain ${singleSendEnabledHostname} does not exactly match any Cloudflare mail domain.`;
    }
    return 'None of the send-enabled Resend domains exactly matches a provisioned Cloudflare mail domain.';
  }
  if (matchedSendEnabledDomains.length > 1) {
    return 'Multiple send-enabled Resend domains match provisioned Cloudflare mail domains. Alias Forge requires exactly one matched sending domain.';
  }
  return null;
}

export function deriveSendingDomainPlan(domains, { resendConnected, resendDomains = [], resendLookupFailed = false } = {}) {
  const sendEnabledDomains = resendDomains.filter(isSendEnabledResendDomain);
  const provisionedHostnames = new Set(domains.map((domain) => normalizeHostname(domain.hostname)));
  const matchedSendEnabledDomains = sendEnabledDomains.filter((domain) => provisionedHostnames.has(getResendDomainHostname(domain)));
  const sendingHostname = matchedSendEnabledDomains.length === 1 ? getResendDomainHostname(matchedSendEnabledDomains[0]) : null;
  const singleSendEnabledHostname = sendEnabledDomains.length === 1 ? getResendDomainHostname(sendEnabledDomains[0]) : null;
  const resendByHostname = new Map(
    resendDomains
      .map((domain) => [getResendDomainHostname(domain), domain])
      .filter(([hostname]) => hostname),
  );

  let sendingDomainId = null;
  const domainPlans = domains.map((domain) => {
    const resendDomain = resendByHostname.get(normalizeHostname(domain.hostname)) || null;
    let sendCapability = SEND_CAPABILITY.UNAVAILABLE;
    if (sendEnabledDomains.length > 0 && matchedSendEnabledDomains.length === 0) {
      sendCapability = SEND_CAPABILITY.RECEIVE_ONLY;
    } else if (matchedSendEnabledDomains.length === 1) {
      sendCapability = normalizeHostname(domain.hostname) === sendingHostname
        ? SEND_CAPABILITY.ENABLED
        : SEND_CAPABILITY.RECEIVE_ONLY;
    } else if (matchedSendEnabledDomains.length > 1) {
      sendCapability = matchedSendEnabledDomains.some(
        (candidate) => getResendDomainHostname(candidate) === normalizeHostname(domain.hostname),
      )
        ? SEND_CAPABILITY.UNAVAILABLE
        : SEND_CAPABILITY.RECEIVE_ONLY;
    }

    const resendStatus = resendConnected
      ? (resendDomain ? getResendDomainStatus(resendDomain) : 'not_configured')
      : 'not_connected';
    const plan = {
      domainId: domain.id,
      resendDomainId: resendDomain?.id || null,
      resendStatus,
      sendCapability,
    };

    if (sendCapability === SEND_CAPABILITY.ENABLED) {
      sendingDomainId = domain.id;
    }
    return plan;
  });

  return {
    domainPlans,
    sendingDomainId,
    sendingStatusMessage: getWorkspaceSendingStatus({
      resendConnected,
      resendLookupFailed,
      sendEnabledDomains,
      matchedSendEnabledDomains,
      singleSendEnabledHostname,
      sendingDomainId,
    }),
  };
}
