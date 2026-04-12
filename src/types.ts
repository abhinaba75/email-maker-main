export type ViewId = 'mail' | 'connections' | 'domains' | 'aliases' | 'destinations' | 'drafts';
export type FolderId = 'inbox' | 'sent' | 'archive' | 'trash';
export type ComposeMode = 'rich' | 'html';
export type HtmlPanelMode = 'visual' | 'split' | 'source';
export type AiProviderId = 'gemini' | 'groq';

export interface RuntimeFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId: string;
}

export interface RuntimeConfig {
  firebase: RuntimeFirebaseConfig;
  googleClientId: string;
  appName?: string;
  apiBaseUrl?: string;
}

export interface UserSummary {
  id: string;
  email: string;
  display_name?: string;
  photo_url?: string;
}

export interface AddressEntry {
  email: string;
  name?: string;
}

export interface ConnectionSummary {
  id: string;
  provider: 'cloudflare' | 'resend' | 'gemini' | 'groq' | string;
  label: string;
  secretMask?: string;
  metadata?: Record<string, unknown>;
}

export interface DomainRecord {
  id: string;
  hostname: string;
  label?: string;
  routing_status: string;
  routing_error?: string | null;
  routing_checked_at?: number | null;
  resend_status?: string;
  send_capability?: string;
  sendCapability?: string;
  canSend?: boolean;
  isSelectedSendingDomain?: boolean;
  account_id?: string;
  emailWorkerBound?: boolean;
  mxStatus?: string;
  catchAllStatus?: string;
  catchAllPreview?: string | null;
  routingRuleStatus?: string;
  routingReady?: boolean;
  dnsIssues?: Array<{ type?: string; name?: string; value?: string; status?: string }>;
  resendDnsRecords?: Array<{
    record?: string;
    name?: string;
    type?: string;
    value?: string;
    status?: string;
    ttl?: number | null;
    priority?: number | null;
  }>;
  resendDnsStatus?: string;
  lastRoutingCheckAt?: number | null;
  diagnosticError?: string | null;
}

export interface MailboxRecord {
  id: string;
  domain_id: string;
  local_part: string;
  email_address: string;
  display_name?: string;
  signature_text?: string;
  signature_html?: string;
  is_default_sender?: boolean;
}

export interface HtmlTemplateRecord {
  id: string;
  domain_id?: string | null;
  name: string;
  subject?: string;
  html_content: string;
  created_at?: string;
  updated_at?: string;
}

export interface ForwardDestinationRecord {
  id: string;
  email: string;
  display_name?: string;
  verification_state?: string;
}

export interface AliasRuleRecord {
  id: string;
  hostname: string;
  local_part?: string;
  is_catch_all?: boolean;
  mode: string;
  mailbox_email?: string;
  forward_destination_json?: string[];
}

export interface DraftRecord {
  id: string;
  domain_id?: string | null;
  mailbox_id?: string | null;
  thread_id?: string | null;
  from_address?: string;
  to_json?: AddressEntry[];
  cc_json?: AddressEntry[];
  bcc_json?: AddressEntry[];
  subject?: string;
  text_body?: string;
  html_body?: string;
  attachment_json?: UploadedAttachment[];
  updated_at?: string;
}

export interface UploadedAttachment {
  id: string;
  fileName: string;
  file_name?: string;
  contentType?: string;
  content_type?: string;
  mimeType?: string;
  mime_type?: string;
  size?: number;
  byteSize?: number;
  byte_size?: number;
  r2Key?: string;
  r2_key?: string;
  publicUrl?: string;
  public_url?: string;
}

export interface ThreadSummary {
  id: string;
  domain_id?: string;
  mailbox_id?: string;
  mailbox_email?: string;
  hostname?: string;
  subject?: string;
  snippet?: string;
  latest_message_at?: string;
  unread_count?: number;
  starred?: number;
  folder?: string;
}

export interface MessageRecord {
  id: string;
  from_json?: AddressEntry;
  to_json?: AddressEntry[];
  cc_json?: AddressEntry[];
  sent_at?: string;
  received_at?: string;
  created_at?: string;
  subject?: string;
  text_body?: string;
  html_body?: string;
  snippet?: string;
  attachments?: UploadedAttachment[];
}

export interface ThreadDetail extends ThreadSummary {
  messages: MessageRecord[];
}

export interface ZoneRecord {
  id: string;
  name: string;
}

export interface AlertCounts {
  routingDegraded: number;
  ingestFailures: number;
}

export interface FolderCounts {
  inbox: number;
  sent: number;
  archive: number;
  trash: number;
  drafts: number;
}

export type MailboxUnreadCounts = Record<string, number>;

export interface IngestFailureRecord {
  id: string;
  user_id?: string | null;
  domain_id?: string | null;
  recipient: string;
  message_id?: string | null;
  raw_r2_key: string;
  reason: string;
  payload_json?: Record<string, unknown>;
  first_seen_at?: number;
  last_seen_at?: number;
  retry_count?: number;
  resolved_at?: number | null;
}

