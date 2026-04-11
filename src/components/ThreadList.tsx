import { Loader2, Star } from 'lucide-react';
import { formatDateTime } from '../lib/format';
import type { ThreadSummary } from '../types';

interface ThreadListProps {
  threads: ThreadSummary[];
  selectedThreadId?: string | null;
  mailboxLabel: string;
  folderLabel: string;
  emptyMessage: string;
  loading?: boolean;
  canLoadMore?: boolean;
  onSelect: (threadId: string) => void;
  onLoadMore: () => void;
}

export function ThreadList({
  threads,
  selectedThreadId,
  mailboxLabel,
  folderLabel,
  emptyMessage,
  loading,
  canLoadMore,
  onSelect,
  onLoadMore,
}: ThreadListProps) {
  return (
    <section className="mail-panel thread-panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">{folderLabel}</div>
          <div className="panel-caption">{mailboxLabel}</div>
        </div>
        <div className="panel-kicker">{threads.length} thread(s)</div>
      </div>

      <div className="thread-list">
        {loading && !threads.length ? (
          Array.from({ length: 5 }).map((_, index) => (
            <div key={`thread-skeleton-${index}`} className="thread-card skeleton-card">
              <div className="skeleton-line short" />
              <div className="skeleton-line medium" />
              <div className="skeleton-line long" />
            </div>
          ))
        ) : threads.length ? (
          threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className={`thread-card ${selectedThreadId === thread.id ? 'active' : ''}`}
              onClick={() => onSelect(thread.id)}
            >
              <div className="thread-card-head">
                <span className="thread-sender">
                  {thread.starred ? <Star size={14} className="thread-star" fill="currentColor" /> : null}
                  {thread.mailbox_email || thread.hostname || 'Mailbox'}
                </span>
                <span className="thread-time">{formatDateTime(thread.latest_message_at)}</span>
              </div>
              <div className={`thread-card-subject ${thread.unread_count ? 'unread' : ''}`}>{thread.subject || '(no subject)'}</div>
              <div className="thread-card-snippet">{thread.snippet || 'No preview available yet.'}</div>
            </button>
          ))
        ) : (
          <div className="empty-card">{emptyMessage}</div>
        )}
        {canLoadMore ? (
          <button type="button" className="load-more-button" onClick={onLoadMore}>
            {loading ? <Loader2 size={15} className="spin" /> : null}
            Load more
          </button>
        ) : null}
      </div>
    </section>
  );
}
