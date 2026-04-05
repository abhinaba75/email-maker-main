const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const GEMINI_FREE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

function normalizeModelName(model) {
  const raw = String(model || DEFAULT_GEMINI_MODEL).trim().replace(/^models\//, '');
  const normalized = GEMINI_FREE_MODELS.includes(raw) ? raw : DEFAULT_GEMINI_MODEL;
  if (!normalized) return DEFAULT_GEMINI_MODEL;
  return normalized.startsWith('models/') ? normalized : `models/${normalized}`;
}

async function geminiRequest(apiKey, path, init = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || body?.message || `Gemini request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export async function listGeminiModels(apiKey) {
  const body = await geminiRequest(apiKey, '/models', {
    method: 'GET',
  });
  return body.models || [];
}

export async function verifyGeminiApiKey(apiKey) {
  const models = await listGeminiModels(apiKey);
  return {
    models,
    modelCount: models.length,
  };
}

export function extractGeminiText(responseBody) {
  const parts = responseBody?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part?.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

export async function generateGeminiContent(apiKey, {
  model = DEFAULT_GEMINI_MODEL,
  systemInstruction = '',
  prompt,
  temperature = 0.5,
} = {}) {
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: String(prompt || '').trim() }],
      },
    ],
    generationConfig: {
      temperature,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = {
      role: 'system',
      parts: [{ text: systemInstruction }],
    };
  }

  const responseBody = await geminiRequest(
    apiKey,
    `/${normalizeModelName(model)}:generateContent`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );

  return {
    body: responseBody,
    text: extractGeminiText(responseBody),
  };
}
