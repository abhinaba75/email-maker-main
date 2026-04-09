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

function extractGeminiErrorMessage(responseBody) {
  const blockReason = responseBody?.promptFeedback?.blockReason;
  const finishReason = responseBody?.candidates?.[0]?.finishReason;
  const safetyMessage = responseBody?.promptFeedback?.safetyRatings
    ?.filter((item) => item?.blocked)
    ?.map((item) => item?.category)
    ?.filter(Boolean)
    ?.join(', ');

  if (blockReason) {
    return `Gemini blocked this request (${blockReason}${safetyMessage ? `: ${safetyMessage}` : ''}).`;
  }
  if (finishReason && finishReason !== 'STOP') {
    return `Gemini stopped without returning usable text (${finishReason}).`;
  }
  return 'Gemini returned an empty response.';
}

export async function generateGeminiContent(apiKey, {
  model = DEFAULT_GEMINI_MODEL,
  systemInstruction = '',
  prompt,
  temperature = 0.5,
  responseSchema = null,
} = {}) {
  const createBody = (mimeType = 'application/json', schema = responseSchema) => ({
    contents: [
      {
        role: 'user',
        parts: [{ text: String(prompt || '').trim() }],
      },
    ],
    generationConfig: {
      temperature,
      responseMimeType: mimeType,
      ...(schema ? { responseSchema: schema } : {}),
    },
  });

  const requestGenerateContent = async (body) => geminiRequest(
    apiKey,
    `/${normalizeModelName(model)}:generateContent`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...body,
        ...(systemInstruction
          ? {
              systemInstruction: {
                parts: [{ text: systemInstruction }],
              },
            }
          : {}),
      }),
    },
  );

  let primaryError = null;

  try {
    const responseBody = await requestGenerateContent(createBody('application/json', responseSchema));
    const text = extractGeminiText(responseBody);
    if (!text) {
      const error = new Error(extractGeminiErrorMessage(responseBody));
      error.status = 502;
      error.body = responseBody;
      throw error;
    }
    return {
      body: responseBody,
      text,
    };
  } catch (error) {
    primaryError = error;
  }

  const fallbackResponse = await requestGenerateContent(createBody('text/plain', null)).catch((fallbackError) => {
    throw primaryError || fallbackError;
  });
  const fallbackText = extractGeminiText(fallbackResponse);
  if (!fallbackText) {
    const error = new Error(extractGeminiErrorMessage(fallbackResponse));
    error.status = 502;
    error.body = fallbackResponse;
    throw primaryError || error;
  }

  return {
    body: fallbackResponse,
    text: fallbackText,
  };
}
