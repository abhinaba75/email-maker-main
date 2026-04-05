const ACTIONS = {
  compose: {
    label: 'AI Compose',
    selectionMode: false,
    instruction: 'Write a polished email draft from the supplied intent and context. Keep the result clear, useful, and ready to send.',
  },
  rewrite: {
    label: 'Rewrite',
    selectionMode: true,
    instruction: 'Rewrite the text for clarity and flow while preserving intent, important facts, and names.',
  },
  shorten: {
    label: 'Shorten',
    selectionMode: true,
    instruction: 'Make the text shorter and tighter without losing important meaning.',
  },
  expand: {
    label: 'Expand',
    selectionMode: true,
    instruction: 'Expand the text with a bit more detail, context, and smoother transitions.',
  },
  formalize: {
    label: 'Formalize',
    selectionMode: true,
    instruction: 'Adjust the tone to be more formal, professional, and business-appropriate.',
  },
  casualize: {
    label: 'Casualize',
    selectionMode: true,
    instruction: 'Adjust the tone to be more casual, warm, and conversational while staying respectful.',
  },
  proofread: {
    label: 'Fix Grammar',
    selectionMode: true,
    instruction: 'Proofread the text and fix grammar, spelling, punctuation, and awkward phrasing.',
  },
  summarize: {
    label: 'Summarize',
    selectionMode: true,
    instruction: 'Summarize the text into a concise version that preserves the main point and key actions.',
  },
};

export const TONE_PRESETS = {
  professional: {
    label: 'Professional',
    instruction: 'Use a polished professional tone suitable for business email.',
  },
  friendly: {
    label: 'Friendly',
    instruction: 'Use a warm, approachable, friendly tone without sounding casual or sloppy.',
  },
  formal: {
    label: 'Formal',
    instruction: 'Use a formal, respectful, businesslike tone.',
  },
  concise: {
    label: 'Concise',
    instruction: 'Keep the writing tight, direct, and economical.',
  },
  persuasive: {
    label: 'Persuasive',
    instruction: 'Use a confident, persuasive tone that clearly encourages the requested outcome.',
  },
  empathetic: {
    label: 'Empathetic',
    instruction: 'Use an understanding, calm, empathetic tone.',
  },
  confident: {
    label: 'Confident',
    instruction: 'Use a decisive, assured tone while staying professional.',
  },
  upbeat: {
    label: 'Upbeat',
    instruction: 'Use an energetic, positive, encouraging tone.',
  },
};

