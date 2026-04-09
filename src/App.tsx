import { useEffect, useRef, useState } from 'react';
import { ActionNotifications, type UiNotice } from './components/ActionNotifications';
import { motion } from 'framer-motion';
import { AppShell } from './components/AppShell';
import { ComposeModal } from './components/ComposeModal';
import { ThreadList } from './components/ThreadList';
import { ThreadPreview } from './components/ThreadPreview';
import { useAppController } from './hooks/useAppController';
import { getSelectedSendingMailboxes, getSendingDomain, getSendingSummaryMessage } from './lib/format';
import { AliasesView } from './views/AliasesView';
import { ConnectionsView } from './views/ConnectionsView';
import { DestinationsView } from './views/DestinationsView';
import { DomainsMailboxesView } from './views/DomainsMailboxesView';
import { DraftsView } from './views/DraftsView';

type NoticeTone = UiNotice['tone'];

function classifyStatus(status: string): { kind: 'ignore' | 'clear' | 'active' | 'toast'; tone?: NoticeTone; duration?: number } {
  const value = status.trim();
  if (!value) return { kind: 'ignore' };
  if (
    /^Ready(\.|$)/.test(value)
    || /^Workspace ready\.?$/.test(value)
    || /^Opened "/.test(value)
    || value === 'Sign in to continue.'
    || value === 'Ready for Google sign-in.'
  ) {
    return { kind: 'clear' };
  }
  if (
    /^(Sending|Saving|Deleting|Refreshing|Selecting|Repairing|Provisioning|Creating|Emptying|Updating|Loading)\b/i.test(value)
    || value.endsWith('...')
  ) {
    return { kind: 'active', tone: 'info' };
  }
  if (/New mail arrived/i.test(value)) {
    return { kind: 'toast', tone: 'warning', duration: 3800 };
  }
  if (/(failed|error|cannot|not allowed|invalid|missing|unsupported|denied|unavailable|not found)/i.test(value)) {
    return { kind: 'toast', tone: 'error', duration: 4600 };
  }
  if (/(sent\.|saved\.|deleted\.|created\.|updated\.|connected\.|finished\.|provisioned\.|refreshed\.|emptied\.)$/i.test(value)) {
    return { kind: 'toast', tone: 'success', duration: 2800 };
  }
  return { kind: 'toast', tone: 'info', duration: 2800 };
}

export default function App() {
  const controller = useAppController();
  const [activeNotice, setActiveNotice] = useState<Omit<UiNotice, 'id'> | null>(null);
  const [toasts, setToasts] = useState<UiNotice[]>([]);
  const lastStatusRef = useRef('');
  const mailboxFilter = controller.mailboxId
    ? controller.data.mailboxes.find((mailbox) => mailbox.id === controller.mailboxId)?.email_address
    : null;
  const emptyMessage = controller.data.domains.length
    ? `No messages in ${mailboxFilter || 'your inbox'} yet. Incoming mail will appear here as soon as the routing worker stores it.`
    : 'Add a domain, mailbox, and alias rule to start receiving mail here.';
  const selectedSendingMailboxes = getSelectedSendingMailboxes(controller.data.mailboxes, controller.selectedSendingDomainId);
  const sendingDomain = getSendingDomain(controller.data.domains, controller.sendingDomainId);

  useEffect(() => {
    const nextStatus = controller.status.trim();
    if (!nextStatus || nextStatus === lastStatusRef.current) return;
    lastStatusRef.current = nextStatus;

    const classification = classifyStatus(nextStatus);
    if (classification.kind === 'ignore') return;
    if (classification.kind === 'clear') {
      setActiveNotice(null);
      return;
    }
    if (classification.kind === 'active') {
      setActiveNotice({ message: nextStatus, tone: classification.tone || 'info' });
      return;
    }

    setActiveNotice(null);
    const notice = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      message: nextStatus,
      tone: classification.tone || 'info',
    };
    setToasts((current) => [...current.slice(-3), notice]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== notice.id));
    }, classification.duration || 2800);
  }, [controller.status]);

  return (
    <>
      <ActionNotifications
        activeNotice={activeNotice}
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
      />
      {controller.booting ? (
        <div className="boot-screen">
          <motion.div className="boot-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="boot-copy">
              <div className="eyebrow">Email By Abhinaba Das</div>
              <h1>Preparing your private mail workspace</h1>
              <p>Booting the inbox, domain routing, templates, forwarding, and compose tools.</p>
            </div>
            <div className="boot-progress"><span /></div>
          </motion.div>
        </div>
      ) : null}

      {!controller.user ? (
        <div className="login-shell">
          <motion.div className="login-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
            <div className="eyebrow">Email By Abhinaba Das</div>
            <h1>One workspace for inboxes, aliases, forwarding, templates, and AI composition.</h1>
            <p>
              Sign in with Google to manage every Cloudflare mailbox you run, preserve forwarding, and compose from your chosen
              sending domain with Gemini or Llama assistance.
            </p>
            <button type="button" className="primary-button login-button" onClick={() => void controller.signInWithGoogle().catch(console.error)}>
              Sign in with Google
            </button>
            <div className="helper-copy">{controller.loginMessage}</div>
          </motion.div>
        </div>
      ) : (
        <AppShell controller={controller}>
          {controller.view === 'mail' ? (
            <div className="mail-stage">
              <ThreadList
                threads={controller.threads}
                selectedThreadId={controller.selectedThread?.id}
                mailboxLabel={mailboxFilter || 'All mailboxes'}
                folderLabel={controller.folder.charAt(0).toUpperCase() + controller.folder.slice(1)}
                emptyMessage={emptyMessage}
                onSelect={(threadId) => void controller.selectThread(threadId).catch(console.error)}
              />
              <ThreadPreview
                thread={controller.selectedThread}
                onDownloadAttachment={(attachmentId) => void controller.downloadAttachment(attachmentId).catch(console.error)}
              />
            </div>
          ) : null}

          {controller.view === 'connections' ? <ConnectionsView controller={controller} /> : null}
          {controller.view === 'domains' ? <DomainsMailboxesView controller={controller} /> : null}
          {controller.view === 'aliases' ? <AliasesView controller={controller} /> : null}
          {controller.view === 'destinations' ? <DestinationsView controller={controller} /> : null}
          {controller.view === 'drafts' ? <DraftsView controller={controller} /> : null}
        </AppShell>
      )}

      <ComposeModal
        draft={controller.composeSeed}
        htmlTemplates={controller.data.htmlTemplates}
        connections={controller.data.connections}
        selectedSendingMailboxes={selectedSendingMailboxes}
        sendingDomainLabel={sendingDomain?.hostname || null}
        sendingSummaryMessage={getSendingSummaryMessage(
          controller.data.domains,
          controller.sendingDomainId,
          controller.selectedSendingDomainId,
          controller.sendingStatusMessage,
        )}
        onClose={controller.closeCompose}
        onSaveDraft={controller.saveComposeDraft}
        onSend={controller.sendCompose}
        onUploadAttachments={controller.uploadComposeAttachments}
        onAiAction={controller.runComposeAiAction}
      />
    </>
  );
}
