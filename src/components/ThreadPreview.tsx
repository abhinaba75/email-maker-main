import { Download } from 'lucide-react';
import { buildEmailPreviewDocument } from '../lib/html';
import { formatAddresses, formatDateTime } from '../lib/format';
import type { ThreadDetail } from '../types';

interface ThreadPreviewProps {
  thread: ThreadDetail | null;
  onDownloadAttachment: (attachmentId: string) => void;
}

export function ThreadPreview({ thread, onDownloadAttachment }: ThreadPreviewProps) {
  const message = thread?.messages?.[thread.messages.length - 1] || null;
  const hasHtmlBody = Boolean(String(message?.html_body || '').trim());

  return (
    <section className="mail-panel preview-panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">{thread?.subject || 'Preview'}</div>
          <div className="panel-caption">
            {thread ? `${thread.messages.length} message(s)` : 'Select a thread to read the conversation'}
          </div>
        </div>
      </div>

      <div className="preview-stack">
        {thread && message ? (
          <>
            <div className="preview-meta-bar">
              <div className="preview-meta-item">
                <span className="meta-label">From</span>
                <span className="meta-value">{formatAddresses(message.from_json ? [message.from_json] : [])}</span>
              </div>
              <div className="preview-meta-item">
                <span className="meta-label">To</span>
                <span className="meta-value">{formatAddresses(message.to_json || [])}</span>
              </div>
              {message.cc_json?.length ? (
                <div className="preview-meta-item">
                  <span className="meta-label">Cc</span>
                  <span className="meta-value">{formatAddresses(message.cc_json)}</span>
                </div>
              ) : null}
              <div className="preview-meta-item">
                <span className="meta-label">Date</span>
                <span className="meta-value">{formatDateTime(message.sent_at || message.received_at || message.created_at)}</span>
              </div>
            </div>

            {hasHtmlBody ? (
              <div className="preview-reading-stage preview-reading-stage-html">
                <div className="html-preview-shell">
                  <iframe
                    title="HTML email preview"
                    className="html-preview-frame"
                    loading="lazy"
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                    srcDoc={buildEmailPreviewDocument(message.html_body || '')}
                  />
                </div>
              </div>
            ) : (
              <div className="preview-reading-stage preview-reading-stage-text">
                <div className="message-text-body message-reading-surface">
                  {message.text_body || message.snippet || '(no content)'}
                </div>
              </div>
            )}

            {message.attachments?.length ? (
              <div className="attachment-list preview-attachments">
                {message.attachments.map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    className="attachment-pill"
                    onClick={() => onDownloadAttachment(attachment.id)}
                  >
                    <Download size={14} />
                    {attachment.fileName || attachment.file_name || 'attachment'}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty-card">Select a thread from the left to preview the full message.</div>
        )}
      </div>
    </section>
  );
}