export interface BootPayload {
  user: UserSummary;
  connections: ConnectionSummary[];
  domains: DomainRecord[];
  mailboxes: MailboxRecord[];
  folderCounts?: FolderCounts;
  mailboxUnreadCounts?: MailboxUnreadCounts;
  selectedSendingDomainId?: string | null;
  sendingDomainId?: string | null;
  sendingStatusMessage?: string | null;
  alertCounts?: AlertCounts;
}

export interface WorkspaceData {
  connections: ConnectionSummary[];
  domains: DomainRecord[];
  mailboxes: MailboxRecord[];
  htmlTemplates: HtmlTemplateRecord[];
  forwardDestinations: ForwardDestinationRecord[];
  aliases: AliasRuleRecord[];
  drafts: DraftRecord[];
  ingestFailures: IngestFailureRecord[];
}

export interface CursorState {
  threads: string | null;
  drafts: string | null;
  aliases: string | null;
  forwardDestinations: string | null;
  htmlTemplates: string | null;
  mailboxes: string | null;
  ingestFailures: string | null;
}

export interface ComposeDraft {
  id: string | null;
  domainId: string | null;
  mailboxId: string | null;
  threadId: string | null;
  fromAddress: string;
  to: AddressEntry[];
  cc: AddressEntry[];
  bcc: AddressEntry[];
  subject: string;
  textBody: string;
  htmlBody: string;
  attachments: UploadedAttachment[];
  editorMode: ComposeMode;
  aiProvider: AiProviderId;
  aiModel: string;
  aiTone: string;
  aiPrompt: string;
  templateId: string | null;
}

export interface SidebarItem {
  id: string;
  label: string;
  meta: string;
}

export interface SidebarGroup {
  group: string;
  items: SidebarItem[];
}

export interface AiActionResult {
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  replacementText?: string;
}

export interface AppController {
  runtime: RuntimeConfig | null;
  user: UserSummary | null;
  status: string;
  booting: boolean;
  loginMessage: string;
  view: ViewId;
  folder: FolderId;
  mailboxId: string | null;
  searchQuery: string;
  data: WorkspaceData;
  zones: ZoneRecord[];
  threads: ThreadSummary[];
  selectedThread: ThreadDetail | null;
  composeSeed: ComposeDraft | null;
  alertCounts: AlertCounts;
  folderCounts: FolderCounts;
  mailboxUnreadCounts: MailboxUnreadCounts;
  cursors: CursorState;
  selectedSendingDomainId: string | null;
  sendingDomainId: string | null;
  sendingStatusMessage: string | null;
  realtimeStatus: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshCurrentView: () => Promise<void>;
  setSearchQuery: (value: string) => void;
  runSearch: () => Promise<void>;
  switchView: (target: string) => Promise<void>;
  openMailboxInbox: (mailboxId: string) => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  openCompose: (payload?: Partial<ComposeDraft> | DraftRecord) => Promise<void>;
  closeCompose: () => void;
  openReply: () => Promise<void>;
  openForward: () => Promise<void>;
  archiveSelected: () => Promise<void>;
  restoreSelected: () => Promise<void>;
  restoreArchivedSelected: () => Promise<void>;
  trashSelected: () => Promise<void>;
  starSelected: () => Promise<void>;
  markReadSelected: () => Promise<void>;
  markUnreadSelected: () => Promise<void>;
  emptyTrash: () => Promise<void>;
  downloadAttachment: (attachmentId: string) => Promise<void>;
  saveConnection: (provider: 'cloudflare' | 'resend' | 'gemini' | 'groq', input: Record<string, unknown>) => Promise<void>;
  provisionDomain: (input: Record<string, unknown>) => Promise<void>;
  refreshDomain: (domainId: string) => Promise<void>;
  selectSendingDomain: (domainId: string) => Promise<void>;
  repairDomainRouting: (domainId: string) => Promise<void>;
  saveMailbox: (mailboxId: string | null, input: Record<string, unknown>) => Promise<void>;
  deleteMailbox: (mailboxId: string) => Promise<void>;
  saveTemplate: (templateId: string | null, input: Record<string, unknown>) => Promise<void>;
  deleteTemplate: (templateId: string) => Promise<void>;
  saveAliasRule: (input: Record<string, unknown>) => Promise<void>;
  deleteAliasRule: (aliasId: string) => Promise<void>;
  saveForwardDestination: (input: Record<string, unknown>) => Promise<void>;
  deleteDraft: (draftId: string) => Promise<void>;
  deleteAllDrafts: () => Promise<void>;
  retryIngestFailure: (ingestFailureId: string) => Promise<void>;
  loadMoreThreads: () => Promise<void>;
  loadMoreDrafts: () => Promise<void>;
  loadMoreAliases: () => Promise<void>;
  loadMoreForwardDestinations: () => Promise<void>;
  loadMoreHtmlTemplates: () => Promise<void>;
  loadMoreMailboxes: () => Promise<void>;
  loadMoreIngestFailures: () => Promise<void>;
  sendCompose: (draft: ComposeDraft) => Promise<void>;
  saveComposeDraft: (draft: ComposeDraft, quiet?: boolean) => Promise<DraftRecord | null>;
  uploadComposeAttachments: (draft: ComposeDraft, files: FileList | File[]) => Promise<UploadedAttachment[]>;
  runComposeAiAction: (draft: ComposeDraft, action: string, selectionText?: string) => Promise<AiActionResult>;
}
