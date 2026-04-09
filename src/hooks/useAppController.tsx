import { useEffect, useRef, useState } from 'react';
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onIdTokenChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { AI_TONE_OPTIONS, BOOT_REQUEST_TIMEOUT_MS, FALLBACK_FIREBASE_CONFIG, GEMINI_MODEL_OPTIONS, WORKER_ORIGIN } from '../lib/constants';
import {
  buildAlertSummary,
  formatAddresses,
  getConnection,
  getDefaultMailbox,
  getDomain,
  getMailbox,
  getSelectedSendingMailboxes,
  getSendingDomain,
  getSendingSummaryMessage,
  normalizeDraftRecord,
  parseInlineAddressList,
} from '../lib/format';
import { stripHtmlToText } from '../lib/html';
import type {
  AddressEntry,
  AiActionResult,
  AlertCounts,
  AppController,
  BootPayload,
  ComposeDraft,
  ConnectionSummary,
  DomainRecord,
  DraftRecord,
  FolderId,
  HtmlTemplateRecord,
  MailboxRecord,
  RuntimeConfig,
  RuntimeFirebaseConfig,
  ThreadDetail,
  ThreadSummary,
  UploadedAttachment,
  UserSummary,
  ViewId,
  WorkspaceData,
  ZoneRecord,
} from '../types';

const EMPTY_ALERTS: AlertCounts = { routingDegraded: 0, ingestFailures: 0 };
const EMPTY_DATA: WorkspaceData = {
  connections: [],
  domains: [],
  mailboxes: [],
  htmlTemplates: [],
  forwardDestinations: [],
  aliases: [],
  drafts: [],
};

function normalizeFirebaseConfig(config?: Partial<RuntimeFirebaseConfig> | null): RuntimeFirebaseConfig {
  const candidate = config || {};
  return {
    apiKey: String(candidate.apiKey || FALLBACK_FIREBASE_CONFIG.apiKey || '').trim(),
    authDomain: String(candidate.authDomain || FALLBACK_FIREBASE_CONFIG.authDomain || '').trim(),
    projectId: String(candidate.projectId || FALLBACK_FIREBASE_CONFIG.projectId || '').trim(),
    appId: String(candidate.appId || FALLBACK_FIREBASE_CONFIG.appId || '').trim(),
    messagingSenderId: String(candidate.messagingSenderId || FALLBACK_FIREBASE_CONFIG.messagingSenderId || '').trim(),
  };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Request timed out for ${url}`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchRuntimeConfigFrom(url: string): Promise<RuntimeConfig> {
  const response = await fetchWithTimeout(url, { cache: 'no-store' }, BOOT_REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`Runtime config request failed with ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as RuntimeConfig;
  return {
    ...payload,
    firebase: normalizeFirebaseConfig(payload?.firebase),
  };
}

function isDraftRecord(value: Partial<ComposeDraft> | DraftRecord): value is DraftRecord {
  return 'mailbox_id' in value || 'to_json' in value || 'html_body' in value;
}

