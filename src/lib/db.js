import { buildSnippet, createId, findThreadFingerprint, normalizeFolder, normalizeSubject, parseAddressList } from './mail.js';
import { SCHEMA_SQL } from './schema.js';

const JSON_FIELDS = {
  provider_connections: ['metadata_json'],
  domains: ['catch_all_forward_json'],
  alias_rules: ['forward_destination_json'],
  threads: ['participants_json'],
  messages: ['from_json', 'to_json', 'cc_json', 'bcc_json', 'references_json'],
  drafts: ['to_json', 'cc_json', 'bcc_json', 'attachment_json'],
};

const SEND_CAPABILITIES = new Set(['send_enabled', 'receive_only', 'send_unavailable']);

let schemaPromise;

function splitSqlStatements(sql) {
  return String(sql || '')
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeJson(value) {
  return JSON.stringify(value ?? []);
}

function normalizeSendCapability(value) {
  return SEND_CAPABILITIES.has(value) ? value : 'send_unavailable';
}

function decorateDomain(row) {
  const sendCapability = normalizeSendCapability(row.send_capability || row.sendCapability);
  return {
    ...row,
    send_capability: sendCapability,
    sendCapability,
    canSend: sendCapability === 'send_enabled',
  };
}

function mapRow(table, row) {
  if (!row) return null;
  const next = { ...row };
  for (const field of JSON_FIELDS[table] || []) {
    const fallback = field === 'metadata_json' || field === 'from_json' ? {} : [];
    next[field] = parseJson(next[field], fallback);
  }
  if (table === 'domains') {
    return decorateDomain(next);
  }
  return next;
}

async function first(stmt) {
  const row = await stmt.first();
  return row || null;
}

async function all(stmt) {
  const result = await stmt.all();
  return result.results || [];
}

async function hasColumn(db, tableName, columnName) {
  const columns = await all(db.prepare(`PRAGMA table_info(${tableName})`));
  return columns.some((column) => column.name === columnName);
}

export function ensureSchema(db) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (const statement of splitSqlStatements(SCHEMA_SQL)) {
        await db.prepare(statement).run();
      }

      if (!(await hasColumn(db, 'domains', 'send_capability'))) {
        await db
          .prepare(`ALTER TABLE domains ADD COLUMN send_capability TEXT NOT NULL DEFAULT 'send_unavailable'`)
          .run();
      }
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

export async function upsertUser(db, user) {
  const timestamp = Date.now();
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, photo_url, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         display_name = excluded.display_name,
         photo_url = excluded.photo_url,
         updated_at = excluded.updated_at`,
    )
    .bind(user.id, user.email, user.displayName || '', user.photoUrl || '', timestamp)
    .run();
  return getUser(db, user.id);
}

export async function getUser(db, userId) {
  return first(db.prepare('SELECT * FROM users WHERE id = ?1').bind(userId));
}

export async function listConnections(db, userId) {
  const rows = await all(
    db.prepare(
      `SELECT id, provider, label, metadata_json, status, created_at, updated_at
       FROM provider_connections
       WHERE user_id = ?1
       ORDER BY provider ASC`,
    ).bind(userId),
  );
  return rows.map((row) => mapRow('provider_connections', row));
}

export async function getConnection(db, userId, provider) {
  const row = await first(
    db.prepare(
      `SELECT * FROM provider_connections WHERE user_id = ?1 AND provider = ?2 LIMIT 1`,
    ).bind(userId, provider),
  );
  return mapRow('provider_connections', row);
}

export async function saveConnection(db, { id, userId, provider, label, secretCiphertext, metadata, status }) {
  const timestamp = Date.now();
  const connectionId = id || createId(`${provider}_`);
  await db
    .prepare(
      `INSERT INTO provider_connections (
         id, user_id, provider, label, secret_ciphertext, metadata_json, status, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
       ON CONFLICT(user_id, provider) DO UPDATE SET
         label = excluded.label,
         secret_ciphertext = excluded.secret_ciphertext,
         metadata_json = excluded.metadata_json,
         status = excluded.status,
         updated_at = excluded.updated_at`,
    )
    .bind(
      connectionId,
      userId,
      provider,
      label,
      secretCiphertext,
      JSON.stringify(metadata || {}),
      status || 'connected',
      timestamp,
    )
    .run();
  return getConnection(db, userId, provider);
}

export async function listDomains(db, userId) {
  const rows = await all(
    db.prepare(
      `SELECT d.*, m.email_address AS default_mailbox
       FROM domains d
       LEFT JOIN mailboxes m ON d.catch_all_mailbox_id = m.id
       WHERE d.user_id = ?1
       ORDER BY d.created_at DESC`,
    ).bind(userId),
  );
  return rows.map((row) => mapRow('domains', row));
}

export async function getDomain(db, userId, domainId) {
  const row = await first(
    db.prepare(`SELECT * FROM domains WHERE user_id = ?1 AND id = ?2`).bind(userId, domainId),
  );
  return mapRow('domains', row);
}

export async function createDomain(db, data) {
  const timestamp = Date.now();
  const id = data.id || createId('dom_');
  await db
    .prepare(
      `INSERT INTO domains (
         id, user_id, zone_id, account_id, hostname, label, resend_domain_id, resend_status,
         send_capability, routing_status, catch_all_mode, catch_all_mailbox_id, catch_all_forward_json,
         ingest_destination_id, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)`,
    )
    .bind(
      id,
      data.userId,
      data.zoneId,
      data.accountId,
      data.hostname,
      data.label,
      data.resendDomainId || null,
      data.resendStatus || 'not_started',
      normalizeSendCapability(data.sendCapability || data.send_capability),
      data.routingStatus || 'pending',
      data.catchAllMode || 'inbox_only',
      data.catchAllMailboxId || null,
      serializeJson(data.catchAllForwardIds || []),
      data.ingestDestinationId || null,
      timestamp,
    )
    .run();
  return getDomain(db, data.userId, id);
}

export async function updateDomain(db, userId, domainId, patch) {
  const current = await getDomain(db, userId, domainId);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
  };
  await db
    .prepare(
      `UPDATE domains
       SET hostname = ?3,
           label = ?4,
           resend_domain_id = ?5,
           resend_status = ?6,
           send_capability = ?7,
           routing_status = ?8,
           catch_all_mode = ?9,
           catch_all_mailbox_id = ?10,
           catch_all_forward_json = ?11,
           ingest_destination_id = ?12,
           updated_at = ?13
       WHERE user_id = ?1 AND id = ?2`,
    )
    .bind(
      userId,
      domainId,
      next.hostname,
      next.label,
      next.resend_domain_id || next.resendDomainId || null,
      next.resend_status || next.resendStatus || 'not_started',
      normalizeSendCapability(next.send_capability || next.sendCapability),
      next.routing_status || next.routingStatus || 'pending',
      next.catch_all_mode || next.catchAllMode || 'inbox_only',
      next.catch_all_mailbox_id || next.catchAllMailboxId || null,
      JSON.stringify(next.catch_all_forward_json || next.catchAllForwardIds || []),
      next.ingest_destination_id || next.ingestDestinationId || null,
      Date.now(),
    )
    .run();
  return getDomain(db, userId, domainId);
}

export async function listMailboxes(db, userId, domainId = null) {
  const stmt = domainId
    ? db.prepare(
        `SELECT * FROM mailboxes WHERE user_id = ?1 AND domain_id = ?2 ORDER BY is_default_sender DESC, email_address ASC`,
      ).bind(userId, domainId)
    : db.prepare(
        `SELECT * FROM mailboxes WHERE user_id = ?1 ORDER BY is_default_sender DESC, email_address ASC`,
      ).bind(userId);
  return all(stmt);
}

export async function getMailbox(db, userId, mailboxId) {
  return first(db.prepare(`SELECT * FROM mailboxes WHERE user_id = ?1 AND id = ?2`).bind(userId, mailboxId));
}

export async function createMailbox(db, data) {
  const timestamp = Date.now();
  const id = data.id || createId('mbx_');
  if (data.isDefaultSender) {
    await db.prepare(`UPDATE mailboxes SET is_default_sender = 0 WHERE domain_id = ?1`).bind(data.domainId).run();
  }
  await db
    .prepare(
      `INSERT INTO mailboxes (
         id, user_id, domain_id, local_part, email_address, display_name,
         signature_html, signature_text, is_default_sender, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
    )
    .bind(
      id,
      data.userId,
      data.domainId,
      data.localPart,
      data.emailAddress,
      data.displayName,
      data.signatureHtml || '',
      data.signatureText || '',
      data.isDefaultSender ? 1 : 0,
      timestamp,
    )
    .run();
  return getMailbox(db, data.userId, id);
}

export async function updateMailbox(db, userId, mailboxId, patch) {
  const current = await getMailbox(db, userId, mailboxId);
  if (!current) return null;
  if (patch.isDefaultSender) {
    await db.prepare(`UPDATE mailboxes SET is_default_sender = 0 WHERE domain_id = ?1`).bind(current.domain_id).run();
  }
  await db
    .prepare(
      `UPDATE mailboxes
       SET display_name = ?3,
           signature_html = ?4,
           signature_text = ?5,
           is_default_sender = ?6,
           updated_at = ?7
       WHERE user_id = ?1 AND id = ?2`,
    )
    .bind(
      userId,
      mailboxId,
      patch.displayName ?? current.display_name,
      patch.signatureHtml ?? current.signature_html,
      patch.signatureText ?? current.signature_text,
      patch.isDefaultSender ? 1 : 0,
      Date.now(),
    )
    .run();
  return getMailbox(db, userId, mailboxId);
}

export async function listForwardDestinations(db, userId) {
  return all(
    db.prepare(
      `SELECT * FROM forward_destinations WHERE user_id = ?1 ORDER BY email ASC`,
    ).bind(userId),
  );
}

export async function getForwardDestination(db, userId, destinationId) {
  return first(
    db.prepare(`SELECT * FROM forward_destinations WHERE user_id = ?1 AND id = ?2`).bind(userId, destinationId),
  );
}

export async function upsertForwardDestination(db, data) {
  const existing = await first(
    db.prepare(`SELECT * FROM forward_destinations WHERE user_id = ?1 AND email = ?2`).bind(data.userId, data.email),
  );
  const timestamp = Date.now();
  const id = existing?.id || data.id || createId('dst_');
  await db
    .prepare(
      `INSERT INTO forward_destinations (
         id, user_id, email, display_name, cloudflare_destination_id, verification_state, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT(user_id, email) DO UPDATE SET
         display_name = excluded.display_name,
         cloudflare_destination_id = excluded.cloudflare_destination_id,
         verification_state = excluded.verification_state,
         updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      data.userId,
      data.email,
      data.displayName || '',
      data.cloudflareDestinationId || null,
      data.verificationState || 'pending',
      timestamp,
    )
    .run();
  return getForwardDestination(db, data.userId, id);
}

export async function listAliasRules(db, userId, domainId = null) {
  const stmt = domainId
    ? db.prepare(
        `SELECT a.*, m.email_address AS mailbox_email, d.hostname
         FROM alias_rules a
         LEFT JOIN mailboxes m ON a.mailbox_id = m.id
         JOIN domains d ON a.domain_id = d.id
         WHERE a.user_id = ?1 AND a.domain_id = ?2
         ORDER BY a.is_catch_all DESC, a.local_part ASC`,
      ).bind(userId, domainId)
    : db.prepare(
        `SELECT a.*, m.email_address AS mailbox_email, d.hostname
         FROM alias_rules a
         LEFT JOIN mailboxes m ON a.mailbox_id = m.id
         JOIN domains d ON a.domain_id = d.id
         WHERE a.user_id = ?1
         ORDER BY d.hostname ASC, a.is_catch_all DESC, a.local_part ASC`,
      ).bind(userId);
  const rows = await all(stmt);
  return rows.map((row) => mapRow('alias_rules', row));
}

export async function getAliasRule(db, userId, aliasId) {
  const row = await first(
    db.prepare(
      `SELECT a.*, d.hostname
       FROM alias_rules a
       JOIN domains d ON d.id = a.domain_id
       WHERE a.user_id = ?1 AND a.id = ?2`,
    ).bind(userId, aliasId),
  );
  return mapRow('alias_rules', row);
}

export async function getAliasRuleByIngress(db, ingressAddress) {
  const row = await first(
    db.prepare(
      `SELECT a.*, d.hostname, d.user_id, m.email_address AS mailbox_email, m.display_name AS mailbox_display_name
       FROM alias_rules a
       JOIN domains d ON d.id = a.domain_id
       LEFT JOIN mailboxes m ON m.id = a.mailbox_id
       WHERE a.ingress_address = ?1
       LIMIT 1`,
    ).bind(ingressAddress),
  );
  return row ? mapRow('alias_rules', row) : null;
}

export async function createAliasRule(db, data) {
  const timestamp = Date.now();
  const id = data.id || createId('alr_');
  await db
    .prepare(
      `INSERT INTO alias_rules (
         id, user_id, domain_id, mailbox_id, local_part, is_catch_all, mode,
         ingress_address, forward_destination_json, cloudflare_rule_id, enabled, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)`,
    )
    .bind(
      id,
      data.userId,
      data.domainId,
      data.mailboxId || null,
      data.localPart || null,
      data.isCatchAll ? 1 : 0,
      data.mode,
      data.ingressAddress,
      JSON.stringify(data.forwardDestinationIds || []),
      data.cloudflareRuleId || null,
      data.enabled === false ? 0 : 1,
      timestamp,
    )
    .run();
  return getAliasRule(db, data.userId, id);
}

export async function updateAliasRule(db, userId, aliasId, patch) {
  const current = await getAliasRule(db, userId, aliasId);
  if (!current) return null;
  await db
    .prepare(
      `UPDATE alias_rules
       SET mailbox_id = ?3,
           local_part = ?4,
           is_catch_all = ?5,
           mode = ?6,
           ingress_address = ?7,
           forward_destination_json = ?8,
           cloudflare_rule_id = ?9,
           enabled = ?10,
           updated_at = ?11
       WHERE user_id = ?1 AND id = ?2`,
    )
    .bind(
      userId,
      aliasId,
      patch.mailboxId ?? current.mailbox_id,
      patch.localPart ?? current.local_part,
      patch.isCatchAll != null ? (patch.isCatchAll ? 1 : 0) : current.is_catch_all,
      patch.mode ?? current.mode,
      patch.ingressAddress ?? current.ingress_address,
      JSON.stringify(patch.forwardDestinationIds ?? current.forward_destination_json ?? []),
      patch.cloudflareRuleId ?? current.cloudflare_rule_id,
      patch.enabled != null ? (patch.enabled ? 1 : 0) : current.enabled,
      Date.now(),
    )
    .run();
  return getAliasRule(db, userId, aliasId);
}

export async function deleteAliasRule(db, userId, aliasId) {
  await db.prepare(`DELETE FROM alias_rules WHERE user_id = ?1 AND id = ?2`).bind(userId, aliasId).run();
}

async function getThreadByReference(db, userId, referenceIds) {
  if (!referenceIds.length) return null;
  const placeholders = referenceIds.map((_, index) => `?${index + 2}`).join(', ');
  const stmt = db.prepare(
    `SELECT thread_id FROM messages
     WHERE user_id = ?1 AND internet_message_id IN (${placeholders})
     ORDER BY created_at DESC
     LIMIT 1`,
  );
  const bound = stmt.bind(userId, ...referenceIds);
  const row = await first(bound);
  return row?.thread_id || null;
}

async function findExistingThread(db, userId, mailboxId, subject) {
  const row = await first(
    db.prepare(
      `SELECT id FROM threads
       WHERE user_id = ?1 AND mailbox_id IS ?2 AND subject_normalized = ?3
       ORDER BY latest_message_at DESC
       LIMIT 1`,
    ).bind(userId, mailboxId || null, normalizeSubject(subject)),
  );
  return row?.id || null;
}

async function refreshThreadSummary(db, threadId) {
  const summary = await first(
    db.prepare(
      `SELECT
         MAX(created_at) AS latest_message_at,
         SUM(CASE WHEN is_read = 0 AND folder = 'inbox' THEN 1 ELSE 0 END) AS unread_count,
         SUM(CASE WHEN starred = 1 THEN 1 ELSE 0 END) AS starred_count,
         COUNT(*) AS message_count
       FROM messages
       WHERE thread_id = ?1`,
    ).bind(threadId),
  );
  const latest = await first(
    db.prepare(
      `SELECT subject, subject_normalized, snippet, folder, mailbox_id, domain_id
       FROM messages
       WHERE thread_id = ?1
       ORDER BY created_at DESC
       LIMIT 1`,
    ).bind(threadId),
  );
  if (!summary || !latest) return;
  await db
    .prepare(
      `UPDATE threads
       SET subject = ?2,
           subject_normalized = ?3,
           snippet = ?4,
           folder = ?5,
           mailbox_id = ?6,
           domain_id = ?7,
           latest_message_at = ?8,
           message_count = ?9,
           unread_count = ?10,
           starred = ?11,
           updated_at = ?8
       WHERE id = ?1`,
    )
    .bind(
      threadId,
      latest.subject || '',
      latest.subject_normalized || '',
      latest.snippet || '',
      latest.folder || 'inbox',
      latest.mailbox_id || null,
      latest.domain_id,
      summary.latest_message_at || Date.now(),
      summary.message_count || 0,
      summary.unread_count || 0,
      (summary.starred_count || 0) > 0 ? 1 : 0,
    )
    .run();
}

async function ensureThread(db, {
  userId,
  domainId,
  mailboxId,
  subject,
  participants,
  referenceIds,
  createdAt,
  explicitThreadId,
}) {
  let threadId = explicitThreadId || null;
  if (!threadId && referenceIds?.length) {
    threadId = await getThreadByReference(db, userId, referenceIds);
  }
  if (!threadId) {
    threadId = await findExistingThread(db, userId, mailboxId, subject);
  }
  if (!threadId) {
    threadId = createId('thr_');
    await db
      .prepare(
        `INSERT INTO threads (
           id, user_id, domain_id, mailbox_id, folder, subject, subject_normalized,
           participants_json, snippet, latest_message_at, message_count, unread_count, starred, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, 'inbox', ?5, ?6, ?7, '', ?8, 0, 0, 0, ?8, ?8)`,
      )
      .bind(
        threadId,
        userId,
        domainId,
        mailboxId || null,
        subject || '',
        normalizeSubject(subject),
        JSON.stringify(participants || []),
        createdAt,
      )
      .run();
  }
  return threadId;
}

export async function saveInboundMessage(db, {
  userId,
  domainId,
  mailboxId,
  aliasRuleId,
  from,
  to,
  cc,
  subject,
  textBody,
  htmlBody,
  internetMessageId,
  inReplyTo,
  references,
  rawKey,
  receivedAt,
  attachments,
}) {
  const participants = [from?.email, ...to.map((entry) => entry.email), ...cc.map((entry) => entry.email)].filter(Boolean);
  const threadId = await ensureThread(db, {
    userId,
    domainId,
    mailboxId,
    subject,
    participants,
    referenceIds: [inReplyTo, ...(references || [])].filter(Boolean),
    createdAt: receivedAt,
  });

  const messageId = createId('msg_');
  await db
    .prepare(
      `INSERT INTO messages (
         id, user_id, thread_id, domain_id, mailbox_id, alias_rule_id, direction, folder,
         internet_message_id, from_json, to_json, cc_json, bcc_json, subject, subject_normalized,
         snippet, text_body, html_body, raw_r2_key, references_json, in_reply_to, is_read,
         starred, has_attachments, received_at, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'inbound', 'inbox', ?7, ?8, ?9, ?10, '[]', ?11, ?12,
                 ?13, ?14, ?15, ?16, ?17, ?18, 0, 0, ?19, ?20, ?20, ?20)`,
    )
    .bind(
      messageId,
      userId,
      threadId,
      domainId,
      mailboxId || null,
      aliasRuleId || null,
      internetMessageId || null,
      JSON.stringify(from || {}),
      JSON.stringify(to || []),
      JSON.stringify(cc || []),
      subject || '',
      normalizeSubject(subject),
      buildSnippet(textBody, htmlBody),
      textBody || '',
      htmlBody || '',
      rawKey || null,
      JSON.stringify(references || []),
      inReplyTo || null,
      attachments.length ? 1 : 0,
      receivedAt,
    )
    .run();

  for (const attachment of attachments) {
    await db
      .prepare(
        `INSERT INTO attachments (
           id, user_id, message_id, draft_id, file_name, mime_type, byte_size,
           content_id, disposition, r2_key, created_at
         ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        createId('att_'),
        userId,
        messageId,
        attachment.fileName,
        attachment.mimeType,
        attachment.byteSize,
        attachment.contentId || null,
        attachment.disposition || 'attachment',
        attachment.r2Key,
        receivedAt,
      )
      .run();
  }

  await refreshThreadSummary(db, threadId);
  return messageId;
}

export async function saveOutgoingMessage(db, {
  userId,
  domainId,
  mailboxId,
  threadId,
  from,
  to,
  cc,
  bcc,
  subject,
  textBody,
  htmlBody,
  internetMessageId,
  providerMessageId,
  attachments,
  references,
  inReplyTo,
  sentAt,
}) {
  const participants = [from?.email, ...to.map((entry) => entry.email), ...cc.map((entry) => entry.email)].filter(Boolean);
  const resolvedThreadId = await ensureThread(db, {
    userId,
    domainId,
    mailboxId,
    subject,
    participants,
    referenceIds: [inReplyTo, ...(references || [])].filter(Boolean),
    createdAt: sentAt,
    explicitThreadId: threadId || null,
  });

  const messageId = createId('msg_');
  await db
    .prepare(
      `INSERT INTO messages (
         id, user_id, thread_id, domain_id, mailbox_id, alias_rule_id, direction, folder,
         internet_message_id, provider_message_id, from_json, to_json, cc_json, bcc_json,
         subject, subject_normalized, snippet, text_body, html_body, references_json,
         in_reply_to, is_read, starred, has_attachments, sent_at, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'outbound', 'sent', ?6, ?7, ?8, ?9, ?10, ?11,
                 ?12, ?13, ?14, ?15, ?16, ?17, ?18, 1, 0, ?19, ?20, ?20, ?20)`,
    )
    .bind(
      messageId,
      userId,
      resolvedThreadId,
      domainId,
      mailboxId || null,
      internetMessageId || null,
      providerMessageId || null,
      JSON.stringify(from || {}),
      JSON.stringify(to || []),
      JSON.stringify(cc || []),
      JSON.stringify(bcc || []),
      subject || '',
      normalizeSubject(subject),
      buildSnippet(textBody, htmlBody),
      textBody || '',
      htmlBody || '',
      JSON.stringify(references || []),
      inReplyTo || null,
      attachments.length ? 1 : 0,
      sentAt,
    )
    .run();

  for (const attachment of attachments) {
    await db
      .prepare(
        `INSERT INTO attachments (
           id, user_id, message_id, draft_id, file_name, mime_type, byte_size,
           content_id, disposition, r2_key, created_at
         ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        createId('att_'),
        userId,
        messageId,
        attachment.fileName,
        attachment.mimeType,
        attachment.byteSize,
        attachment.contentId || null,
        attachment.disposition || 'attachment',
        attachment.r2Key,
        sentAt,
      )
      .run();
  }

  await refreshThreadSummary(db, resolvedThreadId);
  return { messageId, threadId: resolvedThreadId };
}

export async function listThreads(db, userId, options = {}) {
  const folder = normalizeFolder(options.folder || 'inbox');
  const clauses = ['t.user_id = ?1', 't.folder = ?2'];
  const params = [userId, folder];
  if (options.mailboxId) {
    clauses.push(`t.mailbox_id = ?${params.length + 1}`);
    params.push(options.mailboxId);
  }
  if (options.domainId) {
    clauses.push(`t.domain_id = ?${params.length + 1}`);
    params.push(options.domainId);
  }
  if (options.query) {
    clauses.push(`(t.subject LIKE ?${params.length + 1} OR t.snippet LIKE ?${params.length + 1})`);
    params.push(`%${options.query}%`);
  }
  const stmt = db.prepare(
    `SELECT t.*, d.hostname, m.email_address AS mailbox_email
     FROM threads t
     LEFT JOIN domains d ON d.id = t.domain_id
     LEFT JOIN mailboxes m ON m.id = t.mailbox_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY t.latest_message_at DESC
     LIMIT 250`,
  ).bind(...params);
  const rows = await all(stmt);
  return rows.map((row) => mapRow('threads', row));
}

export async function getThread(db, userId, threadId) {
  const thread = await first(
    db.prepare(
      `SELECT t.*, d.hostname, m.email_address AS mailbox_email
       FROM threads t
       LEFT JOIN domains d ON d.id = t.domain_id
       LEFT JOIN mailboxes m ON m.id = t.mailbox_id
       WHERE t.user_id = ?1 AND t.id = ?2`,
    ).bind(userId, threadId),
  );
  if (!thread) return null;
  const messageRows = await all(
    db.prepare(
      `SELECT * FROM messages WHERE user_id = ?1 AND thread_id = ?2 ORDER BY created_at ASC`,
    ).bind(userId, threadId),
  );
  const attachments = await all(
    db.prepare(
      `SELECT * FROM attachments WHERE user_id = ?1 AND message_id IN (
         SELECT id FROM messages WHERE thread_id = ?2
       ) ORDER BY created_at ASC`,
    ).bind(userId, threadId),
  );
  const attachmentMap = new Map();
  for (const attachment of attachments) {
    const items = attachmentMap.get(attachment.message_id) || [];
    items.push(attachment);
    attachmentMap.set(attachment.message_id, items);
  }
  return {
    ...mapRow('threads', thread),
    messages: messageRows.map((row) => ({
      ...mapRow('messages', row),
      attachments: attachmentMap.get(row.id) || [],
    })),
  };
}

export async function applyThreadAction(db, userId, threadId, action) {
  if (action === 'mark_read') {
    await db.prepare(`UPDATE messages SET is_read = 1 WHERE user_id = ?1 AND thread_id = ?2`).bind(userId, threadId).run();
  } else if (action === 'mark_unread') {
    await db.prepare(`UPDATE messages SET is_read = 0 WHERE user_id = ?1 AND thread_id = ?2`).bind(userId, threadId).run();
  } else if (action === 'archive') {
    await db.prepare(`UPDATE messages SET folder = 'archive' WHERE user_id = ?1 AND thread_id = ?2`).bind(userId, threadId).run();
  } else if (action === 'trash') {
    await db.prepare(`UPDATE messages SET folder = 'trash' WHERE user_id = ?1 AND thread_id = ?2`).bind(userId, threadId).run();
  } else if (action === 'restore') {
    await db.prepare(`UPDATE messages SET folder = 'inbox' WHERE user_id = ?1 AND thread_id = ?2`).bind(userId, threadId).run();
  } else if (action === 'star') {
    await db.prepare(`UPDATE messages SET starred = 1 WHERE user_id = ?1 AND thread_id = ?2`).bind(userId, threadId).run();
  } else if (action === 'unstar') {
    await db.prepare(`UPDATE messages SET starred = 0 WHERE user_id = ?1 AND thread_id = ?2`).bind(userId, threadId).run();
  }
  await refreshThreadSummary(db, threadId);
  return getThread(db, userId, threadId);
}

export async function listDrafts(db, userId) {
  const rows = await all(
    db.prepare(
      `SELECT d.*, m.email_address AS mailbox_email, dm.hostname
       FROM drafts d
       LEFT JOIN mailboxes m ON m.id = d.mailbox_id
       JOIN domains dm ON dm.id = d.domain_id
       WHERE d.user_id = ?1
       ORDER BY d.updated_at DESC`,
    ).bind(userId),
  );
  return rows.map((row) => mapRow('drafts', row));
}

export async function getDraft(db, userId, draftId) {
  const row = await first(db.prepare(`SELECT * FROM drafts WHERE user_id = ?1 AND id = ?2`).bind(userId, draftId));
  return mapRow('drafts', row);
}

export async function saveDraft(db, data) {
  const current = data.id ? await getDraft(db, data.userId, data.id) : null;
  const timestamp = Date.now();
  const id = current?.id || data.id || createId('drf_');
  await db
    .prepare(
      `INSERT INTO drafts (
         id, user_id, domain_id, mailbox_id, thread_id, from_address,
         to_json, cc_json, bcc_json, subject, text_body, html_body,
         attachment_json, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
       ON CONFLICT(id) DO UPDATE SET
         domain_id = excluded.domain_id,
         mailbox_id = excluded.mailbox_id,
         thread_id = excluded.thread_id,
         from_address = excluded.from_address,
         to_json = excluded.to_json,
         cc_json = excluded.cc_json,
         bcc_json = excluded.bcc_json,
         subject = excluded.subject,
         text_body = excluded.text_body,
         html_body = excluded.html_body,
         attachment_json = excluded.attachment_json,
         updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      data.userId,
      data.domainId,
      data.mailboxId || null,
      data.threadId || null,
      data.fromAddress,
      JSON.stringify(parseAddressList(data.to || [])),
      JSON.stringify(parseAddressList(data.cc || [])),
      JSON.stringify(parseAddressList(data.bcc || [])),
      data.subject || '',
      data.textBody || '',
      data.htmlBody || '',
      JSON.stringify(data.attachments || []),
      current?.created_at || timestamp,
    )
    .run();
  return getDraft(db, data.userId, id);
}

export async function deleteDraft(db, userId, draftId) {
  await db.prepare(`DELETE FROM drafts WHERE user_id = ?1 AND id = ?2`).bind(userId, draftId).run();
}

export async function getAttachment(db, userId, attachmentId) {
  return first(
    db.prepare(`SELECT * FROM attachments WHERE user_id = ?1 AND id = ?2`).bind(userId, attachmentId),
  );
}
