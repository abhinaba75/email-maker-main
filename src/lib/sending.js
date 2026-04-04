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

export function isVerifiedResendDomain(domain) {
  return getResendDomainStatus(domain) === 'verified';
}

export function getWorkspaceSendingStatus({ resendConnected, resendLookupFailed, verifiedDomains, sendingHostname, sendingDomainId }) {
  if (!resendConnected) {
    return 'Connect Resend to enable sending from one exact-match domain.';
  }
  if (resendLookupFailed) {
    return 'Unable to load Resend domains right now. Receiving still works, but sending is unavailable.';
  }
  if (!verifiedDomains.length) {
    return 'Resend has no verified domains. Receiving still works, but sending is unavailable.';
  }
  if (verifiedDomains.length > 1) {
    return 'Resend has multiple verified domains. Alias Forge requires exactly one verified sending domain.';
  }
  if (sendingHostname && !sendingDomainId) {
    return `Verified Resend domain ${sendingHostname} does not exactly match any Cloudflare mail domain.`;
  }
  return null;
}

export function deriveSendingDomainPlan(domains, { resendConnected, resendDomains = [], resendLookupFailed = false } = {}) {
  const verifiedDomains = resendDomains.filter(isVerifiedResendDomain);
  const sendingHostname = verifiedDomains.length === 1 ? getResendDomainHostname(verifiedDomains[0]) : null;
  const resendByHostname = new Map(
    resendDomains
      .map((domain) => [getResendDomainHostname(domain), domain])
      .filter(([hostname]) => hostname),
  );

  let sendingDomainId = null;
  const domainPlans = domains.map((domain) => {
    const resendDomain = resendByHostname.get(normalizeHostname(domain.hostname)) || null;
    let sendCapability = SEND_CAPABILITY.UNAVAILABLE;
    if (verifiedDomains.length === 1) {
      sendCapability = normalizeHostname(domain.hostname) === sendingHostname
        ? SEND_CAPABILITY.ENABLED
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
      verifiedDomains,
      sendingHostname,
      sendingDomainId,
    }),
  };
}
