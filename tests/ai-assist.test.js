import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAiAssistRequest, parseAiAssistResult } from '../src/lib/ai.js';

test('buildAiAssistRequest constrains compose to email HTML output when requested', () => {
  const request = buildAiAssistRequest({
    action: 'compose',
    tone: 'friendly',
    outputMode: 'html_email',
    prompt: 'Build a welcome email for new subscribers.',
    subject: '',
    textBody: '',
  });

  assert.equal(request.action, 'compose');
  assert.equal(request.outputMode, 'html_email');
  assert.equal(request.tone, 'friendly');
  assert.match(request.prompt, /Output mode: HTML email/i);
  assert.match(request.prompt, /Return a ready-to-send email subject, full HTML email body markup/i);
});

test('buildAiAssistRequest uses selection mode for rewrite actions when text is highlighted', () => {
  const request = buildAiAssistRequest({
    action: 'rewrite',
    textBody: 'Original body',
    selectionText: 'Tighten this paragraph.',
  });

  assert.equal(request.useSelection, true);
  assert.match(request.prompt, /Selected text:/i);
  assert.match(request.prompt, /replacementText/i);
});

test('parseAiAssistResult preserves raw HTML email output when model returns markup directly', () => {
  const result = parseAiAssistResult('<table><tr><td>Hello</td></tr></table>', {
    outputMode: 'html_email',
  });

  assert.equal(result.htmlBody, '<table><tr><td>Hello</td></tr></table>');
  assert.equal(result.textBody, 'Hello');
});

test('parseAiAssistResult unwraps fenced JSON payloads instead of leaking braces into compose', () => {
  const result = parseAiAssistResult('```json\n{\"subject\":\"Hello\",\"textBody\":\"Thanks for the update.\"}\n```');

  assert.equal(result.subject, 'Hello');
  assert.equal(result.textBody, 'Thanks for the update.');
});
