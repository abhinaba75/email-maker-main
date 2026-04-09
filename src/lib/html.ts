import { escapeHtml } from './format';

export interface SanitizedFragment {
  styles: string;
  body: string;
}

export function stripHtmlToText(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = String(html || '');
  return (container.innerText || '').replace(/\u00a0/g, ' ').trim();
}

function preserveSpacesForHtml(text: string): string {
  return escapeHtml(text).replace(/(^ +| {2,})/g, (segment) => '&nbsp;'.repeat(segment.length));
}

export function textToComposeHtml(text: string): string {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) return '<p><br></p>';
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split('\n').map((line) => preserveSpacesForHtml(line)).join('<br>'));
  return `<p>${paragraphs.join('</p><p>')}</p>`;
}

export function sanitizeEmailPreviewFragment(html: string): SanitizedFragment {
  const source = String(html || '').trim();
  if (!source) return { styles: '', body: '' };
  try {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(source, 'text/html');
    documentNode
      .querySelectorAll('script, iframe, object, embed, form, input, button, textarea, select')
      .forEach((node) => node.remove());

    const styleMarkup = Array.from(documentNode.head?.querySelectorAll('style') || [])
      .map((node) => node.outerHTML)
      .join('');

    documentNode.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes || []).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = String(attribute.value || '');
        if (name.startsWith('on')) {
          node.removeAttribute(attribute.name);
          return;
        }
        if (['href', 'src', 'xlink:href', 'action', 'formaction'].includes(name) && /^\s*javascript:/i.test(value)) {
          node.removeAttribute(attribute.name);
        }
      });
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });

    return {
      styles: styleMarkup,
      body: documentNode.body?.innerHTML?.trim() || source,
    };
  } catch {
    return { styles: '', body: source };
  }
}

export function buildEmailPreviewDocument(html: string): string {
  const fragment = sanitizeEmailPreviewFragment(html);
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <base target="_blank">
    ${fragment.styles}
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff; }
      body { color: #111111; font: 14px/1.5 Arial, sans-serif; overflow-wrap: anywhere; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; }
      pre { white-space: pre-wrap; }
      blockquote { margin: 0 0 0 12px; padding-left: 12px; border-left: 2px solid #c5cede; }
      a { color: #0a4a7a; }
    </style>
  </head>
  <body>${fragment.body || '<div>(no content)</div>'}</body>
</html>`;
}

export function normalizeSignatureFragment(signature: string): SanitizedFragment {
  return sanitizeEmailPreviewFragment(signature || '<p><br></p>');
}

export function normalizeMarkupForCompare(markup: string): string {
  return String(markup || '')
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .trim()
    .toLowerCase();
}

export function appendSignatureToDocument(currentHtml: string, signature: string): string {
  const documentNode = document.implementation.createHTMLDocument('');
  const bodyMarkup = sanitizeEmailPreviewFragment(currentHtml).body || '<p><br></p>';
  documentNode.body.innerHTML = bodyMarkup;

  const signatureFragment = normalizeSignatureFragment(signature);
  const signatureMarkup = signatureFragment.body || '<p><br></p>';
  const normalizedSignature = normalizeMarkupForCompare(signatureMarkup);

  Array.from(documentNode.body.querySelectorAll('[data-signature-block="true"]')).forEach((node) => node.remove());

  const existingBlocks = Array.from(documentNode.body.children);
  const duplicate = existingBlocks.find((node) => normalizeMarkupForCompare(node.outerHTML) === normalizedSignature);
  if (duplicate) duplicate.remove();

  const container = documentNode.createElement('div');
  container.setAttribute('data-signature-block', 'true');
  container.innerHTML = signatureMarkup;
  documentNode.body.appendChild(container);

  return documentNode.body.innerHTML || '<p><br></p>';
}

export function serializeVisualHtml(styles: string, body: string): string {
  return `<!DOCTYPE html><html><head>${styles}</head><body>${body}</body></html>`;
}
