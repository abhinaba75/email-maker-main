const API_ROOT = 'https://api.resend.com';

async function resendRequest(apiKey, path, init = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.message || body?.error || `Resend request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export async function verifyResendApiKey(apiKey) {
  return resendRequest(apiKey, '/domains');
}

export async function listResendDomains(apiKey) {
  const body = await resendRequest(apiKey, '/domains');
  return body.data || [];
}

export async function createResendDomain(apiKey, name) {
  return resendRequest(apiKey, '/domains', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function getResendDomain(apiKey, domainId) {
  return resendRequest(apiKey, `/domains/${domainId}`);
}

export async function sendResendEmail(apiKey, payload) {
  return resendRequest(apiKey, '/emails', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

