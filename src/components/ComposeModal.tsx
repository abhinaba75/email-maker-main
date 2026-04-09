import { AnimatePresence, motion } from 'framer-motion';
import {
  Bold,
  Code2,
  FileText,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Smile,
  Sparkles,
  Strikethrough,
  Underline,
  Undo2,
  WandSparkles,
  X,
} from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AI_TONE_OPTIONS, GEMINI_MODEL_OPTIONS } from '../lib/constants';
import { formatAddresses, parseInlineAddressList } from '../lib/format';
import {
  appendSignatureToDocument,
  sanitizeEmailPreviewFragment,
  serializeVisualHtml,
  stripHtmlToText,
  textToComposeHtml,
} from '../lib/html';
import type { AiActionResult, ComposeDraft, ConnectionSummary, DraftRecord, HtmlTemplateRecord, MailboxRecord } from '../types';

const AI_PROVIDER_LABELS = {
  gemini: 'Gemini',
  groq: 'Llama',
} as const;

interface ComposeModalProps {
  draft: ComposeDraft | null;
  htmlTemplates: HtmlTemplateRecord[];
  connections: ConnectionSummary[];
  selectedSendingMailboxes: MailboxRecord[];
  sendingDomainLabel: string | null;
  sendingSummaryMessage: string;
  onClose: () => void;
  onSaveDraft: (draft: ComposeDraft, quiet?: boolean) => Promise<DraftRecord | null>;
  onSend: (draft: ComposeDraft) => Promise<void>;
  onUploadAttachments: (draft: ComposeDraft, files: FileList | File[]) => Promise<ComposeDraft['attachments']>;
  onAiAction: (draft: ComposeDraft, action: string, selectionText?: string) => Promise<AiActionResult>;
}

