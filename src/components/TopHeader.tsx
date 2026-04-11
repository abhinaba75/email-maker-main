import { Archive, Forward, Mail, MailOpen, Plus, RefreshCcw, Reply, RotateCcw, Search, Star, Trash2 } from 'lucide-react';
import type { ViewId } from '../types';

interface TopHeaderProps {
  view: ViewId;
  mailTitle?: string;
  isTrashView?: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onCompose: () => void;
  onReply: () => void;
  onForward: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onTrash: () => void;
  onStar: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onEmptyTrash: () => void;
  onRefresh: () => void;
  canActOnThread: boolean;
  canEmptyTrash: boolean;
  canRestore: boolean;
  isThreadStarred: boolean;
  isThreadUnread: boolean;
  subtitle?: string | null;
}

const TITLES: Record<ViewId, string> = {
  mail: 'Inbox',
  connections: 'Connections',
  domains: 'Domains & Mailboxes',
  aliases: 'Aliases & Routing',
  destinations: 'Forwarding',
  drafts: 'Drafts',
};

export function TopHeader({
  view,
  mailTitle,
  isTrashView,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  onCompose,
  onReply,
  onForward,
  onArchive,
  onRestore,
  onTrash,
  onStar,
  onMarkRead,
  onMarkUnread,
  onEmptyTrash,
  onRefresh,
  canActOnThread,
  canEmptyTrash,
  canRestore,
  isThreadStarred,
  isThreadUnread,
  subtitle,
}: TopHeaderProps) {
  const title = view === 'mail' ? (mailTitle || 'Inbox') : TITLES[view];

  return (
    <header className="top-header">
      <div className="top-header-copy">
        <div className="eyebrow">Email workspace</div>
        <h1>{title}</h1>
        <p className="header-subtitle">{subtitle || '\u00a0'}</p>
      </div>

      <div className="top-header-actions">
        <div className="header-search">
          <Search size={16} />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSearchSubmit();
              }
            }}
            placeholder="Search mail"
          />
        </div>

        <div className="header-toolbar">
          <button type="button" className="primary-button" onClick={onCompose}>
            <Plus size={18} />
            New message
          </button>
          <button type="button" className="toolbar-button" onClick={onReply} disabled={!canActOnThread}>
            <Reply size={16} />
            Reply
          </button>
          <button type="button" className="toolbar-button" onClick={onForward} disabled={!canActOnThread}>
            <Forward size={16} />
            Forward
          </button>
          <button type="button" className="toolbar-button" onClick={onStar} disabled={!canActOnThread}>
            <Star size={16} />
            {isThreadStarred ? 'Unstar' : 'Star'}
          </button>
          <button
            type="button"
            className="toolbar-button"
            onClick={isThreadUnread ? onMarkRead : onMarkUnread}
            disabled={!canActOnThread}
          >
            {isThreadUnread ? <MailOpen size={16} /> : <Mail size={16} />}
            {isThreadUnread ? 'Mark read' : 'Mark unread'}
          </button>
          <button type="button" className="toolbar-button" onClick={onArchive} disabled={!canActOnThread}>
            <Archive size={16} />
            Archive
          </button>
          {canRestore ? (
            <button type="button" className="toolbar-button" onClick={onRestore} disabled={!canActOnThread}>
              <RotateCcw size={16} />
              Restore
            </button>
          ) : null}
          <button type="button" className="toolbar-button" onClick={onTrash} disabled={!canActOnThread}>
            <Trash2 size={16} />
            {isTrashView ? 'Delete forever' : 'Delete'}
          </button>
          {isTrashView ? (
            <button type="button" className="toolbar-button danger" onClick={onEmptyTrash} disabled={!canEmptyTrash}>
              <Trash2 size={16} />
              Empty trash
            </button>
          ) : null}
          <button type="button" className="toolbar-button" onClick={onRefresh}>
            <RefreshCcw size={16} />
            Refresh
          </button>
        </div>
      </div>
    </header>
  );
}
