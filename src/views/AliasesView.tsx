import { useState } from 'react';
import type { AppController } from '../types';

interface AliasesViewProps {
  controller: AppController;
}

export function AliasesView({ controller }: AliasesViewProps) {
  const [form, setForm] = useState({
    domainId: controller.data.domains[0]?.id || '',
    localPart: '',
    mailboxId: controller.data.mailboxes[0]?.id || '',
    mode: 'inbox_only',
    isCatchAll: false,
    forwardDestinationIds: [] as string[],
  });

  return (
    <div className="view-stack">
      <section className="surface-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">Routing rules</div>
            <h3>Create alias rule</h3>
          </div>
        </div>
        <form
          className="grid-form"
          onSubmit={(event) => {
            event.preventDefault();
            void controller.saveAliasRule(form).catch(console.error);
          }}
        >
          <label className="field">
            <span>Domain</span>
            <select value={form.domainId} onChange={(event) => setForm((current) => ({ ...current, domainId: event.target.value }))}>
              {controller.data.domains.map((domain) => (
                <option key={domain.id} value={domain.id}>{domain.hostname}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Local part</span>
            <input value={form.localPart} onChange={(event) => setForm((current) => ({ ...current, localPart: event.target.value }))} placeholder="newsletters" />
          </label>
          <label className="field">
            <span>Mailbox</span>
            <select value={form.mailboxId} onChange={(event) => setForm((current) => ({ ...current, mailboxId: event.target.value }))}>
              {controller.data.mailboxes.map((mailbox) => (
                <option key={mailbox.id} value={mailbox.id}>{mailbox.email_address}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Delivery mode</span>
            <select value={form.mode} onChange={(event) => setForm((current) => ({ ...current, mode: event.target.value }))}>
              <option value="inbox_only">Inbox only</option>
              <option value="forward_only">Forward only</option>
              <option value="inbox_and_forward">Inbox + forward</option>
            </select>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={form.isCatchAll} onChange={(event) => setForm((current) => ({ ...current, isCatchAll: event.target.checked }))} />
            <span>Catch-all rule</span>
          </label>
          <div className="field span-2">
            <span>Forward destinations</span>
            <div className="chip-selector">
              {controller.data.forwardDestinations.length ? controller.data.forwardDestinations.map((destination) => {
                const active = form.forwardDestinationIds.includes(destination.id);
                return (
                  <button
                    key={destination.id}
                    type="button"
                    className={`selector-chip ${active ? 'active' : ''}`}
                    onClick={() => setForm((current) => ({
                      ...current,
                      forwardDestinationIds: active
                        ? current.forwardDestinationIds.filter((id) => id !== destination.id)
                        : [...current.forwardDestinationIds, destination.id],
                    }))}
                  >
                    {destination.email}
                  </button>
                );
              }) : <div className="helper-copy">Add destinations first.</div>}
            </div>
          </div>
          <div className="span-2">
            <button type="submit" className="primary-button">Save rule</button>
          </div>
        </form>
      </section>

      <section className="surface-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">Current state</div>
            <h3>Alias rules</h3>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Alias</th>
                <th>Mode</th>
                <th>Mailbox</th>
                <th>Destinations</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {controller.data.aliases.length ? controller.data.aliases.map((alias) => (
                <tr key={alias.id}>
                  <td>{alias.is_catch_all ? `*@${alias.hostname}` : `${alias.local_part}@${alias.hostname}`}</td>
                  <td>{alias.mode}</td>
                  <td>{alias.mailbox_email || 'Forward only'}</td>
                  <td>{(alias.forward_destination_json || []).map((id) => controller.data.forwardDestinations.find((item) => item.id === id)?.email || id).join(', ')}</td>
                  <td>
                    <button type="button" className="toolbar-button danger" onClick={() => void controller.deleteAliasRule(alias.id).catch(console.error)}>
                      Delete
                    </button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={5}>No aliases configured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
