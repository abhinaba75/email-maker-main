PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT,
  photo_url TEXT,
  selected_sending_domain_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'connected',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, provider),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  hostname TEXT NOT NULL,
  label TEXT NOT NULL,
  resend_domain_id TEXT,
  resend_status TEXT NOT NULL DEFAULT 'not_started',
  send_capability TEXT NOT NULL DEFAULT 'send_unavailable',
  routing_status TEXT NOT NULL DEFAULT 'pending',
  catch_all_mode TEXT NOT NULL DEFAULT 'inbox_only',
  catch_all_mailbox_id TEXT,
  catch_all_forward_json TEXT NOT NULL DEFAULT '[]',
  ingest_destination_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, hostname),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  local_part TEXT NOT NULL,
  email_address TEXT NOT NULL,
  display_name TEXT NOT NULL,
  signature_html TEXT NOT NULL DEFAULT '',
  signature_text TEXT NOT NULL DEFAULT '',
  is_default_sender INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(domain_id, local_part),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS forward_destinations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  cloudflare_destination_id TEXT,
  verification_state TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, email),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alias_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  mailbox_id TEXT,
  local_part TEXT,
  is_catch_all INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL,
  ingress_address TEXT NOT NULL,
  forward_destination_json TEXT NOT NULL DEFAULT '[]',
  cloudflare_rule_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alias_rules_domain_local
  ON alias_rules(domain_id, local_part, is_catch_all);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  mailbox_id TEXT,
  folder TEXT NOT NULL DEFAULT 'inbox',
  subject TEXT NOT NULL DEFAULT '',
  subject_normalized TEXT NOT NULL DEFAULT '',
  participants_json TEXT NOT NULL DEFAULT '[]',
  snippet TEXT NOT NULL DEFAULT '',
  latest_message_at INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  unread_count INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_threads_user_folder_latest
  ON threads(user_id, folder, latest_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  mailbox_id TEXT,
  alias_rule_id TEXT,
  direction TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT 'inbox',
  internet_message_id TEXT,
  provider_message_id TEXT,
  from_json TEXT NOT NULL DEFAULT '{}',
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  subject_normalized TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  raw_r2_key TEXT,
  references_json TEXT NOT NULL DEFAULT '[]',
  in_reply_to TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER,
  received_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE SET NULL,
  FOREIGN KEY (alias_rule_id) REFERENCES alias_rules(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_thread_created
  ON messages(thread_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_messages_message_id
  ON messages(internet_message_id);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  message_id TEXT,
  draft_id TEXT,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  content_id TEXT,
  disposition TEXT NOT NULL DEFAULT 'attachment',
  r2_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  mailbox_id TEXT,
  thread_id TEXT,
  from_address TEXT NOT NULL,
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  attachment_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE SET NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_domains_user ON domains(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mailboxes_domain ON mailboxes(domain_id, email_address);
CREATE INDEX IF NOT EXISTS idx_forward_destinations_user ON forward_destinations(user_id, email);
CREATE INDEX IF NOT EXISTS idx_alias_rules_user ON alias_rules(user_id, domain_id, created_at DESC);
