const API_ROOT = 'https://api.cloudflare.com/client/v4';

async function cfRequest(token, path, init = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const message = body?.errors?.[0]?.message || `Cloudflare request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body.result ?? body;
}

export async function verifyCloudflareToken(token) {
  return cfRequest(token, '/user/tokens/verify');
}

export async function listZones(token) {
  const result = await cfRequest(token, '/zones?per_page=100');
  return Array.isArray(result) ? result : result.result || [];
}

export async function getEmailRouting(token, zoneId) {
  return cfRequest(token, `/zones/${zoneId}/email/routing`);
}

export async function enableEmailRouting(token, zoneId) {
  return cfRequest(token, `/zones/${zoneId}/email/routing/enable`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function listRoutingRules(token, zoneId) {
  const result = await cfRequest(token, `/zones/${zoneId}/email/routing/rules?per_page=100`);
  return Array.isArray(result) ? result : result.result || [];
}

export async function upsertRoutingRule(token, zoneId, ruleId, payload) {
  const method = ruleId ? 'PUT' : 'POST';
  const path = ruleId
    ? `/zones/${zoneId}/email/routing/rules/${ruleId}`
    : `/zones/${zoneId}/email/routing/rules`;
  return cfRequest(token, path, {
    method,
    body: JSON.stringify(payload),
  });
}

export async function deleteRoutingRule(token, zoneId, ruleId) {
  return cfRequest(token, `/zones/${zoneId}/email/routing/rules/${ruleId}`, {
    method: 'DELETE',
  });
}

export async function updateCatchAllRule(token, zoneId, payload) {
  return cfRequest(token, `/zones/${zoneId}/email/routing/rules/catch_all`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function listDestinationAddresses(token, accountId) {
  const result = await cfRequest(token, `/accounts/${accountId}/email/routing/addresses`);
  return Array.isArray(result) ? result : result.result || [];
}

export async function ensureDestinationAddress(token, accountId, email) {
  const existing = await listDestinationAddresses(token, accountId);
  const match = existing.find((item) => String(item.email).toLowerCase() === String(email).toLowerCase());
  if (match) return match;
  return cfRequest(token, `/accounts/${accountId}/email/routing/addresses`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

