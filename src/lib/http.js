const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export function json(data, init = {}) {
  const headers = new Headers(JSON_HEADERS);
  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

export function apiError(status, message, details) {
  return json(
    {
      error: message,
      details: details ?? null,
    },
    { status },
  );
}

export async function readJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Expected application/json');
  }
  return request.json();
}

export function parseUrl(request) {
  return new URL(request.url);
}

export function parseBearerToken(request) {
  const raw = request.headers.get('authorization') || '';
  if (!raw.startsWith('Bearer ')) return null;
  return raw.slice('Bearer '.length).trim();
}

export async function maybeReadJson(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  return request.json();
}

