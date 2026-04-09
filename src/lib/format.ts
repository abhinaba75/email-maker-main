import type {
  AddressEntry,
  AlertCounts,
  ComposeDraft,
  ConnectionSummary,
  DomainRecord,
  DraftRecord,
  MailboxRecord,
  UploadedAttachment,
} from '../types';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatAddresses(addresses?: AddressEntry[] | null): string {
  return (addresses || [])
    .filter((entry) => entry?.email)
    .map((entry) => (entry.name ? `${entry.name} <${entry.email}>` : entry.email))
    .join(', ');
}

export function parseInlineAddressList(value: string): AddressEntry[] {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.*?)<(.+?)>$/);
      if (match) {
        return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() };
      }
      return { email: part };
    });
}

export function getConnection(connections: ConnectionSummary[], provider: string): ConnectionSummary | null {
  return connections.find((connection) => connection.provider === provider) || null;
}

export function getDomain(domains: DomainRecord[], domainId?: string | null): DomainRecord | null {
  return domains.find((domain) => domain.id === domainId) || null;
}

export function getMailbox(mailboxes: MailboxRecord[], mailboxId?: string | null): MailboxRecord | null {
  return mailboxes.find((mailbox) => mailbox.id === mailboxId) || null;
}

export function getSendingDomain(domains: DomainRecord[], sendingDomainId?: string | null): DomainRecord | null {
  if (sendingDomainId) {
    return getDomain(domains, sendingDomainId);
  }
  return domains.find((domain) => (domain.sendCapability || domain.send_capability) === 'send_enabled') || null;
}

export function getSelectedSendingMailboxes(
  mailboxes: MailboxRecord[],
  selectedDomainId?: string | null,
): MailboxRecord[] {
  if (!selectedDomainId) return [];
  return mailboxes.filter((mailbox) => mailbox.domain_id === selectedDomainId);
}

export function getDefaultMailbox(mailboxes: MailboxRecord[]): MailboxRecord | null {
  return mailboxes.find((mailbox) => mailbox.is_default_sender) || mailboxes[0] || null;
}

export function formatSendCapability(capability?: string | null): string {
  if (capability === 'send_enabled') return 'Send enabled';
  if (capability === 'send_unavailable') return 'Send unavailable';
  return 'Receive only';
}

export function getSendingSummaryMessage(
  domains: DomainRecord[],
  sendingDomainId: string | null,
  selectedSendingDomainId: string | null,
  sendingStatusMessage: string | null,
): string {
  const sendingDomain = getSendingDomain(domains, sendingDomainId);
  if (sendingDomain) {
    return `Sending is enabled only on ${sendingDomain.hostname}. All other domains remain receive-only.`;
  }
  const selectedDomain = getDomain(domains, selectedSendingDomainId);
  if (selectedDomain && sendingStatusMessage) {
    return `${selectedDomain.hostname} is selected for sending, but outbound delivery is unavailable right now: ${sendingStatusMessage}`;
  }
  return sendingStatusMessage || 'Choose a sending domain to enable outbound mail.';
}

export function normalizeDraftRecord(draft: DraftRecord | Partial<ComposeDraft>): ComposeDraft {
  const candidate = draft as Partial<ComposeDraft> &
    Partial<{
      domain_id: string | null;
      mailbox_id: string | null;
      thread_id: string | null;
      from_address: string;
      to_json: AddressEntry[];
      cc_json: AddressEntry[];
      bcc_json: AddressEntry[];
      text_body: string;
      html_body: string;
      attachment_json: UploadedAttachment[];
    }>;
  return {
    id: draft.id || null,
    domainId: candidate.domainId || candidate.domain_id || null,
    mailboxId: candidate.mailboxId || candidate.mailbox_id || null,
    threadId: candidate.threadId || candidate.thread_id || null,
    fromAddress: candidate.fromAddress || candidate.from_address || '',
    to: candidate.to || candidate.to_json || [],
    cc: candidate.cc || candidate.cc_json || [],
    bcc: candidate.bcc || candidate.bcc_json || [],
    subject: draft.subject || '',
    textBody: candidate.textBody || candidate.text_body || '',
    htmlBody: candidate.htmlBody || candidate.html_body || '',
    attachments: candidate.attachments || candidate.attachment_json || [],
    editorMode: candidate.editorMode || 'rich',
    aiProvider: candidate.aiProvider || 'gemini',
    aiModel: candidate.aiModel || 'gemini-2.5-flash',
    aiTone: candidate.aiTone || 'professional',
    aiPrompt: candidate.aiPrompt || '',
    templateId: candidate.templateId || null,
  };
}

export function buildAlertSummary(alertCounts: AlertCounts): string | null {
  const alerts: string[] = [];
  if (alertCounts.routingDegraded) {
    alerts.push(`${alertCounts.routingDegraded} routing issue(s) need repair.`);
  }
  if (alertCounts.ingestFailures) {
    alerts.push(`${alertCounts.ingestFailures} inbound message(s) are quarantined.`);
  }
  return alerts.length ? alerts.join(' ') : null;
}
