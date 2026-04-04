const RE_PREFIX = /^(re|fw|fwd)\s*:\s*/i;

export const DELIVERY_MODES = ['inbox_only', 'forward_only', 'inbox_and_forward'];

export function now() {
  return Date.now();
}

export function createId(prefix = '') {
  return `${prefix}${crypto.randomUUID().replace(/-/g, '')}`;
}

export function normalizeDeliveryMode(input) {
  return DELIVERY_MODES.includes(input) ? input : 'inbox_only';
}

export function normalizeFolder(folder) {
  return ['inbox', 'sent', 'drafts', 'archive', 'trash'].includes(folder) ? folder : 'inbox';
}

export function normalizeSubject(subject) {
  let value = String(subject || '').trim();
  while (RE_PREFIX.test(value)) {
    value = value.replace(RE_PREFIX, '').trim();
  }
  return value.toLowerCase();
}

export function buildSnippet(textBody = '', htmlBody = '') {
  const source = String(textBody || htmlBody || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return source.slice(0, 180);
}

export function slugifyLocalPart(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._+-]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.');
}

export function uniqEmails(items) {
  const seen = new Set();
  return items.filter((item) => {
    const email = String(item || '').trim().toLowerCase();
    if (!email || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

export function buildIngressAddress(ruleId, ingestDomain) {
  return `ingress-${ruleId}@${ingestDomain}`;
}

export function buildCloudflareTargets({ mode, ingressAddress, forwardAddresses }) {
  const values = [];
  if (mode !== 'forward_only' && ingressAddress) {
    values.push(ingressAddress);
  }
  if (mode !== 'inbox_only') {
    values.push(...uniqEmails(forwardAddresses || []));
  }
  return uniqEmails(values);
}

export function parseAddressObject(input) {
  if (!input) return null;
  if (typeof input === 'string') {
    return { email: input.trim(), name: '' };
  }
  return {
    email: String(input.email || '').trim(),
    name: String(input.name || '').trim(),
  };
}

export function parseAddressList(items) {
  return (items || [])
    .map(parseAddressObject)
    .filter((item) => item && item.email);
}

export function findThreadFingerprint({ mailboxId, subject }) {
  return `${mailboxId || 'system'}:${normalizeSubject(subject)}`;
}

export function participantsFromMessage({ from, to, cc }) {
  const values = [from, ...(to || []), ...(cc || [])]
    .map((entry) => parseAddressObject(entry))
    .filter(Boolean);
  return values.map((entry) => entry.email || entry.name).filter(Boolean);
}