function normalizeLineEndings(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function stripHtmlLikeText(value) {
  return normalizeLineEndings(
    String(value || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  );
}

function extractJsonObject(text) {
  const candidate = String(text || '').trim();
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export function normalizeAiAction(action) {
  const normalized = String(action || '').trim().toLowerCase();
  return ACTIONS[normalized] ? normalized : null;
}

export function getAiActionDefinition(action) {
  const normalized = normalizeAiAction(action);
  return normalized ? ACTIONS[normalized] : null;
}

export function buildAiAssistRequest({
  action,
  prompt = '',
  tone = 'professional',
  outputMode = 'plain_text',
  subject = '',
  textBody = '',
  selectionText = '',
  to = [],
  cc = [],
  bcc = [],
}) {
  const normalizedAction = normalizeAiAction(action);
  if (!normalizedAction) {
    const error = new Error('Unsupported AI action.');
    error.status = 400;
    throw error;
  }

  const definition = ACTIONS[normalizedAction];
  const toneKey = TONE_PRESETS[String(tone || '').trim().toLowerCase()] ? String(tone).trim().toLowerCase() : 'professional';
  const tonePreset = TONE_PRESETS[toneKey];
  const cleanPrompt = normalizeLineEndings(prompt);
  const cleanSubject = normalizeLineEndings(subject);
  const cleanBody = normalizeLineEndings(textBody);
  const cleanSelection = normalizeLineEndings(selectionText);
  const normalizedOutputMode = outputMode === 'html_email' ? 'html_email' : 'plain_text';
  const useSelection = definition.selectionMode && Boolean(cleanSelection);

  if (normalizedAction === 'compose' && !cleanPrompt && !cleanBody && !cleanSubject) {
    const error = new Error('Describe what Gemini should compose first.');
    error.status = 400;
    throw error;
  }

  if (normalizedAction !== 'compose' && !cleanSelection && !cleanBody) {
    const error = new Error('Select some text or write a draft body first.');
    error.status = 400;
    throw error;
  }

  const responseShape = useSelection
    ? '{"replacementText":"string"}'
    : normalizedOutputMode === 'html_email'
      ? '{"subject":"string","htmlBody":"string","textBody":"string"}'
      : '{"subject":"string","textBody":"string"}';
  const targetText = useSelection ? cleanSelection : cleanBody;

  const promptSections = [
    `Action: ${definition.label}`,
    `Instruction: ${definition.instruction}`,
    `Tone preset: ${tonePreset.label}`,
    `Tone guidance: ${tonePreset.instruction}`,
    normalizedOutputMode === 'html_email'
      ? 'Output mode: HTML email. Return email-ready HTML markup when returning a full draft.'
      : 'Output mode: Plain text email draft.',
    cleanPrompt ? `User request:\n${cleanPrompt}` : '',
    cleanSubject ? `Current subject:\n${cleanSubject}` : '',
    to.length ? `To recipients:\n${to.map((item) => item?.email || item).filter(Boolean).join(', ')}` : '',
    cc.length ? `Cc recipients:\n${cc.map((item) => item?.email || item).filter(Boolean).join(', ')}` : '',
    bcc.length ? `Bcc recipients:\n${bcc.map((item) => item?.email || item).filter(Boolean).join(', ')}` : '',
    targetText ? `${useSelection ? 'Selected text' : 'Current body'}:\n${targetText}` : '',
    `Return JSON only in this shape: ${responseShape}`,
    useSelection
      ? 'Return only the rewritten replacement text in replacementText. Do not add commentary.'
      : normalizedOutputMode === 'html_email'
        ? 'Return a ready-to-send email subject, full HTML email body markup in htmlBody, and a text fallback in textBody. Do not add commentary.'
        : 'Return a ready-to-send email subject and body. Keep the body as plain text with normal line breaks. Do not add commentary.',
  ].filter(Boolean);

  return {
    action: normalizedAction,
    tone: toneKey,
    outputMode: normalizedOutputMode,
    useSelection,
    systemInstruction: 'You are a precise email writing assistant. Follow the requested transformation exactly and return machine-readable JSON only.',
    prompt: promptSections.join('\n\n'),
  };
}

export function parseAiAssistResult(text, {
  useSelection = false,
  outputMode = 'plain_text',
  fallbackSubject = '',
  fallbackText = '',
  fallbackHtml = '',
} = {}) {
  const parsed = extractJsonObject(text);
  if (useSelection) {
    return {
      replacementText: normalizeLineEndings(
        parsed?.replacementText
          || parsed?.textBody
          || parsed?.body
          || text,
      ),
    };
  }

  const normalizedOutputMode = outputMode === 'html_email' ? 'html_email' : 'plain_text';
  const fallbackHtmlBody = normalizedOutputMode === 'html_email'
    ? String(parsed?.htmlBody || text || fallbackHtml || '').trim()
    : '';
  return {
    subject: normalizeLineEndings(parsed?.subject || fallbackSubject),
    htmlBody: fallbackHtmlBody,
    textBody: normalizeLineEndings(
      parsed?.textBody
        || parsed?.body
        || (normalizedOutputMode === 'html_email' && parsed?.htmlBody ? stripHtmlLikeText(parsed.htmlBody) : '')
        || text
        || fallbackText,
    ),
  };
}
