export const BOOT_REQUEST_TIMEOUT_MS = 10000;
export const API_REQUEST_TIMEOUT_MS = 15000;

export const FALLBACK_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBfK7282grn32ZmkPYT-4Kzu-2M-kLaYt4',
  authDomain: 'email-maker-forge-ad61.firebaseapp.com',
  projectId: 'email-maker-forge-ad61',
  appId: '1:150955610279:web:a3f135ff4101c767f74b82',
  messagingSenderId: '150955610279',
};

export const FALLBACK_GOOGLE_CLIENT_ID = '150955610279-rv9ukdq7ruih96q7vlqmi67uh1isr50d.apps.googleusercontent.com';

export const GEMINI_MODEL_OPTIONS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
] as const;

export const AI_TONE_OPTIONS = [
  { id: 'professional', label: 'Professional' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'formal', label: 'Formal' },
  { id: 'concise', label: 'Concise' },
  { id: 'persuasive', label: 'Persuasive' },
  { id: 'empathetic', label: 'Empathetic' },
  { id: 'confident', label: 'Confident' },
  { id: 'upbeat', label: 'Upbeat' },
] as const;

export const SIDEBAR_GROUPS = [
  {
    group: 'Mail',
    items: [
      { id: 'mail:inbox', label: 'Inbox', meta: 'All incoming threads' },
      { id: 'mail:sent', label: 'Sent', meta: 'Delivered mail' },
      { id: 'drafts', label: 'Drafts', meta: 'Saved drafts' },
      { id: 'mail:archive', label: 'Archive', meta: 'Archived conversations' },
      { id: 'mail:trash', label: 'Trash', meta: 'Deleted messages' },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { id: 'connections', label: 'Connections', meta: 'Providers and AI' },
      { id: 'destinations', label: 'Forwarding', meta: 'Verified destinations' },
    ],
  },
  {
    group: 'Domains',
    items: [
      { id: 'domains', label: 'Domains & Mailboxes', meta: 'Sending, templates, inboxes' },
      { id: 'aliases', label: 'Aliases & Routing', meta: 'Rules and catch-all' },
    ],
  },
] as const;
