import { useEffect, useRef, useState } from 'react';
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onIdTokenChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { AI_TONE_OPTIONS, BOOT_REQUEST_TIMEOUT_MS, FALLBACK_FIREBASE_CONFIG, GEMINI_MODEL_OPTIONS } from '../lib/constants';
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
  CursorState,
  DomainRecord,
  DraftRecord,
  FolderId,
  FolderCounts,
  HtmlTemplateRecord,
  IngestFailureRecord,
  MailboxUnreadCounts,
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
  ingestFailures: [],
};
const EMPTY_FOLDER_COUNTS: FolderCounts = { inbox: 0, sent: 0, archive: 0, trash: 0, drafts: 0 };
const EMPTY_MAILBOX_UNREAD_COUNTS: MailboxUnreadCounts = {};
const EMPTY_CURSORS: CursorState = {
  threads: null,
  drafts: null,
  aliases: null,
  forwardDestinations: null,
  htmlTemplates: null,
  mailboxes: null,
  ingestFailures: null,
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

function resolveApiUrl(path: string, runtime: RuntimeConfig | null): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = runtime?.apiBaseUrl || window.location.origin;
  return new URL(path, base).toString();
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
  const [folderCounts, setFolderCounts] = useState<FolderCounts>(EMPTY_FOLDER_COUNTS);
  const [mailboxUnreadCounts, setMailboxUnreadCounts] = useState<MailboxUnreadCounts>(EMPTY_MAILBOX_UNREAD_COUNTS);
  const [cursors, setCursors] = useState<CursorState>(EMPTY_CURSORS);
  const [selectedSendingDomainId, setSelectedSendingDomainId] = useState<string | null>(null);
  const [sendingDomainId, setSendingDomainId] = useState<string | null>(null);
  const [sendingStatusMessage, setSendingStatusMessage] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<'idle' | 'connecting' | 'connected' | 'reconnecting'>('idle');

  const authRef = useRef<Auth | null>(null);
  const providerRef = useRef<GoogleAuthProvider | null>(null);
  const runtimeRef = useRef<RuntimeConfig | null>(null);
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

    const requestUrl = resolveApiUrl(path, runtimeRef.current);
    let response = await fetchWithTimeout(requestUrl, { ...options, headers });
    if (response.status === 401 && authRef.current?.currentUser) {
      const retryHeaders = new Headers(options.headers || {});
      if (!(options.body instanceof FormData)) {
        retryHeaders.set('Content-Type', retryHeaders.get('Content-Type') || 'application/json');
      }
      const refreshedToken = await getFreshToken(true);
      if (refreshedToken) retryHeaders.set('Authorization', `Bearer ${refreshedToken}`);
      response = await fetchWithTimeout(requestUrl, { ...options, headers: retryHeaders });
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
    const response = await fetchWithTimeout(resolveApiUrl(path, runtimeRef.current), { ...options, headers });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return response;
  }

  function showError(error: unknown) {
    const message = formatErrorMessage(error, runtimeRef.current);
    setStatus(message);
    if (!user) {
      setLoginMessage(message);
      setBooting(false);
    }
    console.error('app_error', serializeError(error, runtimeRef.current));
  }

  function serializeError(
    error: unknown,
    runtimeConfig: RuntimeConfig | null,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      origin: typeof window !== 'undefined' ? window.location.origin : null,
      host: typeof window !== 'undefined' ? window.location.host : null,
      authDomain: runtimeConfig?.firebase.authDomain || null,
      apiBaseUrl: runtimeConfig?.apiBaseUrl || null,
    };
    if (error instanceof Error) {
      payload.name = error.name;
      payload.message = error.message;
      payload.stack = error.stack || null;
    } else {
      payload.message = 'An unexpected error occurred.';
    }
    if (typeof error === 'object' && error) {
      const candidate = error as Record<string, unknown>;
      for (const key of ['code', 'email', 'operationType', 'tenantId']) {
        if (candidate[key] != null) payload[key] = candidate[key];
      }
      if (candidate.customData && typeof candidate.customData === 'object') {
        payload.customData = candidate.customData;
      }
      if (candidate.user && typeof candidate.user === 'object') {
        payload.user = candidate.user;
      }
    }
    return payload;
  }

  function formatErrorMessage(error: unknown, runtimeConfig: RuntimeConfig | null): string {
    const payload = serializeError(error, runtimeConfig);
    const parts: string[] = [];
    if (typeof payload.code === 'string' && payload.code) {
      parts.push(payload.code);
    }
    if (typeof payload.message === 'string' && payload.message) {
      parts.push(payload.message);
    }
    if (payload.customData && typeof payload.customData === 'object') {
      const customData = payload.customData as Record<string, unknown>;
      if (typeof customData._serverResponse === 'string' && customData._serverResponse) {
        parts.push(`server=${customData._serverResponse}`);
      }
      if (typeof customData._tokenResponse === 'string' && customData._tokenResponse) {
        parts.push(`token=${customData._tokenResponse}`);
      }
      if (typeof customData.email === 'string' && customData.email) {
        parts.push(`email=${customData.email}`);
      }
    }
    if (typeof payload.origin === 'string' && payload.origin) {
      parts.push(`origin=${payload.origin}`);
    }
    if (typeof payload.authDomain === 'string' && payload.authDomain) {
      parts.push(`authDomain=${payload.authDomain}`);
    }
    if (typeof payload.host === 'string' && payload.host) {
      parts.push(`handler=https://${payload.host}/__/auth/handler`);
    }
    return parts.join(' | ') || 'An unexpected error occurred.';
  }

  async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
    return fetchRuntimeConfigFrom('/api/runtime-config');
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

  async function loadHtmlTemplates(reset = true) {
    const query = new URLSearchParams({ limit: '50' });
    if (!reset && cursors.htmlTemplates) query.set('cursor', cursors.htmlTemplates);
    const payload = await api<{ items?: HtmlTemplateRecord[]; templates?: HtmlTemplateRecord[]; nextCursor?: string | null }>(
      `/api/html-templates?${query.toString()}`,
    );
    const items = payload.items || payload.templates || [];
    setData((current) => ({
      ...current,
      htmlTemplates: reset ? items : [...current.htmlTemplates, ...items],
    }));
    setCursors((current) => ({ ...current, htmlTemplates: payload.nextCursor || null }));
  }

  async function loadAliases(reset = true) {
    const query = new URLSearchParams({ limit: '50' });
    if (!reset && cursors.aliases) query.set('cursor', cursors.aliases);
    const payload = await api<{ items?: WorkspaceData['aliases']; aliases?: WorkspaceData['aliases']; nextCursor?: string | null }>(
      `/api/aliases?${query.toString()}`,
    );
    const items = payload.items || payload.aliases || [];
    setData((current) => ({
      ...current,
      aliases: reset ? items : [...current.aliases, ...items],
    }));
    setCursors((current) => ({ ...current, aliases: payload.nextCursor || null }));
  }

  async function loadForwardDestinations(reset = true) {
    const query = new URLSearchParams({ limit: '50' });
    if (!reset && cursors.forwardDestinations) query.set('cursor', cursors.forwardDestinations);
    const payload = await api<{
      items?: WorkspaceData['forwardDestinations'];
      forwardDestinations?: WorkspaceData['forwardDestinations'];
      nextCursor?: string | null;
    }>(`/api/forward-destinations?${query.toString()}`);
    const items = payload.items || payload.forwardDestinations || [];
    setData((current) => ({
      ...current,
      forwardDestinations: reset ? items : [...current.forwardDestinations, ...items],
    }));
    setCursors((current) => ({ ...current, forwardDestinations: payload.nextCursor || null }));
  }

  async function loadDrafts(reset = true) {
    const query = new URLSearchParams({ limit: '50' });
    if (!reset && cursors.drafts) query.set('cursor', cursors.drafts);
    const payload = await api<{ items?: DraftRecord[]; drafts?: DraftRecord[]; nextCursor?: string | null }>(
      `/api/drafts?${query.toString()}`,
    );
    const items = payload.items || payload.drafts || [];
    setData((current) => ({ ...current, drafts: reset ? items : [...current.drafts, ...items] }));
    setCursors((current) => ({ ...current, drafts: payload.nextCursor || null }));
  }

  async function loadMailboxes(reset = true) {
    const query = new URLSearchParams({ limit: '50' });
    if (!reset && cursors.mailboxes) query.set('cursor', cursors.mailboxes);
    const payload = await api<{ items?: MailboxRecord[]; mailboxes?: MailboxRecord[]; nextCursor?: string | null }>(
      `/api/mailboxes?${query.toString()}`,
    );
    const items = payload.items || payload.mailboxes || [];
    setData((current) => ({ ...current, mailboxes: reset ? items : [...current.mailboxes, ...items] }));
    setCursors((current) => ({ ...current, mailboxes: payload.nextCursor || null }));
  }

  async function loadIngestFailures(reset = true) {
    const query = new URLSearchParams({ limit: '25' });
    if (!reset && cursors.ingestFailures) query.set('cursor', cursors.ingestFailures);
    const payload = await api<{ items?: IngestFailureRecord[]; ingestFailures?: IngestFailureRecord[]; nextCursor?: string | null }>(
      `/api/ingest-failures?${query.toString()}`,
    );
    const items = payload.items || payload.ingestFailures || [];
    setData((current) => ({ ...current, ingestFailures: reset ? items : [...current.ingestFailures, ...items] }));
    setCursors((current) => ({ ...current, ingestFailures: payload.nextCursor || null }));
  }

  async function ensureViewData(targetView: ViewId = view) {
    if (targetView === 'domains') {
      await Promise.all([loadHtmlTemplates(), loadIngestFailures()]);
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
    options: { preserveSelection?: boolean; append?: boolean } = {},
  ) {
    if (!tokenRef.current && !authRef.current?.currentUser) return;
    setStatus(`Loading ${targetFolder}...`);
    const query = new URLSearchParams({ folder: targetFolder, limit: '50' });
    if (targetMailboxId) query.set('mailboxId', targetMailboxId);
    if (targetSearch.trim()) query.set('query', targetSearch.trim());
    if (options.append && cursors.threads) query.set('cursor', cursors.threads);
    const payload = await api<{ items?: ThreadSummary[]; threads?: ThreadSummary[]; nextCursor?: string | null }>(
      `/api/threads?${query.toString()}`,
    );
    const nextThreads = payload.items || payload.threads || [];
    setThreads((current) => (options.append ? [...current, ...nextThreads] : nextThreads));
    setCursors((current) => ({ ...current, threads: payload.nextCursor || null }));
    const preservedSelection = options.preserveSelection && selectedThread?.id
      ? (options.append ? [...threads, ...nextThreads] : nextThreads).find((thread) => thread.id === selectedThread.id)
      : null;
    if (preservedSelection) {
      await selectThreadAction(preservedSelection.id);
    } else {
      if (!options.append) {
        setSelectedThread(null);
      }
      setStatus(options.append ? `Loaded more ${targetFolder} threads.` : `Ready. ${nextThreads.length} thread(s) in ${targetFolder}.`);
    }
  }

  async function refreshBootstrap(options: { skipThreads?: boolean } = {}) {
    setStatus('Loading workspace...');
    const payload = await api<BootPayload>('/api/bootstrap');
    setUser(payload.user ? {
      ...payload.user,
      photo_url: authRef.current?.currentUser?.photoURL || user?.photo_url,
    } : null);
    setSelectedSendingDomainId(payload.selectedSendingDomainId || null);
    setSendingDomainId(payload.sendingDomainId || null);
    setSendingStatusMessage(payload.sendingStatusMessage || null);
    setAlertCounts(payload.alertCounts || EMPTY_ALERTS);
    setFolderCounts(payload.folderCounts || EMPTY_FOLDER_COUNTS);
    setMailboxUnreadCounts(payload.mailboxUnreadCounts || EMPTY_MAILBOX_UNREAD_COUNTS);
    setData((current) => ({
      ...current,
      connections: payload.connections || [],
      domains: payload.domains || [],
      mailboxes: payload.mailboxes || [],
      htmlTemplates: current.htmlTemplates,
      forwardDestinations: current.forwardDestinations,
      aliases: current.aliases,
      drafts: current.drafts,
      ingestFailures: current.ingestFailures,
    }));
    if (view === 'mail' && !options.skipThreads) {
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
      await refreshBootstrap({ skipThreads: true });
      return;
    }
    if (event.type === 'draft.updated' && view === 'drafts') {
      await loadDrafts();
      await refreshBootstrap({ skipThreads: true });
      return;
    }
    if (event.type === 'ingest.retrying' && view === 'domains') {
      await loadIngestFailures();
      await refreshBootstrap({ skipThreads: true });
      return;
    }
    if (event.type === 'routing.degraded' || event.type === 'routing.updated' || event.type === 'ingest.failed') {
      await refreshBootstrap({ skipThreads: view === 'mail' });
    }
  }

  async function connectRealtime() {
    if (!tokenRef.current && !authRef.current?.currentUser) return;
    disconnectRealtime();
    const sessionId = realtimeSessionRef.current;
    const token = await getFreshToken();
    if (!token) return;
    setRealtimeStatus('connecting');
    const socketUrl = new URL(resolveApiUrl('/api/realtime', runtimeRef.current));
    socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    socketUrl.searchParams.set('token', token);
    const socket = new WebSocket(socketUrl.toString());
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
      await Promise.all([loadHtmlTemplates(), loadZones(), loadIngestFailures(), refreshBootstrap({ skipThreads: true })]);
      return;
    } else {
      await refreshBootstrap({ skipThreads: true });
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

  async function handleThreadAction(action: 'archive' | 'trash' | 'delete' | 'restore' | 'mark_read' | 'mark_unread' | 'star' | 'unstar') {
    if (!selectedThread) throw new Error('Select a thread first.');
    const statusByAction = {
      archive: 'Archiving thread...',
      trash: 'Moving thread to trash...',
      delete: 'Deleting thread...',
      restore: 'Recovering thread from trash...',
      mark_read: 'Marking thread as read...',
      mark_unread: 'Marking thread as unread...',
      star: 'Starring thread...',
      unstar: 'Removing star...',
    } as const;
    setStatus(statusByAction[action]);
    await api(`/api/threads/${selectedThread.id}/actions`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    if (['archive', 'trash', 'delete', 'restore'].includes(action)) {
      setSelectedThread(null);
      await loadThreadsAction(folder, mailboxId, searchQuery, { preserveSelection: false });
    } else {
      await loadThreadsAction(folder, mailboxId, searchQuery, { preserveSelection: true });
    }
    await refreshBootstrap({ skipThreads: true });
    const successByAction = {
      archive: 'Thread archived.',
      trash: 'Thread moved to trash.',
      delete: 'Thread permanently deleted.',
      restore: 'Thread recovered from trash.',
      mark_read: 'Thread marked as read.',
      mark_unread: 'Thread marked as unread.',
      star: 'Thread starred.',
      unstar: 'Thread unstarred.',
    } as const;
    setStatus(successByAction[action]);
  }

  async function emptyTrash() {
    setStatus('Emptying trash...');
    await api('/api/threads/actions', {
      method: 'POST',
      body: JSON.stringify({ action: 'empty_trash' }),
    });
    setSelectedThread(null);
    await loadThreadsAction('trash', mailboxId, searchQuery, { preserveSelection: false });
    await refreshBootstrap({ skipThreads: true });
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
    let nextDraftCount = 0;
    setData((current) => {
      const nextDrafts = current.drafts.filter((draft) => draft.id !== draftId);
      nextDraftCount = nextDrafts.length;
      return {
        ...current,
        drafts: nextDrafts,
      };
    });
    if (composeSeed?.id === draftId) {
      setComposeSeed(null);
    }
    setFolderCounts((current) => ({ ...current, drafts: nextDraftCount }));
    setStatus('Draft deleted.');
  }

  async function deleteAllDrafts() {
    setStatus('Deleting all drafts...');
    await api('/api/drafts', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_all' }),
    });
    setData((current) => ({
      ...current,
      drafts: [],
    }));
    setComposeSeed((current) => (current?.id ? null : current));
    setFolderCounts((current) => ({ ...current, drafts: 0 }));
    setStatus('All drafts deleted.');
  }

  async function retryIngestFailure(ingestFailureId: string) {
    setStatus('Retrying ingest failure...');
    await api(`/api/ingest-failures/${ingestFailureId}/retry`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await loadIngestFailures();
    await refreshBootstrap({ skipThreads: true });
    setStatus('Ingest retry queued.');
  }

  async function loadMoreThreads() {
    if (!cursors.threads) return;
    await loadThreadsAction(folder, mailboxId, searchQuery, { preserveSelection: true, append: true });
  }

  async function loadMoreDrafts() {
    if (!cursors.drafts) return;
    await loadDrafts(false);
    setStatus('Loaded more drafts.');
  }

  async function loadMoreAliases() {
    if (!cursors.aliases) return;
    await loadAliases(false);
    setStatus('Loaded more aliases.');
  }

  async function loadMoreForwardDestinations() {
    if (!cursors.forwardDestinations) return;
    await loadForwardDestinations(false);
    setStatus('Loaded more destinations.');
  }

  async function loadMoreHtmlTemplates() {
    if (!cursors.htmlTemplates) return;
    await loadHtmlTemplates(false);
    setStatus('Loaded more templates.');
  }

  async function loadMoreMailboxes() {
    if (!cursors.mailboxes) return;
    await loadMailboxes(false);
    setStatus('Loaded more mailboxes.');
  }

  async function loadMoreIngestFailures() {
    if (!cursors.ingestFailures) return;
    await loadIngestFailures(false);
    setStatus('Loaded more ingest failures.');
  }

  async function saveComposeDraft(draft: ComposeDraft, quiet = false): Promise<DraftRecord | null> {
    if (!quiet) {
      setStatus('Saving draft...');
    }
    try {
      const payload = await api<{ draft?: DraftRecord }>('/api/drafts', {
        method: 'POST',
        body: JSON.stringify(draft),
      });
      if (!payload.draft) return null;
      let nextDraftCount = 0;
      setData((current) => {
        const nextDrafts = [payload.draft as DraftRecord, ...current.drafts.filter((item) => item.id !== payload.draft?.id)];
        nextDraftCount = nextDrafts.length;
        return { ...current, drafts: nextDrafts };
      });
      setFolderCounts((counts) => ({ ...counts, drafts: nextDraftCount }));
      if (!quiet) {
        setStatus('Draft saved.');
      }
      return payload.draft || null;
    } catch (error) {
      if (!quiet) {
        setStatus(error instanceof Error ? error.message : 'Draft save failed.');
      }
      throw error;
    }
  }

  async function uploadComposeAttachments(draft: ComposeDraft, files: FileList | File[]): Promise<UploadedAttachment[]> {
    const list = Array.from(files || []);
    if (!list.length) return draft.attachments;
    setStatus(list.length > 1 ? 'Uploading attachments...' : 'Uploading attachment...');
    try {
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
      setStatus(list.length > 1 ? 'Attachments uploaded.' : 'Attachment uploaded.');
      return nextAttachments;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Attachment upload failed.');
      throw error;
    }
  }

  async function runComposeAiAction(draft: ComposeDraft, action: string, selectionText = ''): Promise<AiActionResult> {
    const providerLabel = draft.aiProvider === 'groq' ? 'Llama' : 'Gemini';
    const actionLabel = action === 'compose'
      ? 'Generating draft'
      : action === 'proofread'
        ? 'Fixing grammar'
        : `${action.charAt(0).toUpperCase()}${action.slice(1)} text`;
    setStatus(`${actionLabel} with ${providerLabel}...`);
    try {
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
      const result = payload.result || {};
      const hasOutput = Boolean(
        String(result.subject || '').trim()
        || String(result.textBody || '').trim()
        || String(result.htmlBody || '').trim()
        || String(result.replacementText || '').trim(),
      );
      if (!hasOutput) {
        throw new Error(`${providerLabel} returned an empty response.`);
      }
      setStatus('AI draft ready.');
      return result;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${providerLabel} generation failed.`);
      throw error;
    }
  }

  async function sendCompose(draft: ComposeDraft) {
    setStatus('Sending message...');
    try {
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
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Message send failed.');
      throw error;
    }
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
    setStatus('Opening Google sign-in...');
    try {
      await signInWithPopup(authRef.current, providerRef.current);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: string }).code || '') : '';
      if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request') {
        setLoginMessage('Popup blocked. Redirecting to Google sign-in...');
        setStatus('Redirecting to Google sign-in...');
        await signInWithRedirect(authRef.current, providerRef.current);
        return;
      }
      if (code === 'auth/popup-closed-by-user') {
        setLoginMessage('Google sign-in popup was closed.');
        setStatus('Ready for Google sign-in.');
        return;
      }
      if (code === 'auth/unauthorized-domain') {
        const host = window.location.hostname;
        const message = `Firebase Google sign-in is not authorized for ${host}. Add this domain in Firebase Auth > Settings > Authorized domains.`;
        setLoginMessage(message);
        setStatus(message);
        return;
      }
      showError(error);
      throw error;
    }
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
        runtimeRef.current = runtimeConfig;
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
              setFolderCounts(EMPTY_FOLDER_COUNTS);
              setMailboxUnreadCounts(EMPTY_MAILBOX_UNREAD_COUNTS);
              setCursors(EMPTY_CURSORS);
              disconnectRealtime();
              setLoginMessage('Sign in to continue.');
              setStatus('Ready for Google sign-in.');
              setBooting(false);
              return;
            }

            tokenRef.current = await firebaseUser.getIdToken();
            setBooting(false);
            setStatus('Loading workspace...');
            await refreshBootstrap();
            setUser((current) => current ? {
              ...current,
              photo_url: firebaseUser.photoURL || current.photo_url,
            } : current);
            await loadZones();
            connectRealtime().catch(showError);
          } catch (error) {
            showError(error);
          }
        });

        setStatus('Ready for Google sign-in.');
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
    folderCounts,
    mailboxUnreadCounts,
    cursors,
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
    restoreSelected: async () => {
      try {
        await handleThreadAction('restore');
      } catch (error) {
        showError(error);
        throw error;
      }
    },
    restoreArchivedSelected: async () => {
      try {
        await handleThreadAction('restore');
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
    starSelected: async () => {
      try {
        await handleThreadAction(selectedThread?.starred ? 'unstar' : 'star');
      } catch (error) {
        showError(error);
        throw error;
      }
    },
    markReadSelected: async () => {
      try {
        await handleThreadAction('mark_read');
      } catch (error) {
        showError(error);
        throw error;
      }
    },
    markUnreadSelected: async () => {
      try {
        await handleThreadAction('mark_unread');
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
    deleteAllDrafts,
    retryIngestFailure,
    loadMoreThreads,
    loadMoreDrafts,
    loadMoreAliases,
    loadMoreForwardDestinations,
    loadMoreHtmlTemplates,
    loadMoreMailboxes,
    loadMoreIngestFailures,
    sendCompose,
    saveComposeDraft,
    uploadComposeAttachments,
    runComposeAiAction,
  };
}
