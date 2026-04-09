import { motion } from 'framer-motion';
import { formatDateTime } from '../lib/format';
import type { ThreadSummary } from '../types';

interface ThreadListProps {
  threads: ThreadSummary[];
  selectedThreadId?: string | null;
  mailboxLabel: string;
  folderLabel: string;
  emptyMessage: string;
  onSelect: (threadId: string) => void;
}

export function ThreadList({
  threads,
  selectedThreadId,
  mailboxLabel,
  folderLabel,
  emptyMessage,
  onSelect,
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
        {threads.length ? (
          threads.map((thread, index) => (
            <motion.button
              key={thread.id}
              type="button"
              className={`thread-card ${selectedThreadId === thread.id ? 'active' : ''}`}
              onClick={() => onSelect(thread.id)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.03, 0.24) }}
            >
              <div className="thread-card-head">
                <span className="thread-sender">{thread.mailbox_email || thread.hostname || 'Mailbox'}</span>
                <span className="thread-time">{formatDateTime(thread.latest_message_at)}</span>
              </div>
              <div className="thread-card-subject">{thread.subject || '(no subject)'}</div>
              <div className="thread-card-snippet">{thread.snippet || 'No preview available yet.'}</div>
            </motion.button>
          ))
        ) : (
          <div className="empty-card">{emptyMessage}</div>
        )}
      </div>
    </section>
  );
}
