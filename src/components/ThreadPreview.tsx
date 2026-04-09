import { Download } from 'lucide-react';
import { buildEmailPreviewDocument } from '../lib/html';
import { formatAddresses, formatDateTime } from '../lib/format';
import type { ThreadDetail } from '../types';

interface ThreadPreviewProps {
  thread: ThreadDetail | null;
  onDownloadAttachment: (attachmentId: string) => void;
}

export function ThreadPreview({ thread, onDownloadAttachment }: ThreadPreviewProps) {
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
        {thread ? (
          thread.messages.map((message) => (
            <article key={message.id} className="message-card">
              <div className="message-meta-grid">
                <div>
                  <span className="meta-label">From</span>
                  <span className="meta-value">{formatAddresses(message.from_json ? [message.from_json] : [])}</span>
                </div>
                <div>
                  <span className="meta-label">To</span>
                  <span className="meta-value">{formatAddresses(message.to_json || [])}</span>
                </div>
                {message.cc_json?.length ? (
                  <div>
                    <span className="meta-label">Cc</span>
                    <span className="meta-value">{formatAddresses(message.cc_json)}</span>
                  </div>
                ) : null}
                <div>
                  <span className="meta-label">Date</span>
                  <span className="meta-value">{formatDateTime(message.sent_at || message.received_at || message.created_at)}</span>
                </div>
              </div>

              {String(message.html_body || '').trim() ? (
                <div className="html-preview-shell">
                  <iframe
                    title="HTML email preview"
                    className="html-preview-frame"
                    loading="lazy"
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                    srcDoc={buildEmailPreviewDocument(message.html_body || '')}
                  />
                </div>
              ) : (
                <div className="message-text-body">{message.text_body || message.snippet || '(no content)'}</div>
              )}

              {message.attachments?.length ? (
                <div className="attachment-list">
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
            </article>
          ))
        ) : (
          <div className="empty-card">Select a thread from the left to preview the full message.</div>
        )}
      </div>
    </section>
  );
}
