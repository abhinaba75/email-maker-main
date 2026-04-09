import { formatDateTime } from '../lib/format';
import type { AppController } from '../types';

interface DraftsViewProps {
  controller: AppController;
}

export function DraftsView({ controller }: DraftsViewProps) {
  return (
    <div className="view-stack">
      <section className="surface-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">Saved work</div>
            <h3>Drafts</h3>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>From</th>
                <th>Subject</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {controller.data.drafts.length ? controller.data.drafts.map((draft) => (
                <tr key={draft.id}>
                  <td>{draft.from_address}</td>
                  <td>{draft.subject || '(no subject)'}</td>
                  <td>{formatDateTime(draft.updated_at)}</td>
                  <td>
                    <button type="button" className="toolbar-button" onClick={() => void controller.openCompose(draft).catch(console.error)}>
                      Open
                    </button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={4}>No drafts available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