export function useAppController(): AppController {
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);
  const [user, setUser] = useState<UserSummary | null>(null);
  const [status, setStatus] = useState('Preparing workspace...');
  const [booting, setBooting] = useState(true);
  const [loginMessage, setLoginMessage] = useState('Waiting for Firebase configuration...');
  const [view, setView] = useState<ViewId>('mail');
  const [folder, setFolder] = useState<FolderId>('inbox');
  const [mailboxId, setMailboxId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [data, setData] = useState<WorkspaceData>(EMPTY_DATA);
  const [zones, setZones] = useState<ZoneRecord[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadDetail | null>(null);
  const [composeSeed, setComposeSeed] = useState<ComposeDraft | null>(null);
  const [alertCounts, setAlertCounts] = useState<AlertCounts>(EMPTY_ALERTS);
  const [selectedSendingDomainId, setSelectedSendingDomainId] = useState<string | null>(null);
  const [sendingDomainId, setSendingDomainId] = useState<string | null>(null);
  const [sendingStatusMessage, setSendingStatusMessage] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<'idle' | 'connecting' | 'connected' | 'reconnecting'>('idle');

  const authRef = useRef<Auth | null>(null);
  const providerRef = useRef<GoogleAuthProvider | null>(null);
  const tokenRef = useRef('');
  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const realtimeSessionRef = useRef(0);

  async function getFreshToken(forceRefresh = false): Promise<string> {
    const currentUser = authRef.current?.currentUser;
    if (!currentUser) return tokenRef.current || '';
    tokenRef.current = await currentUser.getIdToken(forceRefresh);
    return tokenRef.current;
  }

  async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    if (!(options.body instanceof FormData)) {
      headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
    }
    const token = await getFreshToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    let response = await fetchWithTimeout(path, { ...options, headers });
    if (response.status === 401 && authRef.current?.currentUser) {
      const retryHeaders = new Headers(options.headers || {});
      if (!(options.body instanceof FormData)) {
        retryHeaders.set('Content-Type', retryHeaders.get('Content-Type') || 'application/json');
      }
      const refreshedToken = await getFreshToken(true);
      if (refreshedToken) retryHeaders.set('Authorization', `Bearer ${refreshedToken}`);
      response = await fetchWithTimeout(path, { ...options, headers: retryHeaders });
    }

    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const errorPayload = (await response.json()) as { error?: string };
        message = errorPayload.error || message;
      } catch {
        // Ignore non-JSON errors.
      }
      throw new Error(message);
    }

    return (await response.json()) as T;
  }

  async function apiBlob(path: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers || {});
    const token = await getFreshToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetchWithTimeout(path, { ...options, headers });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return response;
  }

  function showError(error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
    setStatus(message);
    if (!user) {
      setLoginMessage(message);
      setBooting(false);
    }
    console.error(error);
  }

  async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
    try {
      return await fetchRuntimeConfigFrom('/api/runtime-config');
    } catch (primaryError) {
      if (window.location.origin === WORKER_ORIGIN) throw primaryError;
      const fallback = await fetchRuntimeConfigFrom(`${WORKER_ORIGIN}/api/runtime-config`);
      return fallback;
    }
  }

  function disconnectRealtime() {
    realtimeSessionRef.current += 1;
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (realtimeSocketRef.current) {
      realtimeSocketRef.current.close();
      realtimeSocketRef.current = null;
    }
    setRealtimeStatus('idle');
  }

  async function loadZones() {
    try {
      const payload = await api<{ zones?: ZoneRecord[] }>('/api/cloudflare/zones');
      setZones(payload.zones || []);
    } catch {
      setZones([]);
    }
  }

  async function loadHtmlTemplates() {
    const payload = await api<{ items?: HtmlTemplateRecord[]; templates?: HtmlTemplateRecord[] }>('/api/html-templates?limit=100');
    setData((current) => ({ ...current, htmlTemplates: payload.items || payload.templates || [] }));
  }

  async function loadAliases() {
    const payload = await api<{ items?: WorkspaceData['aliases']; aliases?: WorkspaceData['aliases'] }>('/api/aliases?limit=100');
    setData((current) => ({ ...current, aliases: payload.items || payload.aliases || [] }));
  }

  async function loadForwardDestinations() {
    const payload = await api<{ items?: WorkspaceData['forwardDestinations']; forwardDestinations?: WorkspaceData['forwardDestinations'] }>(
      '/api/forward-destinations?limit=100',
    );
    setData((current) => ({
      ...current,
      forwardDestinations: payload.items || payload.forwardDestinations || [],
    }));
  }

  async function loadDrafts() {
    const payload = await api<{ items?: DraftRecord[]; drafts?: DraftRecord[] }>('/api/drafts?limit=100');
    setData((current) => ({ ...current, drafts: payload.items || payload.drafts || [] }));
  }

  async function ensureViewData(targetView: ViewId = view) {
    if (targetView === 'domains') {
      await loadHtmlTemplates();
    } else if (targetView === 'aliases') {
      await Promise.all([loadAliases(), loadForwardDestinations()]);
    } else if (targetView === 'destinations') {
      await loadForwardDestinations();
    } else if (targetView === 'drafts') {
      await loadDrafts();
    }
  }

  async function selectThreadAction(threadId: string) {
    const payload = await api<{ thread: ThreadDetail }>(`/api/threads/${threadId}`);
    setSelectedThread(payload.thread);
    setStatus(`Opened "${payload.thread.subject || '(no subject)'}"`);
  }

  async function loadThreadsAction(
    targetFolder = folder,
    targetMailboxId = mailboxId,
    targetSearch = searchQuery,
    options: { preserveSelection?: boolean } = {},
  ) {
    if (!tokenRef.current && !authRef.current?.currentUser) return;
    setStatus(`Loading ${targetFolder}...`);
    const query = new URLSearchParams({ folder: targetFolder });
    if (targetMailboxId) query.set('mailboxId', targetMailboxId);
    if (targetSearch.trim()) query.set('query', targetSearch.trim());
    const payload = await api<{ items?: ThreadSummary[]; threads?: ThreadSummary[] }>(`/api/threads?${query.toString()}`);
    const nextThreads = payload.items || payload.threads || [];
    setThreads(nextThreads);
    const preservedSelection = options.preserveSelection && selectedThread?.id
      ? nextThreads.find((thread) => thread.id === selectedThread.id)
      : null;
    if (preservedSelection) {
      await selectThreadAction(preservedSelection.id);
    } else {
      setSelectedThread(null);
      setStatus(`Ready. ${nextThreads.length} thread(s) in ${targetFolder}.`);
    }
  }

  async function refreshBootstrap() {
    setStatus('Loading workspace...');
    const payload = await api<BootPayload>('/api/bootstrap');
    setUser(payload.user);
    setSelectedSendingDomainId(payload.selectedSendingDomainId || null);
    setSendingDomainId(payload.sendingDomainId || null);
    setSendingStatusMessage(payload.sendingStatusMessage || null);
    setAlertCounts(payload.alertCounts || EMPTY_ALERTS);
    setData((current) => ({
      ...current,
      connections: payload.connections || [],
      domains: payload.domains || [],
      mailboxes: payload.mailboxes || [],
      htmlTemplates: current.htmlTemplates,
      forwardDestinations: current.forwardDestinations,
      aliases: current.aliases,
      drafts: current.drafts,
    }));
    if (view === 'mail') {
      await loadThreadsAction(folder, mailboxId, searchQuery, { preserveSelection: false });
    } else {
      await ensureViewData(view);
      setStatus(buildAlertSummary(payload.alertCounts || EMPTY_ALERTS) || 'Workspace ready.');
    }
  }

  async function handleRealtimeEvent(event: { type?: string }) {
    if (!event?.type) return;
    if (event.type === 'thread.updated' && view === 'mail') {
      if (composeSeed) {
        setStatus('New mail arrived. Refresh after finishing your draft.');
        return;
      }
      await loadThreadsAction(folder, mailboxId, searchQuery, { preserveSelection: true });
      return;
    }
    if (event.type === 'draft.updated' && view === 'drafts') {
      await loadDrafts();
      return;
    }
    if (event.type === 'routing.degraded' || event.type === 'routing.updated' || event.type === 'ingest.failed') {
      await refreshBootstrap();
    }
  }

  async function connectRealtime() {
    if (!tokenRef.current && !authRef.current?.currentUser) return;
    disconnectRealtime();
    const sessionId = realtimeSessionRef.current;
    const token = await getFreshToken();
    if (!token) return;
    setRealtimeStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime?token=${encodeURIComponent(token)}`);
    realtimeSocketRef.current = socket;
    socket.addEventListener('open', () => {
      if (sessionId !== realtimeSessionRef.current) return;
      reconnectAttemptsRef.current = 0;
      setRealtimeStatus('connected');
      setStatus('Workspace ready.');
    });
    socket.addEventListener('message', (message) => {
      try {
        const payload = JSON.parse(message.data) as { type?: string };
        handleRealtimeEvent(payload).catch(showError);
      } catch {
        // Ignore malformed realtime events.
      }
    });
    socket.addEventListener('close', () => {
      if (sessionId !== realtimeSessionRef.current) return;
      realtimeSocketRef.current = null;
      reconnectAttemptsRef.current += 1;
      const delay = Math.min(10000, reconnectAttemptsRef.current * 1500);
      setRealtimeStatus('reconnecting');
      reconnectTimerRef.current = window.setTimeout(() => {
        connectRealtime().catch(showError);
      }, delay);
    });
    socket.addEventListener('error', () => {
      if (sessionId !== realtimeSessionRef.current) return;
      socket.close();
    });
  }

  function getComposeBaseMailbox(): MailboxRecord | null {
    const sendingMailboxes = getSelectedSendingMailboxes(data.mailboxes, selectedSendingDomainId);
    return getDefaultMailbox(sendingMailboxes);
  }

  function requireSendingMailbox(): MailboxRecord {
    const mailbox = getComposeBaseMailbox();
    if (!mailbox) {
      throw new Error(getSendingSummaryMessage(data.domains, sendingDomainId, selectedSendingDomainId, sendingStatusMessage));
    }
    return mailbox;
  }

  async function switchViewAction(target: string) {
    if (target.startsWith('mail:')) {
      const nextFolder = target.split(':')[1] as FolderId;
      setView('mail');
      setFolder(nextFolder);
      setMailboxId(null);
      setSelectedThread(null);
      await loadThreadsAction(nextFolder, null, searchQuery, { preserveSelection: false });
      return;
    }
    const nextView = target as ViewId;
    setView(nextView);
    setSelectedThread(null);
    await ensureViewData(nextView);
  }

  async function openMailboxInbox(mailboxIdValue: string) {
    setView('mail');
    setFolder('inbox');
    setMailboxId(mailboxIdValue);
    setSelectedThread(null);
    await loadThreadsAction('inbox', mailboxIdValue, searchQuery, { preserveSelection: false });
  }

  async function refreshCurrentView() {
    if (view === 'mail') {
      await loadThreadsAction(folder, mailboxId, searchQuery, { preserveSelection: true });
      return;
    }
    if (view === 'aliases') {
      await Promise.all([loadAliases(), loadForwardDestinations()]);
    } else if (view === 'destinations') {
      await loadForwardDestinations();
    } else if (view === 'drafts') {
      await loadDrafts();
    } else if (view === 'domains') {
      await Promise.all([loadHtmlTemplates(), loadZones(), refreshBootstrap()]);
      return;
    } else {
      await refreshBootstrap();
      return;
    }
    setStatus('Workspace ready.');
  }

  async function openComposeAction(payload?: Partial<ComposeDraft> | DraftRecord) {
    const baseMailbox = payload
      ? getMailbox(
          data.mailboxes,
          isDraftRecord(payload) ? payload.mailbox_id || null : payload.mailboxId || null,
        ) || getComposeBaseMailbox() || requireSendingMailbox()
      : requireSendingMailbox();

    const baseDraft: ComposeDraft = {
      id: null,
      domainId: baseMailbox.domain_id || null,
      mailboxId: baseMailbox.id || null,
      threadId: null,
      fromAddress: baseMailbox.email_address || '',
      to: [],
      cc: [],
      bcc: [],
      subject: '',
      textBody: '',
      htmlBody: '',
      attachments: [],
      editorMode: 'rich',
      aiProvider: getConnection(data.connections, 'groq') ? 'groq' : 'gemini',
      aiModel: GEMINI_MODEL_OPTIONS[0].id,
      aiTone: AI_TONE_OPTIONS[0].id,
      aiPrompt: '',
      templateId: null,
    };

    const normalized = payload ? normalizeDraftRecord(isDraftRecord(payload) ? payload : { ...baseDraft, ...payload }) : baseDraft;
    if (!data.htmlTemplates.length) {
      loadHtmlTemplates().catch(showError);
    }
    setComposeSeed(normalized);
  }

  function quoteThread(thread: ThreadDetail): string {
    if (!thread.messages.length) return '';
    const latest = thread.messages[thread.messages.length - 1];
    return `\n\n--- Original Message ---\nFrom: ${formatAddresses(latest.from_json ? [latest.from_json] : [])}\nTo: ${formatAddresses(
      latest.to_json || [],
    )}\nSubject: ${latest.subject || ''}\n\n${latest.text_body || latest.snippet || ''}`;
  }

  function buildReplyPayload(mode: 'reply' | 'forward'): ComposeDraft {
    if (!selectedThread) throw new Error('Select a thread first.');
    const threadCapability = getDomain(data.domains, selectedThread.domain_id)?.sendCapability
      || getDomain(data.domains, selectedThread.domain_id)?.send_capability;
    if (mode !== 'forward' && threadCapability !== 'send_enabled') {
      throw new Error('Reply is blocked for receive-only domains. Forward the message or send a new mail from the selected sending domain.');
    }
    const latest = selectedThread.messages[selectedThread.messages.length - 1];
    const mailbox = requireSendingMailbox();
    return {
      id: null,
      domainId: mailbox.domain_id || null,
      mailboxId: mailbox.id || null,
      threadId: selectedThread.id,
      fromAddress: mailbox.email_address || '',
      to: mode === 'forward' ? [] : [{ email: latest.from_json?.email || '', name: latest.from_json?.name || '' }],
      cc: [],
      bcc: [],
      subject: `${mode === 'forward' ? 'Fwd' : 'Re'}: ${selectedThread.subject || ''}`,
      textBody: mode === 'forward' ? `Forwarding message.${quoteThread(selectedThread)}` : quoteThread(selectedThread),
      htmlBody: '',
      attachments: [],
      editorMode: 'rich',
      aiProvider: getConnection(data.connections, 'groq') ? 'groq' : 'gemini',
      aiModel: GEMINI_MODEL_OPTIONS[0].id,
      aiTone: AI_TONE_OPTIONS[0].id,
      aiPrompt: '',
      templateId: null,
    };
  }

  async function handleThreadAction(action: 'archive' | 'trash' | 'delete') {
    if (!selectedThread) throw new Error('Select a thread first.');
    setStatus(action === 'delete' ? 'Deleting thread...' : 'Updating thread...');
    await api(`/api/threads/${selectedThread.id}/actions`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    setSelectedThread(null);
    await loadThreadsAction(folder, mailboxId, searchQuery, { preserveSelection: false });
  }

  async function emptyTrash() {
    setStatus('Emptying trash...');
    await api('/api/threads/actions', {
      method: 'POST',
      body: JSON.stringify({ action: 'empty_trash' }),
    });
    setSelectedThread(null);
    await loadThreadsAction('trash', mailboxId, searchQuery, { preserveSelection: false });
    setStatus('Trash emptied.');
  }

  async function saveConnection(provider: 'cloudflare' | 'resend' | 'gemini' | 'groq', input: Record<string, unknown>) {
    setStatus(`Saving ${provider} connection...`);
    await api(`/api/providers/${provider}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    await refreshBootstrap();
    if (provider === 'cloudflare') {
      await loadZones();
    }
    setStatus(`${provider} connected.`);
  }

  async function provisionDomain(input: Record<string, unknown>) {
    setStatus('Provisioning domain...');
    await api('/api/domains', { method: 'POST', body: JSON.stringify(input) });
    await refreshBootstrap();
    await loadZones();
    setStatus('Domain provisioned.');
  }

  async function refreshDomain(domainId: string) {
    setStatus('Refreshing domain status...');
    await api(`/api/domains/${domainId}/refresh`, { method: 'POST', body: JSON.stringify({}) });
    await refreshBootstrap();
    setStatus('Domain refreshed.');
  }

  async function selectSendingDomain(domainId: string) {
    setStatus('Selecting sending domain...');
    await api(`/api/domains/${domainId}/select-sending`, { method: 'POST', body: JSON.stringify({}) });
    await refreshBootstrap();
    setStatus('Sending domain updated.');
  }

  async function repairDomainRouting(domainId: string) {
    setStatus('Repairing routing...');
    await api(`/api/domains/${domainId}/repair-routing`, { method: 'POST', body: JSON.stringify({}) });
    await refreshBootstrap();
    setStatus('Routing repair finished.');
  }

  async function saveMailbox(mailboxIdValue: string | null, input: Record<string, unknown>) {
    setStatus(mailboxIdValue ? 'Saving mailbox...' : 'Creating mailbox...');
    await api(mailboxIdValue ? `/api/mailboxes/${mailboxIdValue}` : '/api/mailboxes', {
      method: mailboxIdValue ? 'PATCH' : 'POST',
      body: JSON.stringify(input),
    });
    await refreshBootstrap();
    setStatus(mailboxIdValue ? 'Mailbox updated.' : 'Mailbox created.');
  }

  async function deleteMailbox(mailboxIdValue: string) {
    setStatus('Deleting mailbox...');
    await api(`/api/mailboxes/${mailboxIdValue}`, { method: 'DELETE' });
    await refreshBootstrap();
    setStatus('Mailbox deleted.');
  }

  async function saveTemplate(templateId: string | null, input: Record<string, unknown>) {
    setStatus(templateId ? 'Saving HTML template...' : 'Creating HTML template...');
    await api(templateId ? `/api/html-templates/${templateId}` : '/api/html-templates', {
      method: templateId ? 'PATCH' : 'POST',
      body: JSON.stringify(input),
    });
    await loadHtmlTemplates();
    setStatus(templateId ? 'HTML template updated.' : 'HTML template created.');
  }

  async function deleteTemplate(templateId: string) {
    setStatus('Deleting HTML template...');
    await api(`/api/html-templates/${templateId}`, { method: 'DELETE' });
    await loadHtmlTemplates();
    setStatus('HTML template deleted.');
  }

  async function saveAliasRule(input: Record<string, unknown>) {
    setStatus('Saving alias rule...');
    await api('/api/aliases', { method: 'POST', body: JSON.stringify(input) });
    await Promise.all([refreshBootstrap(), loadAliases(), loadForwardDestinations()]);
    setStatus('Alias rule saved.');
  }

  async function deleteAliasRule(aliasId: string) {
    setStatus('Deleting alias rule...');
    await api(`/api/aliases/${aliasId}`, { method: 'DELETE' });
    await loadAliases();
    setStatus('Alias deleted.');
  }

  async function saveForwardDestination(input: Record<string, unknown>) {
    setStatus('Saving forward destination...');
    await api('/api/forward-destinations', { method: 'POST', body: JSON.stringify(input) });
    await loadForwardDestinations();
    setStatus('Forward destination saved.');
  }

  async function deleteDraft(draftId: string) {
    setStatus('Deleting draft...');
    await api(`/api/drafts/${draftId}`, { method: 'DELETE' });
    setData((current) => ({
      ...current,
      drafts: current.drafts.filter((draft) => draft.id !== draftId),
    }));
    if (composeSeed?.id === draftId) {
      setComposeSeed(null);
    }
    setStatus('Draft deleted.');
  }

  async function saveComposeDraft(draft: ComposeDraft, quiet = false): Promise<DraftRecord | null> {
    const payload = await api<{ draft?: DraftRecord }>('/api/drafts', {
      method: 'POST',
      body: JSON.stringify(draft),
    });
    if (!payload.draft) return null;
    setData((current) => {
      const nextDrafts = [payload.draft as DraftRecord, ...current.drafts.filter((item) => item.id !== payload.draft?.id)];
      return { ...current, drafts: nextDrafts };
    });
    if (!quiet) {
      setStatus('Draft saved.');
    }
    return payload.draft || null;
  }

  async function uploadComposeAttachments(draft: ComposeDraft, files: FileList | File[]): Promise<UploadedAttachment[]> {
    const list = Array.from(files || []);
    if (!list.length) return draft.attachments;
    let nextAttachments = [...draft.attachments];
    for (const file of list) {
      const formData = new FormData();
      formData.append('file', file);
      const payload = await api<{ attachment: UploadedAttachment }>('/api/uploads', {
        method: 'POST',
        body: formData,
      });
      nextAttachments = [...nextAttachments, payload.attachment];
    }
    return nextAttachments;
  }

  async function runComposeAiAction(draft: ComposeDraft, action: string, selectionText = ''): Promise<AiActionResult> {
    const payload = await api<{ result?: AiActionResult }>('/api/ai/assist', {
      method: 'POST',
      body: JSON.stringify({
        provider: draft.aiProvider,
        model: draft.aiProvider === 'gemini' ? draft.aiModel : null,
        tone: draft.aiTone,
        action,
        prompt: draft.aiPrompt || '',
        outputMode: draft.editorMode === 'html' ? 'html_email' : 'plain_text',
        subject: draft.subject,
        textBody: draft.editorMode === 'html' ? draft.htmlBody : draft.textBody,
        htmlBody: draft.htmlBody || '',
        selectionText,
        to: draft.to || [],
        cc: draft.cc || [],
        bcc: draft.bcc || [],
      }),
    });
    return payload.result || {};
  }

  async function sendCompose(draft: ComposeDraft) {
    setStatus('Sending message...');
    await api('/api/send', {
      method: 'POST',
      body: JSON.stringify({
        ...draft,
        draftId: draft.id || null,
      }),
    });
    setComposeSeed(null);
    await refreshBootstrap();
    if (view === 'mail' && folder === 'sent') {
      await loadThreadsAction('sent', mailboxId, searchQuery);
    }
    setStatus('Message sent.');
  }

  async function downloadAttachment(attachmentId: string) {
    const response = await apiBlob(`/api/attachments/${attachmentId}`);
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'attachment';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function runSearch() {
    if (view !== 'mail') return;
    await loadThreadsAction(folder, mailboxId, searchQuery);
  }

  async function signInWithGoogle() {
    if (!authRef.current || !providerRef.current) return;
    setLoginMessage('Opening Google sign-in...');
    await signInWithPopup(authRef.current, providerRef.current);
  }

  async function signOutAction() {
    if (!authRef.current) return;
    await firebaseSignOut(authRef.current);
  }

  useEffect(() => {
    let active = true;
    async function boot() {
      try {
        const runtimeConfig = await fetchRuntimeConfig();
        if (!active) return;
        setRuntime(runtimeConfig);
        setLoginMessage('Ready for Google sign-in.');
        const config = normalizeFirebaseConfig(runtimeConfig.firebase);
        if (!config.apiKey || !config.projectId) {
          setLoginMessage('Firebase runtime configuration is incomplete.');
          setBooting(false);
          return;
        }
        const firebaseApp = initializeApp(config);
        const auth = getAuth(firebaseApp);
        const provider = new GoogleAuthProvider();
        authRef.current = auth;
        providerRef.current = provider;

        onIdTokenChanged(auth, async (firebaseUser: User | null) => {
          if (!active) return;
          try {
            if (!firebaseUser) {
              setUser(null);
              tokenRef.current = '';
              setData(EMPTY_DATA);
              setThreads([]);
              setSelectedThread(null);
              setComposeSeed(null);
              disconnectRealtime();
              setLoginMessage('Sign in to continue.');
              setBooting(false);
              return;
            }

            tokenRef.current = await firebaseUser.getIdToken();
            setBooting(false);
            await refreshBootstrap();
            await loadZones();
            connectRealtime().catch(showError);
          } catch (error) {
            showError(error);
          }
        });

        setBooting(false);
      } catch (error) {
        showError(error);
      }
    }

    boot().catch(showError);
    return () => {
      active = false;
      disconnectRealtime();
    };
  }, []);

  return {
    runtime,
    user,
    status,
    booting,
    loginMessage,
    view,
    folder,
    mailboxId,
    searchQuery,
    data,
    zones,
    threads,
    selectedThread,
    composeSeed,
    alertCounts,
    selectedSendingDomainId,
    sendingDomainId,
    sendingStatusMessage,
    realtimeStatus,
    signInWithGoogle,
    signOut: signOutAction,
    refreshCurrentView,
    setSearchQuery,
    runSearch,
    switchView: async (target) => {
      try {
        await switchViewAction(target);
      } catch (error) {
        showError(error);
        throw error;
      }
    },
    openMailboxInbox: async (targetMailboxId) => {
      try {
        await openMailboxInbox(targetMailboxId);
      } catch (error) {
        showError(error);
        throw error;
      }
    },
    selectThread: selectThreadAction,
    openCompose: async (payload) => {
      try {
        await openComposeAction(payload);
      } catch (error) {
        showError(error);
        throw error;
      }
    },
    closeCompose: () => setComposeSeed(null),
    openReply: async () => {
      try {
        setComposeSeed(buildReplyPayload('reply'));
      } catch (error) {
        showError(error);
        throw error;
      }
    },
    openForward: async () => {
      try {
        setComposeSeed(buildReplyPayload('forward'));
      } catch (error) {
        showError(error);
        throw error;
      }
    },
    archiveSelected: async () => {
      try {
        await handleThreadAction('archive');
      } catch (error) {
        showError(error);
        throw error;
      }
    },
    trashSelected: async () => {
      try {
        await handleThreadAction(folder === 'trash' ? 'delete' : 'trash');
      } catch (error) {
        showError(error);
        throw error;
      }
    },
    emptyTrash: async () => {
      try {
        await emptyTrash();
      } catch (error) {
        showError(error);
        throw error;
      }
    },
    downloadAttachment,
    saveConnection,
    provisionDomain,
    refreshDomain,
    selectSendingDomain,
    repairDomainRouting,
    saveMailbox,
    deleteMailbox,
    saveTemplate,
    deleteTemplate,
    saveAliasRule,
    deleteAliasRule,
    saveForwardDestination,
    deleteDraft,
    sendCompose,
    saveComposeDraft,
    uploadComposeAttachments,
    runComposeAiAction,
  };
}
