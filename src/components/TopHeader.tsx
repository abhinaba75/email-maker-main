import { Archive, Forward, Plus, RefreshCcw, Reply, Search, Trash2 } from 'lucide-react';
import type { ViewId } from '../types';

interface TopHeaderProps {
  view: ViewId;
  mailTitle?: string;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onCompose: () => void;
  onReply: () => void;
  onForward: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onRefresh: () => void;
  canActOnThread: boolean;
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
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  onCompose,
  onReply,
  onForward,
  onArchive,
  onTrash,
  onRefresh,
  canActOnThread,
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
          <button type="button" className="toolbar-button" onClick={onArchive} disabled={!canActOnThread}>
            <Archive size={16} />
            Archive
          </button>
          <button type="button" className="toolbar-button" onClick={onTrash} disabled={!canActOnThread}>
            <Trash2 size={16} />
            Delete
          </button>
          <button type="button" className="toolbar-button" onClick={onRefresh}>
            <RefreshCcw size={16} />
            Refresh
          </button>
        </div>
      </div>
    </header>
  );
}
