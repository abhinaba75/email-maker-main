import { Wifi, WifiOff } from 'lucide-react';

interface StatusFooterProps {
  status: string;
  userEmail?: string | null;
  currentView: string;
  realtimeStatus: 'idle' | 'connecting' | 'connected' | 'reconnecting';
}

export function StatusFooter({ status, userEmail, currentView, realtimeStatus }: StatusFooterProps) {
  const connected = realtimeStatus === 'connected';
  return (
    <footer className="status-footer">
      <div className="status-pill-group">
        <div className="status-pill status-primary" title={status}>{status}</div>
        {userEmail ? <div className="status-pill subtle status-secondary" title={userEmail}>{userEmail}</div> : null}
        <div className="status-pill subtle status-tertiary">{currentView}</div>
        <div className={`status-pill ${connected ? 'good' : 'warning'}`}>
          {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          {connected ? 'Realtime connected' : realtimeStatus === 'reconnecting' ? 'Realtime reconnecting' : 'Realtime idle'}
        </div>
      </div>
      <div className="footer-credit">Thanks to Figma and Framer for UI designing tools :)</div>
    </footer>
  );
}
