import { useEffect, useMemo, useState } from 'react';
import { formatDateTime, formatSendCapability, getDomain, getMailbox, getSendingSummaryMessage } from '../lib/format';
import { stripHtmlToText } from '../lib/html';
import type { AppController } from '../types';

interface DomainsMailboxesViewProps {
  controller: AppController;
}

export function DomainsMailboxesView({ controller }: DomainsMailboxesViewProps) {
  const [editingMailboxId, setEditingMailboxId] = useState<string | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  const editingMailbox = useMemo(
    () => getMailbox(controller.data.mailboxes, editingMailboxId),
    [controller.data.mailboxes, editingMailboxId],
  );
  const editingTemplate = useMemo(
    () => controller.data.htmlTemplates.find((template) => template.id === editingTemplateId) || null,
    [controller.data.htmlTemplates, editingTemplateId],
  );

  const [domainForm, setDomainForm] = useState({
    zoneId: '',
    hostname: '',
    label: '',
    defaultMailboxLocalPart: 'admin',
    displayName: 'Abhinaba Das',
  });
  const [mailboxForm, setMailboxForm] = useState({
    domainId: '',
    localPart: '',
    displayName: '',
    signatureText: '',
    signatureHtml: '',
    isDefaultSender: false,
  });
  const [templateForm, setTemplateForm] = useState({
    domainId: '',
    name: '',
    subject: '',
    htmlContent: '',
  });

  useEffect(() => {
    setMailboxForm({
      domainId: editingMailbox?.domain_id || '',
      localPart: editingMailbox?.local_part || '',
      displayName: editingMailbox?.display_name || '',
      signatureText: editingMailbox?.signature_text || '',
      signatureHtml: editingMailbox?.signature_html || '',
      isDefaultSender: Boolean(editingMailbox?.is_default_sender),
    });
  }, [editingMailboxId, editingMailbox]);

  useEffect(() => {
    setTemplateForm({
      domainId: editingTemplate?.domain_id || '',
      name: editingTemplate?.name || '',
      subject: editingTemplate?.subject || '',
      htmlContent: editingTemplate?.html_content || '',
    });
  }, [editingTemplateId, editingTemplate]);

  return (
    <div className="view-stack">
      <section className="surface-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">Provision receiving</div>
            <h3>Add domain</h3>
          </div>
        </div>

        <form
          className="grid-form"
          onSubmit={(event) => {
            event.preventDefault();
            void controller.provisionDomain(domainForm).catch(console.error);
          }}
        >
          <label className="field">
            <span>Cloudflare zone</span>
            <select value={domainForm.zoneId} onChange={(event) => setDomainForm((current) => ({ ...current, zoneId: event.target.value }))}>
              <option value="">Select a zone</option>
              {controller.zones.map((zone) => (
                <option key={zone.id} value={zone.id}>{zone.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Mail hostname</span>
            <input value={domainForm.hostname} onChange={(event) => setDomainForm((current) => ({ ...current, hostname: event.target.value }))} placeholder="mail.example.com or example.com" />
          </label>
          <label className="field">
            <span>Label</span>
            <input value={domainForm.label} onChange={(event) => setDomainForm((current) => ({ ...current, label: event.target.value }))} placeholder="Primary brand mail" />
          </label>
          <label className="field">
            <span>Default sender local part</span>
            <input value={domainForm.defaultMailboxLocalPart} onChange={(event) => setDomainForm((current) => ({ ...current, defaultMailboxLocalPart: event.target.value }))} />
          </label>
          <label className="field span-2">
            <span>Display name</span>
            <input value={domainForm.displayName} onChange={(event) => setDomainForm((current) => ({ ...current, displayName: event.target.value }))} />
          </label>
          <div className="span-2">
            <button type="submit" className="primary-button">Provision domain</button>
          </div>
        </form>
      </section>

      <section className="surface-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">Routing and sending</div>
            <h3>Provisioned domains</h3>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Hostname</th>
                <th>Routing</th>
                <th>Capability</th>
                <th>Resend</th>
                <th>Mailboxes</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {controller.data.domains.length ? controller.data.domains.map((domain) => {
                const domainMailboxes = controller.data.mailboxes.filter((mailbox) => mailbox.domain_id === domain.id);
                return (
                  <tr key={domain.id}>
                    <td>{domain.hostname}</td>
                    <td>
                      {domain.routing_status}
                      {domain.routing_error ? <div className="table-meta">{domain.routing_error}</div> : null}
                    </td>
                    <td>{formatSendCapability(domain.sendCapability || domain.send_capability)}</td>
                    <td>{domain.resend_status || 'not_configured'}</td>
                    <td>{domainMailboxes.map((mailbox) => mailbox.email_address).join(', ') || 'No mailboxes'}</td>
                    <td>
                      <div className="table-actions">
                        {domain.isSelectedSendingDomain ? (
                          <span className="inline-chip good">Sending domain</span>
                        ) : (
                          <button type="button" className="toolbar-button" onClick={() => void controller.selectSendingDomain(domain.id).catch(console.error)}>
                            Use for sending
                          </button>
                        )}
                        <button type="button" className="toolbar-button" onClick={() => void controller.refreshDomain(domain.id).catch(console.error)}>
                          Refresh
                        </button>
                        <button type="button" className="toolbar-button" onClick={() => void controller.repairDomainRouting(domain.id).catch(console.error)}>
                          Repair routing
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={6}>No domains configured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="helper-copy">
          {getSendingSummaryMessage(
            controller.data.domains,
            controller.sendingDomainId,
            controller.selectedSendingDomainId,
            controller.sendingStatusMessage,
          )}
        </div>
      </section>

      <section className="surface-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">Mailboxes</div>
            <h3>Manage mailboxes</h3>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Email</th>
                <th>Display name</th>
                <th>Default</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {controller.data.mailboxes.length ? controller.data.mailboxes.map((mailbox) => (
                <tr key={mailbox.id} className={mailbox.id === editingMailboxId ? 'active-row' : ''}>
                  <td>{getDomain(controller.data.domains, mailbox.domain_id)?.hostname || ''}</td>
                  <td>{mailbox.email_address}</td>
                  <td>{mailbox.display_name || ''}</td>
                  <td>{mailbox.is_default_sender ? 'Yes' : 'No'}</td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="toolbar-button" onClick={() => setEditingMailboxId(mailbox.id)}>Edit mailbox</button>
                      <button
                        type="button"
                        className="toolbar-button danger"
                        onClick={() => {
                          if (window.confirm(`Delete mailbox ${mailbox.email_address}?`)) {
                            void controller.deleteMailbox(mailbox.id).catch(console.error);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={5}>No mailboxes configured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">Mailbox editor</div>
            <h3>{editingMailbox ? `Edit ${editingMailbox.email_address}` : 'Create mailbox'}</h3>
          </div>
        </div>
        <form
          className="grid-form"
          onSubmit={(event) => {
            event.preventDefault();
            void controller.saveMailbox(editingMailbox?.id || null, mailboxForm).catch(console.error);
            setEditingMailboxId(null);
          }}
        >
          <label className="field">
            <span>Domain</span>
            <select
              value={mailboxForm.domainId}
              disabled={Boolean(editingMailbox)}
              onChange={(event) => setMailboxForm((current) => ({ ...current, domainId: event.target.value }))}
            >
              <option value="">Select a domain</option>
              {controller.data.domains.map((domain) => (
                <option key={domain.id} value={domain.id}>{domain.hostname}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Local part</span>
            <input value={mailboxForm.localPart} onChange={(event) => setMailboxForm((current) => ({ ...current, localPart: event.target.value }))} placeholder="sales" />
          </label>
          <label className="field">
            <span>Display name</span>
            <input value={mailboxForm.displayName} onChange={(event) => setMailboxForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="Sales Desk" />
          </label>
          <label className="field">
            <span>Signature text</span>
            <input value={mailboxForm.signatureText} onChange={(event) => setMailboxForm((current) => ({ ...current, signatureText: event.target.value }))} placeholder="Regards, Sales Desk" />
          </label>
          <label className="field span-2">
            <span>Signature HTML</span>
            <textarea value={mailboxForm.signatureHtml} onChange={(event) => setMailboxForm((current) => ({ ...current, signatureHtml: event.target.value }))} placeholder="<p>Regards,<br />Sales Desk</p>" />
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={mailboxForm.isDefaultSender} onChange={(event) => setMailboxForm((current) => ({ ...current, isDefaultSender: event.target.checked }))} />
            <span>Default sender for this domain</span>
          </label>
          <div className="span-2 inline-action-row">
            <button type="submit" className="primary-button">{editingMailbox ? 'Save mailbox' : 'Create mailbox'}</button>
            {editingMailbox ? <button type="button" className="toolbar-button" onClick={() => setEditingMailboxId(null)}>Cancel</button> : null}
          </div>
        </form>
      </section>

      <section className="surface-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">HTML templates</div>
            <h3>Template saver</h3>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Domain</th>
                <th>Subject</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {controller.data.htmlTemplates.length ? controller.data.htmlTemplates.map((template) => (
                <tr key={template.id} className={template.id === editingTemplateId ? 'active-row' : ''}>
                  <td>{template.name}</td>
                  <td>{getDomain(controller.data.domains, template.domain_id)?.hostname || 'Any sending domain'}</td>
                  <td>{template.subject || '(no subject preset)'}</td>
                  <td>{formatDateTime(template.updated_at || template.created_at)}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="toolbar-button"
                        onClick={() => void controller.openCompose({
                          subject: template.subject || '',
                          htmlBody: template.html_content || '',
                          textBody: stripHtmlToText(template.html_content || ''),
                          editorMode: 'html',
                          templateId: template.id,
                        }).catch(console.error)}
                      >
                        Use in compose
                      </button>
                      <button type="button" className="toolbar-button" onClick={() => setEditingTemplateId(template.id)}>Edit</button>
                      <button
                        type="button"
                        className="toolbar-button danger"
                        onClick={() => {
                          if (window.confirm(`Delete HTML template "${template.name}"?`)) {
                            void controller.deleteTemplate(template.id).catch(console.error);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={5}>No HTML templates saved yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-card">
        <div className="section-head">
          <div>
            <div className="eyebrow">Template editor</div>
            <h3>{editingTemplate ? `Edit ${editingTemplate.name}` : 'Save HTML template'}</h3>
          </div>
        </div>
        <form
          className="grid-form"
          onSubmit={(event) => {
            event.preventDefault();
            void controller.saveTemplate(editingTemplate?.id || null, {
              ...templateForm,
              domainId: templateForm.domainId || null,
            }).catch(console.error);
            setEditingTemplateId(null);
          }}
        >
          <label className="field">
            <span>Domain</span>
            <select value={templateForm.domainId} onChange={(event) => setTemplateForm((current) => ({ ...current, domainId: event.target.value }))}>
              <option value="">Any sending domain</option>
              {controller.data.domains.map((domain) => (
                <option key={domain.id} value={domain.id}>{domain.hostname}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Template name</span>
            <input value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))} placeholder="Quarterly announcement" />
          </label>
          <label className="field span-2">
            <span>Preset subject</span>
            <input value={templateForm.subject} onChange={(event) => setTemplateForm((current) => ({ ...current, subject: event.target.value }))} placeholder="Important update from our team" />
          </label>
          <label className="field span-2">
            <span>HTML markup</span>
            <textarea className="source-textarea tall" value={templateForm.htmlContent} onChange={(event) => setTemplateForm((current) => ({ ...current, htmlContent: event.target.value }))} />
          </label>
          <div className="span-2 inline-action-row">
            <button type="submit" className="primary-button">{editingTemplate ? 'Save template' : 'Create template'}</button>
            {editingTemplate ? <button type="button" className="toolbar-button" onClick={() => setEditingTemplateId(null)}>Cancel</button> : null}
          </div>
        </form>
      </section>
    </div>
  );
}