export function ComposeModal({
  draft,
  htmlTemplates,
  connections,
  selectedSendingMailboxes,
  sendingDomainLabel,
  sendingSummaryMessage,
  onClose,
  onSaveDraft,
  onSend,
  onUploadAttachments,
  onAiAction,
}: ComposeModalProps) {
  const [form, setForm] = useState<ComposeDraft | null>(draft);
  const [busy, setBusy] = useState(false);
  const [htmlPanelMode, setHtmlPanelMode] = useState<'visual' | 'split' | 'source'>('split');
  const [htmlStyles, setHtmlStyles] = useState('');

  const richEditorRef = useRef<HTMLDivElement | null>(null);
  const visualEditorRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const hydrateEditorRef = useRef(true);

  useEffect(() => {
    setForm(draft);
    hydrateEditorRef.current = true;
    if (draft?.htmlBody) {
      setHtmlStyles(sanitizeEmailPreviewFragment(draft.htmlBody).styles);
    }
  }, [draft]);

  const availableAiProviders = useMemo(() => {
    const providers: Array<'gemini' | 'groq'> = [];
    if (connections.some((connection) => connection.provider === 'gemini')) providers.push('gemini');
    if (connections.some((connection) => connection.provider === 'groq')) providers.push('groq');
    return providers;
  }, [connections]);

  const activeMailbox = useMemo(
    () => selectedSendingMailboxes.find((mailbox) => mailbox.id === form?.mailboxId) || null,
    [form?.mailboxId, selectedSendingMailboxes],
  );

  const canSend = Boolean(form?.mailboxId && selectedSendingMailboxes.some((mailbox) => mailbox.id === form.mailboxId));
  const composeNotice = canSend
    ? `Messages from this window will send through ${sendingDomainLabel || 'the selected sending domain'}.`
    : form?.mailboxId
      ? 'This draft still points at a receive-only mailbox. Pick a sender from the selected sending domain before sending.'
      : sendingSummaryMessage;

  function syncDraftFromEditors(current = form): ComposeDraft | null {
    if (!current) return null;
    if (current.editorMode === 'html') {
      const nextHtml = sourceRef.current?.value ?? current.htmlBody;
      return {
        ...current,
        htmlBody: nextHtml,
        textBody: stripHtmlToText(nextHtml),
      };
    }
    const richHtml = richEditorRef.current?.innerHTML || current.htmlBody || '<p><br></p>';
    return {
      ...current,
      htmlBody: richHtml,
      textBody: stripHtmlToText(richHtml),
    };
  }

  function scheduleAutosave(nextDraft: ComposeDraft | null) {
    if (!nextDraft) return;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      onSaveDraft(nextDraft, true).catch(console.error);
    }, 1200);
  }

  useEffect(() => {
    if (!form) return;
    if (hydrateEditorRef.current) {
      const html = form.htmlBody || textToComposeHtml(form.textBody || '');
      if (richEditorRef.current) {
        richEditorRef.current.innerHTML = html;
      }
      const fragment = sanitizeEmailPreviewFragment(html);
      setHtmlStyles(fragment.styles);
      if (visualEditorRef.current) {
        visualEditorRef.current.innerHTML = fragment.body || '<p><br></p>';
      }
      if (sourceRef.current) {
        sourceRef.current.value = html;
      }
      hydrateEditorRef.current = false;
      return;
    }
    scheduleAutosave(form);
  }, [form]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  if (!form) return null;

  function updateField<K extends keyof ComposeDraft>(field: K, value: ComposeDraft[K]) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  function setHtmlDocument(html: string) {
    const fragment = sanitizeEmailPreviewFragment(html);
    setHtmlStyles(fragment.styles);
    if (visualEditorRef.current) {
      visualEditorRef.current.innerHTML = fragment.body || '<p><br></p>';
    }
    if (sourceRef.current) {
      sourceRef.current.value = html;
    }
    setForm((current) => (current ? { ...current, htmlBody: html, textBody: stripHtmlToText(html) } : current));
  }

  function syncVisualHtml() {
    if (!visualEditorRef.current) return;
    const nextHtml = serializeVisualHtml(htmlStyles, visualEditorRef.current.innerHTML || '<p><br></p>');
    if (sourceRef.current) sourceRef.current.value = nextHtml;
    setForm((current) => (current ? { ...current, htmlBody: nextHtml, textBody: stripHtmlToText(nextHtml) } : current));
  }

  function getSelectionText(): string {
    if (!form) return '';
    if (form.editorMode === 'html') {
      if (document.activeElement === sourceRef.current) {
        const source = sourceRef.current;
        if (!source) return '';
        return source.value.slice(source.selectionStart || 0, source.selectionEnd || 0);
      }
      const selection = window.getSelection();
      if (selection && visualEditorRef.current?.contains(selection.anchorNode)) {
        return selection.toString();
      }
      return '';
    }
    const selection = window.getSelection();
    if (selection && richEditorRef.current?.contains(selection.anchorNode)) {
      return selection.toString();
    }
    return '';
  }

  function replaceSelection(text: string) {
    if (!form) return;
    if (form.editorMode === 'html' && document.activeElement === sourceRef.current && sourceRef.current) {
      const start = sourceRef.current.selectionStart || 0;
      const end = sourceRef.current.selectionEnd || 0;
      const nextValue = `${sourceRef.current.value.slice(0, start)}${text}${sourceRef.current.value.slice(end)}`;
      setHtmlDocument(nextValue);
      sourceRef.current.selectionStart = sourceRef.current.selectionEnd = start + text.length;
      sourceRef.current.focus();
      return;
    }

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const fragment = range.createContextualFragment(text.includes('<') ? text : text.replace(/\n/g, '<br>'));
    range.insertNode(fragment);
    selection.collapseToEnd();
    if (form.editorMode === 'html') {
      syncVisualHtml();
      return;
    }
    const nextHtml = richEditorRef.current?.innerHTML || '<p><br></p>';
    setForm((current) => (current ? { ...current, htmlBody: nextHtml, textBody: stripHtmlToText(nextHtml) } : current));
  }

  async function handleSaveDraft(quiet = false) {
    const nextDraft = syncDraftFromEditors();
    if (!nextDraft) return;
    setBusy(true);
    try {
      const savedDraft = await onSaveDraft(nextDraft, quiet);
      if (savedDraft) {
        setForm((current) => (current ? { ...current, id: savedDraft.id } : current));
      } else {
        setForm(nextDraft);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextDraft = syncDraftFromEditors();
    if (!nextDraft) return;
    setBusy(true);
    try {
      await onSend({
        ...nextDraft,
        to: parseInlineAddressList(formatAddresses(nextDraft.to)),
        cc: parseInlineAddressList(formatAddresses(nextDraft.cc)),
        bcc: parseInlineAddressList(formatAddresses(nextDraft.bcc)),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return;
    const nextDraft = syncDraftFromEditors();
    if (!nextDraft) return;
    setBusy(true);
    try {
      const attachments = await onUploadAttachments(nextDraft, files);
      setForm({ ...nextDraft, attachments });
    } finally {
      setBusy(false);
    }
  }

  async function handleAiAction(action: string) {
    const nextDraft = syncDraftFromEditors();
    if (!nextDraft) return;
    setBusy(true);
    try {
      const result = await onAiAction(nextDraft, action, getSelectionText());
      if (result.replacementText && getSelectionText()) {
        replaceSelection(result.replacementText);
        return;
      }
      const nextHtml = result.htmlBody || textToComposeHtml(result.textBody || '');
      const nextSubject = result.subject ?? nextDraft.subject;
      if (nextDraft.editorMode === 'html') {
        setHtmlDocument(nextHtml);
        setForm((current) => (current ? { ...current, subject: nextSubject, htmlBody: nextHtml, textBody: stripHtmlToText(nextHtml) } : current));
      } else {
        if (richEditorRef.current) {
          richEditorRef.current.innerHTML = nextHtml;
        }
        setForm((current) => (current ? { ...current, subject: nextSubject, htmlBody: nextHtml, textBody: stripHtmlToText(nextHtml) } : current));
      }
    } finally {
      setBusy(false);
    }
  }

  function applyFormat(command: string) {
    if (!form) return;
    if (form.editorMode !== 'rich') return;
    richEditorRef.current?.focus();
    if (command === 'link') {
      const url = window.prompt('Enter the link URL');
      if (url) document.execCommand('createLink', false, url);
    } else if (command === 'emoji') {
      document.execCommand('insertText', false, '🙂');
    } else if (command === 'signature') {
      const signature = activeMailbox?.signature_html || textToComposeHtml(activeMailbox?.signature_text || '');
      if (signature) {
        const nextHtml = appendSignatureToDocument(richEditorRef.current?.innerHTML || '<p><br></p>', signature);
        if (richEditorRef.current) {
          richEditorRef.current.innerHTML = nextHtml;
        }
      }
    } else {
      const commands: Record<string, [string, string?]> = {
        bold: ['bold'],
        italic: ['italic'],
        underline: ['underline'],
        strike: ['strikeThrough'],
        bullets: ['insertUnorderedList'],
        numbering: ['insertOrderedList'],
        quote: ['formatBlock', '<blockquote>'],
        clear: ['removeFormat'],
        undo: ['undo'],
        redo: ['redo'],
      };
      const config = commands[command];
      if (config) document.execCommand(config[0], false, config[1]);
    }
    const nextHtml = richEditorRef.current?.innerHTML || '<p><br></p>';
    setForm((current) => (current ? { ...current, htmlBody: nextHtml, textBody: stripHtmlToText(nextHtml) } : current));
  }

  function applyTemplate(templateId: string) {
    if (!form) return;
    const template = htmlTemplates.find((item) => item.id === templateId);
    if (!template) return;
    const hasExistingContent = Boolean(form.subject.trim() || form.textBody.trim() || form.htmlBody.trim());
    if (hasExistingContent && !window.confirm(`Replace the current draft content with "${template.name}"?`)) {
      return;
    }
    const nextHtml = template.html_content || '';
    setForm((current) => (current ? {
      ...current,
      subject: template.subject || '',
      htmlBody: nextHtml,
      textBody: stripHtmlToText(nextHtml),
      editorMode: 'html',
      templateId: template.id,
    } : current));
    setHtmlDocument(nextHtml);
  }

  function handleModeChange(mode: 'rich' | 'html') {
    const nextDraft = syncDraftFromEditors();
    if (!nextDraft) return;
    if (mode === 'html') {
      const nextHtml = nextDraft.htmlBody || textToComposeHtml(nextDraft.textBody);
      setForm({ ...nextDraft, editorMode: mode, htmlBody: nextHtml, textBody: stripHtmlToText(nextHtml) });
      setHtmlDocument(nextHtml);
      return;
    }
    if (richEditorRef.current) {
      richEditorRef.current.innerHTML = nextDraft.htmlBody || textToComposeHtml(nextDraft.textBody);
    }
    setForm({ ...nextDraft, editorMode: mode });
  }

  const toolbarButtons = [
    { id: 'bold', label: 'Bold', icon: Bold },
    { id: 'italic', label: 'Italic', icon: Italic },
    { id: 'underline', label: 'Underline', icon: Underline },
    { id: 'strike', label: 'Strike', icon: Strikethrough },
    { id: 'bullets', label: 'Bullets', icon: List },
    { id: 'numbering', label: 'Numbering', icon: ListOrdered },
    { id: 'quote', label: 'Quote', icon: Quote },
    { id: 'link', label: 'Link', icon: Link2 },
    { id: 'emoji', label: 'Emoji', icon: Smile },
    { id: 'signature', label: 'Signature', icon: WandSparkles },
    { id: 'undo', label: 'Undo', icon: Undo2 },
    { id: 'redo', label: 'Redo', icon: Redo2 },
  ];

  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="compose-modal"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
        >
          <div className="compose-head">
            <div>
              <div className="eyebrow">Compose</div>
              <h2>{form.id ? 'Edit draft' : 'New message'}</h2>
              <p>{composeNotice}</p>
            </div>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close compose">
              <X size={18} />
            </button>
          </div>

          <form className="compose-form" onSubmit={handleSend}>
            <div className="compose-grid">
              <label className="field">
                <span>From</span>
                <select
                  value={form.mailboxId || ''}
                  onChange={(event) => {
                    const mailbox = selectedSendingMailboxes.find((item) => item.id === event.target.value) || null;
                    setForm((current) => current ? {
                      ...current,
                      mailboxId: mailbox?.id || null,
                      domainId: mailbox?.domain_id || null,
                      fromAddress: mailbox?.email_address || '',
                    } : current);
                  }}
                >
                  <option value="">Select a sender</option>
                  {selectedSendingMailboxes.map((mailbox) => (
                    <option key={mailbox.id} value={mailbox.id}>
                      {mailbox.email_address}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field span-2">
                <span>To</span>
                <input
                  value={formatAddresses(form.to)}
                  onChange={(event) => updateField('to', parseInlineAddressList(event.target.value))}
                  placeholder="alice@example.com, bob@example.com"
                />
              </label>
              <label className="field">
                <span>Cc</span>
                <input value={formatAddresses(form.cc)} onChange={(event) => updateField('cc', parseInlineAddressList(event.target.value))} />
              </label>
              <label className="field">
                <span>Bcc</span>
                <input value={formatAddresses(form.bcc)} onChange={(event) => updateField('bcc', parseInlineAddressList(event.target.value))} />
              </label>
              <label className="field span-2">
                <span>Subject</span>
                <input value={form.subject} onChange={(event) => updateField('subject', event.target.value)} />
              </label>
            </div>

            <div className="compose-toolbar">
              <div className="segmented-control">
                <button type="button" className={form.editorMode === 'rich' ? 'active' : ''} onClick={() => handleModeChange('rich')}>
                  <FileText size={16} />
                  Design
                </button>
                <button type="button" className={form.editorMode === 'html' ? 'active' : ''} onClick={() => handleModeChange('html')}>
                  <Code2 size={16} />
                  HTML
                </button>
              </div>

              <div className="compose-template-bar">
                <select value={form.templateId || ''} onChange={(event) => updateField('templateId', event.target.value || null)}>
                  <option value="">Choose a saved template</option>
                  {htmlTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="toolbar-button" onClick={() => form.templateId && applyTemplate(form.templateId)} disabled={!form.templateId}>
                  Apply template
                </button>
              </div>
            </div>

            <div className="compose-ai-panel">
              <label className="field compact-field">
                <span>AI engine</span>
                <select value={form.aiProvider} onChange={(event) => updateField('aiProvider', event.target.value as ComposeDraft['aiProvider'])}>
                  {availableAiProviders.length ? availableAiProviders.map((provider) => (
                    <option key={provider} value={provider}>
                      {AI_PROVIDER_LABELS[provider]}
                    </option>
                  )) : <option value="">Connect Gemini or Llama first</option>}
                </select>
              </label>
              {form.aiProvider === 'gemini' ? (
                <label className="field compact-field">
                  <span>Gemini model</span>
                  <select value={form.aiModel} onChange={(event) => updateField('aiModel', event.target.value)}>
                    {GEMINI_MODEL_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="compose-pill">Model: llama-3.3-70b-versatile</div>
              )}
              <label className="field compact-field">
                <span>Tone</span>
                <select value={form.aiTone} onChange={(event) => updateField('aiTone', event.target.value)}>
                  {AI_TONE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="field ai-prompt-field">
                <span>AI prompt</span>
                <input
                  value={form.aiPrompt}
                  onChange={(event) => updateField('aiPrompt', event.target.value)}
                  placeholder="Draft a follow-up, rewrite this warmer, or build a full HTML promo email..."
                />
              </label>
              {['compose', 'rewrite', 'shorten', 'expand', 'formalize', 'casualize', 'proofread', 'summarize'].map((action) => (
                <button
                  key={action}
                  type="button"
                  className="toolbar-button"
                  onClick={() => void handleAiAction(action)}
                  disabled={busy || !availableAiProviders.length}
                >
                  <Sparkles size={14} />
                  {action === 'compose' ? 'AI Compose' : action.charAt(0).toUpperCase() + action.slice(1)}
                </button>
              ))}
            </div>

            {form.editorMode === 'rich' ? (
              <>
                <div className="format-toolbar">
                  {toolbarButtons.map((button) => {
                    const Icon = button.icon;
                    return (
                      <button key={button.id} type="button" className="toolbar-button icon-label-button" onClick={() => applyFormat(button.id)}>
                        <Icon size={14} />
                        {button.label}
                      </button>
                    );
                  })}
                </div>
                <div className="editor-shell">
                  <div
                    ref={richEditorRef}
                    className="rich-editor"
                    contentEditable
                    suppressContentEditableWarning
                    onInput={() => {
                      const nextHtml = richEditorRef.current?.innerHTML || '<p><br></p>';
                      setForm((current) => current ? { ...current, htmlBody: nextHtml, textBody: stripHtmlToText(nextHtml) } : current);
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="html-workspace">
                <div className="html-preview-mode-switch">
                  <button type="button" className={htmlPanelMode === 'visual' ? 'active' : ''} onClick={() => setHtmlPanelMode('visual')}>
                    Visual
                  </button>
                  <button type="button" className={htmlPanelMode === 'split' ? 'active' : ''} onClick={() => setHtmlPanelMode('split')}>
                    Split
                  </button>
                  <button type="button" className={htmlPanelMode === 'source' ? 'active' : ''} onClick={() => setHtmlPanelMode('source')}>
                    Source
                  </button>
                </div>

                {(htmlPanelMode === 'visual' || htmlPanelMode === 'split') ? (
                  <div className="html-preview-surface">
                    <div className="preview-surface-label">Rendered preview (click to edit visually)</div>
                    <style dangerouslySetInnerHTML={{ __html: htmlStyles }} />
                    <div
                      ref={visualEditorRef}
                      className="visual-editor"
                      contentEditable
                      suppressContentEditableWarning
                      onInput={syncVisualHtml}
                      onClick={(event) => {
                        if (event.target instanceof HTMLAnchorElement) {
                          event.preventDefault();
                        }
                      }}
                    />
                  </div>
                ) : null}

                {(htmlPanelMode === 'source' || htmlPanelMode === 'split') ? (
                  <label className="field html-source-field">
                    <span>HTML source</span>
                    <textarea
                      ref={sourceRef}
                      className="html-source-textarea"
                      defaultValue={form.htmlBody || textToComposeHtml(form.textBody)}
                      onInput={(event) => setHtmlDocument(event.currentTarget.value)}
                    />
                  </label>
                ) : null}
              </div>
            )}

            <label className="field">
              <span>Attachments</span>
              <input type="file" multiple onChange={(event) => void handleUpload(event.target.files)} />
            </label>
            <div className="attachment-chip-row">
              {form.attachments.map((attachment) => (
                <span key={attachment.id} className="attachment-chip">
                  {attachment.fileName || attachment.file_name || 'attachment'}
                </span>
              ))}
            </div>

            <div className="compose-actions">
              <button type="submit" className="primary-button" disabled={!canSend || busy}>Send</button>
              <button type="button" className="toolbar-button" disabled={busy} onClick={() => void handleSaveDraft(false)}>Save draft</button>
              <button type="button" className="toolbar-button" disabled={busy} onClick={onClose}>Discard</button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
