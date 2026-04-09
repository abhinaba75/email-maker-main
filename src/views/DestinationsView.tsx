import { useState } from 'react';
import { getDomain } from '../lib/format';
import type { AppController } from '../types';

interface DestinationsViewProps {
  controller: AppController;
}

export function DestinationsView({ controller }: DestinationsViewProps) {
  const [form, setForm] = useState({
    domainId: controller.data.domains[0]?.id || '',
    email: '',
    displayName: '',
  });

  return (
    <div className="view-stack">
      <section className="surface-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">Forwarding</div>
            <h3>Add destination</h3>
          </div>
        </div>
        <form
          className="grid-form"
          onSubmit={(event) => {
            event.preventDefault();
            const domain = getDomain(controller.data.domains, form.domainId);
            void controller.saveForwardDestination({
              email: form.email,
              displayName: form.displayName,
              accountId: domain?.account_id || '',
            }).catch(console.error);
          }}
        >
          <label className="field">
            <span>Domain context</span>
            <select value={form.domainId} onChange={(event) => setForm((current) => ({ ...current, domainId: event.target.value }))}>
              {controller.data.domains.map((domain) => (
                <option key={domain.id} value={domain.id}>{domain.hostname}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Destination email</span>
            <input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="you@outlook.com" />
          </label>
          <label className="field span-2">
            <span>Display name</span>
            <input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="Primary inbox" />
          </label>
          <div className="span-2">
            <button type="submit" className="primary-button">Create destination</button>
          </div>
        </form>
      </section>

      <section className="surface-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">Known destinations</div>
            <h3>Forward destinations</h3>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Verification</th>
              </tr>
            </thead>
            <tbody>
              {controller.data.forwardDestinations.length ? controller.data.forwardDestinations.map((destination) => (
                <tr key={destination.id}>
                  <td>{destination.email}</td>
                  <td>{destination.display_name || ''}</td>
                  <td>{destination.verification_state || ''}</td>
                </tr>
              )) : (
                <tr><td colSpan={3}>No forward destinations configured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
