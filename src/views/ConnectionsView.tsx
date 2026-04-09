import { useState } from 'react';
import { GEMINI_MODEL_OPTIONS } from '../lib/constants';
import { getConnection, getSendingSummaryMessage } from '../lib/format';
import type { AppController } from '../types';

interface ConnectionsViewProps {
  controller: AppController;
}

export function ConnectionsView({ controller }: ConnectionsViewProps) {
  const cf = getConnection(controller.data.connections, 'cloudflare');
  const resend = getConnection(controller.data.connections, 'resend');
  const gemini = getConnection(controller.data.connections, 'gemini');
  const groq = getConnection(controller.data.connections, 'groq');

  const [cloudflareForm, setCloudflareForm] = useState({ label: cf?.label || 'Cloudflare', token: '' });
  const [resendForm, setResendForm] = useState({ label: resend?.label || 'Resend', apiKey: '' });
  const [geminiForm, setGeminiForm] = useState({
    label: gemini?.label || 'Gemini',
    apiKey: '',
    defaultModel: String(gemini?.metadata?.defaultModel || GEMINI_MODEL_OPTIONS[0].id),
  });
  const [groqForm, setGroqForm] = useState({ label: groq?.label || 'Llama', apiKey: '' });

  return (
    <div className="view-stack">
      <section className="surface-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">Provider setup</div>
            <h3>Connections</h3>
          </div>
        </div>

        <div className="surface-grid two-up">
          <form
            className="form-card"
            onSubmit={(event) => {
              event.preventDefault();
              void controller.saveConnection('cloudflare', cloudflareForm).catch(console.error);
            }}
          >
            <h4>Cloudflare</h4>
            <label className="field">
              <span>Label</span>
              <input value={cloudflareForm.label} onChange={(event) => setCloudflareForm((current) => ({ ...current, label: event.target.value }))} />
            </label>
            <label className="field">
              <span>API token</span>
              <input type="password" placeholder="Cloudflare API token" value={cloudflareForm.token} onChange={(event) => setCloudflareForm((current) => ({ ...current, token: event.target.value }))} />
            </label>
            <div className="helper-copy">Stored encrypted on the Worker. Current: {cf?.secretMask || 'Not connected'}</div>
            <button type="submit" className="primary-button">Save Cloudflare connection</button>
          </form>

          <form
            className="form-card"
            onSubmit={(event) => {
              event.preventDefault();
              void controller.saveConnection('resend', resendForm).catch(console.error);
            }}
          >
            <h4>Resend</h4>
            <label className="field">
              <span>Label</span>
              <input value={resendForm.label} onChange={(event) => setResendForm((current) => ({ ...current, label: event.target.value }))} />
            </label>
            <label className="field">
              <span>API key</span>
              <input type="password" placeholder="re_..." value={resendForm.apiKey} onChange={(event) => setResendForm((current) => ({ ...current, apiKey: event.target.value }))} />
            </label>
            <div className="helper-copy">Stored encrypted on the Worker. Current: {resend?.secretMask || 'Not connected'}</div>
            <button type="submit" className="primary-button">Save Resend connection</button>
          </form>

          <form
            className="form-card"
            onSubmit={(event) => {
              event.preventDefault();
              void controller.saveConnection('gemini', geminiForm).catch(console.error);
            }}
          >
            <h4>Gemini</h4>
            <label className="field">
              <span>Label</span>
              <input value={geminiForm.label} onChange={(event) => setGeminiForm((current) => ({ ...current, label: event.target.value }))} />
            </label>
            <label className="field">
              <span>API key</span>
              <input type="password" placeholder="AIza..." value={geminiForm.apiKey} onChange={(event) => setGeminiForm((current) => ({ ...current, apiKey: event.target.value }))} />
            </label>
            <label className="field">
              <span>Default free model</span>
              <select value={geminiForm.defaultModel} onChange={(event) => setGeminiForm((current) => ({ ...current, defaultModel: event.target.value }))}>
                {GEMINI_MODEL_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            <div className="helper-copy">Stored encrypted on the Worker. Current: {gemini?.secretMask || 'Not connected'}</div>
            <button type="submit" className="primary-button">Save Gemini connection</button>
          </form>

          <form
            className="form-card"
            onSubmit={(event) => {
              event.preventDefault();
              void controller.saveConnection('groq', groqForm).catch(console.error);
            }}
          >
            <h4>Llama</h4>
            <label className="field">
              <span>Label</span>
              <input value={groqForm.label} onChange={(event) => setGroqForm((current) => ({ ...current, label: event.target.value }))} />
            </label>
            <label className="field">
              <span>API key</span>
              <input type="password" placeholder="gsk_..." value={groqForm.apiKey} onChange={(event) => setGroqForm((current) => ({ ...current, apiKey: event.target.value }))} />
            </label>
            <div className="helper-copy">Stored encrypted on the Worker. Current: {groq?.secretMask || 'Not connected'}</div>
            <div className="helper-copy">Fixed model: <code>llama-3.3-70b-versatile</code></div>
            <button type="submit" className="primary-button">Save Llama connection</button>
          </form>
        </div>
      </section>

      <section className="surface-card notice-card">
        <p>
          Cloudflare powers receiving, alias rules, and forwarding for every configured domain. Resend powers outbound delivery for whichever
          provisioned domain you mark as the sending domain. Gemini and Llama stay scoped to email composition, rewrite, and HTML email drafting.
        </p>
        <p>
          {getSendingSummaryMessage(
            controller.data.domains,
            controller.sendingDomainId,
            controller.selectedSendingDomainId,
            controller.sendingStatusMessage,
          )}
        </p>
      </section>
    </div>
  );
}
