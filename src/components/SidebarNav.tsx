import {
  Archive,
  ArrowRightLeft,
  AtSign,
  Box,
  Cog,
  FileText,
  Inbox,
  Mail,
  Send,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { SIDEBAR_GROUPS } from '../lib/constants';
import { getDomain } from '../lib/format';
import type { DomainRecord, MailboxRecord, UserSummary, ViewId, FolderId } from '../types';

const ICONS: Record<string, LucideIcon> = {
  'mail:inbox': Inbox,
  'mail:sent': Send,
  drafts: FileText,
  'mail:archive': Archive,
  'mail:trash': Trash2,
  connections: Sparkles,
  destinations: ArrowRightLeft,
  domains: Box,
  aliases: AtSign,
};

interface SidebarNavProps {
  user: UserSummary | null;
  domains: DomainRecord[];
  mailboxes: MailboxRecord[];
  activeView: ViewId;
  activeFolder: FolderId;
  activeMailboxId: string | null;
  threadCount: number;
  onNavigate: (target: string) => void;
  onMailboxOpen: (mailboxId: string) => void;
  onSignOut: () => void;
}

export function SidebarNav({
  user,
  domains,
  mailboxes,
  activeView,
  activeFolder,
  activeMailboxId,
  threadCount,
  onNavigate,
  onMailboxOpen,
  onSignOut,
}: SidebarNavProps) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-copy">
          <div className="brand-title">Email By Abhinaba Das</div>
          <div className="brand-subtitle">Inbox, domains, forwarding, templates, AI</div>
        </div>
      </div>

      <div className="sidebar-scroll">
        {SIDEBAR_GROUPS.map((group) => (
          <div key={group.group} className="sidebar-group">
            <div className="sidebar-group-label">{group.group}</div>
            <div className="sidebar-group-items">
              {group.items.map((item) => {
                const Icon = ICONS[item.id] || Mail;
                const isActive = item.id === activeView || item.id === `mail:${activeFolder}`;
                const badge = item.id === `mail:${activeFolder}` ? threadCount : null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => onNavigate(item.id)}
                  >
                    <span className="nav-icon">
                      <Icon size={18} strokeWidth={1.8} />
                    </span>
                    <span className="nav-copy">
                      <span className="nav-label">{item.label}</span>
                      <span className="nav-meta">{item.meta}</span>
                    </span>
                    {badge ? <span className="nav-count">{badge}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="sidebar-group">
          <div className="sidebar-group-label">Mailboxes</div>
          <div className="sidebar-group-items">
            {mailboxes.map((mailbox) => {
              const domain = getDomain(domains, mailbox.domain_id);
              return (
                <button
                  key={mailbox.id}
                  type="button"
                  className={`nav-item mailbox-item ${activeView === 'mail' && activeMailboxId === mailbox.id ? 'active' : ''}`}
                  onClick={() => onMailboxOpen(mailbox.id)}
                >
                  <span className="nav-icon">
                    <Inbox size={18} strokeWidth={1.8} />
                  </span>
                  <span className="nav-copy">
                    <span className="nav-label">{mailbox.email_address}</span>
                    <span className="nav-meta">{domain?.hostname || 'Mailbox'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="account-card">
        <div className="account-avatar">{(user?.display_name || user?.email || 'E').slice(0, 1).toUpperCase()}</div>
        <div className="account-copy">
          <div className="account-name">{user?.display_name || 'Not signed in'}</div>
          <div className="account-email">{user?.email || 'Sign in required'}</div>
        </div>
        {user ? (
          <button type="button" className="ghost-button" onClick={onSignOut} aria-label="Sign out">
            <Cog size={16} />
          </button>
        ) : null}
      </div>
    </aside>
  );
}
