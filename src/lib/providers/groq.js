const API_ROOT = 'https://api.groq.com/openai/v1';
export const GROQ_EMAIL_MODEL = 'llama-3.3-70b-versatile';

async function groqRequest(apiKey, path, init = {}) {
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
    const message = body?.error?.message || body?.message || `Groq request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export async function verifyGroqApiKey(apiKey) {
  return groqRequest(apiKey, '/models', {
    method: 'GET',
  });
}

export async function generateGroqChat(apiKey, {
  systemInstruction = '',
  prompt,
  temperature = 0.5,
} = {}) {
  const body = await groqRequest(apiKey, '/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: GROQ_EMAIL_MODEL,
      temperature,
      messages: [
        ...(systemInstruction
          ? [{ role: 'system', content: systemInstruction }]
          : []),
        { role: 'user', content: String(prompt || '').trim() },
      ],
    }),
  });

  return {
    body,
    text: body?.choices?.[0]?.message?.content?.trim() || '',
  };
}
