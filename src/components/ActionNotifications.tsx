import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';

type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export interface UiNotice {
  id: number;
  message: string;
  tone: NoticeTone;
}

interface ActionNotificationsProps {
  activeNotice: Omit<UiNotice, 'id'> | null;
  toasts: UiNotice[];
  onDismiss: (id: number) => void;
}

function NoticeIcon({ tone, spinning = false }: { tone: NoticeTone; spinning?: boolean }) {
  if (spinning || tone === 'info') return <Loader2 size={16} className={spinning ? 'spin' : ''} />;
  if (tone === 'success') return <CheckCircle2 size={16} />;
  if (tone === 'warning') return <AlertTriangle size={16} />;
  return <CircleAlert size={16} />;
}

export function ActionNotifications({ activeNotice, toasts, onDismiss }: ActionNotificationsProps) {
  return (
    <div className="notification-layer" aria-live="polite" aria-atomic="true">
      <AnimatePresence>
        {activeNotice ? (
          <motion.div
            key={`active-${activeNotice.message}`}
            className={`activity-banner ${activeNotice.tone}`}
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
          >
            <NoticeIcon tone={activeNotice.tone} spinning />
            <span>{activeNotice.message}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="toast-stack">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.button
              key={toast.id}
              type="button"
              className={`toast-card ${toast.tone}`}
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 12, scale: 0.96 }}
              onClick={() => onDismiss(toast.id)}
            >
              <NoticeIcon tone={toast.tone} />
              <span>{toast.message}</span>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
