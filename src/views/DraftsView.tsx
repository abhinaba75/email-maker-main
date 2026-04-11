import { Trash2 } from 'lucide-react';
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
          {controller.data.drafts.length ? (
            <button
              type="button"
              className="toolbar-button danger"
              onClick={() => {
                if (window.confirm(`Delete all ${controller.data.drafts.length} drafts? This cannot be undone.`)) {
                  void controller.deleteAllDrafts().catch(console.error);
                }
              }}
            >
              <Trash2 size={15} />
              Delete all drafts
            </button>
          ) : null}
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
                    <div className="table-actions">
                      <button type="button" className="toolbar-button" onClick={() => void controller.openCompose(draft).catch(console.error)}>
                        Open
                      </button>
                      <button
                        type="button"
                        className="toolbar-button danger"
                        onClick={() => {
                          if (window.confirm(`Delete draft "${draft.subject || '(no subject)'}"?`)) {
                            void controller.deleteDraft(draft.id).catch(console.error);
                          }
                        }}
                      >
                        <Trash2 size={15} />
                        Delete draft
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={4}>No drafts available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {controller.cursors.drafts ? (
          <div className="table-load-more">
            <button type="button" className="toolbar-button" onClick={() => void controller.loadMoreDrafts().catch(console.error)}>
              Load more drafts
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
