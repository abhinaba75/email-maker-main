import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { buildAlertSummary, getSendingSummaryMessage } from '../lib/format';
import type { AppController } from '../types';
import { SidebarNav } from './SidebarNav';
import { StatusFooter } from './StatusFooter';
import { TopHeader } from './TopHeader';

interface AppShellProps {
  controller: AppController;
  children: ReactNode;
}

export function AppShell({ controller, children }: AppShellProps) {
  const alertSummary = buildAlertSummary(controller.alertCounts);
  const headerSubtitle = controller.view === 'mail'
    ? getSendingSummaryMessage(
        controller.data.domains,
        controller.sendingDomainId,
        controller.selectedSendingDomainId,
        controller.sendingStatusMessage,
      )
    : alertSummary || controller.status;

  return (
    <div className="app-shell">
      <SidebarNav
        user={controller.user}
        domains={controller.data.domains}
        mailboxes={controller.data.mailboxes}
        activeView={controller.view}
        activeFolder={controller.folder}
        activeMailboxId={controller.mailboxId}
        threadCount={controller.threads.length}
        onNavigate={(target) => void controller.switchView(target).catch(console.error)}
        onMailboxOpen={(mailboxId) => void controller.openMailboxInbox(mailboxId).catch(console.error)}
        onSignOut={() => void controller.signOut().catch(console.error)}
      />

      <div className="app-stage">
        <TopHeader
          view={controller.view}
          searchQuery={controller.searchQuery}
          onSearchChange={controller.setSearchQuery}
          onSearchSubmit={() => void controller.runSearch().catch(console.error)}
          onCompose={() => void controller.openCompose().catch(console.error)}
          onReply={() => void controller.openReply().catch(console.error)}
          onForward={() => void controller.openForward().catch(console.error)}
          onArchive={() => void controller.archiveSelected().catch(console.error)}
          onTrash={() => void controller.trashSelected().catch(console.error)}
          onRefresh={() => void controller.refreshCurrentView().catch(console.error)}
          canActOnThread={Boolean(controller.selectedThread)}
          subtitle={headerSubtitle}
        />

        <main className="app-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={controller.view}
              className="app-view"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {alertSummary ? <div className="alert-banner">{alertSummary}</div> : null}
              {children}
            </motion.div>
          </AnimatePresence>
        </main>

        <StatusFooter
          status={controller.status}
          userEmail={controller.user?.email}
          currentView={controller.view === 'mail' ? controller.folder : controller.view}
          realtimeStatus={controller.realtimeStatus}
        />
      </div>
    </div>
  );
}
