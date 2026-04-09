import { buildSnippet, createId, findThreadFingerprint, normalizeFolder, normalizeSubject, parseAddressList } from './mail.js';
import { SCHEMA_SQL } from './schema.js';

const JSON_FIELDS = {
  provider_connections: ['metadata_json'],
  domains: ['catch_all_forward_json'],
  alias_rules: ['forward_destination_json'],
  threads: ['participants_json'],
  messages: ['from_json', 'to_json', 'cc_json', 'bcc_json', 'references_json'],
  drafts: ['to_json', 'cc_json', 'bcc_json', 'attachment_json'],
  ingest_failures: ['payload_json'],
};

const SEND_CAPABILITIES = new Set(['send_enabled', 'receive_only', 'send_unavailable']);

let schemaPromise;

function encodeCursor(value) {
  if (!value) return null;
  return btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return JSON.parse(atob(normalized + pad));
  } catch {
    return null;
  }
}

function clampLimit(value, fallback = 50, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

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

function parseRecipientAddress(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    return null;
  }
  return {
    localPart: normalized.slice(0, atIndex),
    hostname: normalized.slice(atIndex + 1),
  };
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
    routing_error: row.routing_error || null,
    routing_checked_at: row.routing_checked_at || null,
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

      if (!(await hasColumn(db, 'users', 'selected_sending_domain_id'))) {
        await db
          .prepare('ALTER TABLE users ADD COLUMN selected_sending_domain_id TEXT')
          .run();
      }

      if (!(await hasColumn(db, 'domains', 'send_capability'))) {
        await db
          .prepare(`ALTER TABLE domains ADD COLUMN send_capability TEXT NOT NULL DEFAULT 'send_unavailable'`)
          .run();
      }

      if (!(await hasColumn(db, 'domains', 'routing_error'))) {
        await db
          .prepare('ALTER TABLE domains ADD COLUMN routing_error TEXT')
          .run();
      }

      if (!(await hasColumn(db, 'domains', 'routing_checked_at'))) {
        await db
          .prepare('ALTER TABLE domains ADD COLUMN routing_checked_at INTEGER')
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
      `INSERT INTO users (id, email, display_name, photo_url, selected_sending_domain_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?5)
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

export async function updateUserSelectedSendingDomain(db, userId, domainId) {
  await db
    .prepare(
      `UPDATE users
       SET selected_sending_domain_id = ?2,
           updated_at = ?3
       WHERE id = ?1`,
    )
    .bind(userId, domainId || null, Date.now())
    .run();
  return getUser(db, userId);
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
         send_capability, routing_status, routing_error, routing_checked_at, catch_all_mode,
         catch_all_mailbox_id, catch_all_forward_json, ingest_destination_id, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)`,
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
      data.routingError || null,
      data.routingCheckedAt || null,
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
           routing_error = ?9,
           routing_checked_at = ?10,
           catch_all_mode = ?11,
           catch_all_mailbox_id = ?12,
           catch_all_forward_json = ?13,
           ingest_destination_id = ?14,
           updated_at = ?15
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
      next.routing_error || next.routingError || null,
      next.routing_checked_at || next.routingCheckedAt || null,
      next.catch_all_mode || next.catchAllMode || 'inbox_only',
      next.catch_all_mailbox_id || next.catchAllMailboxId || null,
      JSON.stringify(next.catch_all_forward_json || next.catchAllForwardIds || []),
      next.ingest_destination_id || next.ingestDestinationId || null,
      Date.now(),
    )
    .run();
  return getDomain(db, userId, domainId);
}

export async function getAlertCounts(db, userId) {
  const [routing, ingest] = await Promise.all([
    first(
      db.prepare(
        `SELECT COUNT(*) AS count
         FROM domains
         WHERE user_id = ?1
           AND (routing_error IS NOT NULL OR routing_status = 'degraded')`,
      ).bind(userId),
    ),
    first(
      db.prepare(
        `SELECT COUNT(*) AS count
         FROM ingest_failures
         WHERE user_id = ?1
           AND resolved_at IS NULL`,
      ).bind(userId),
    ),
  ]);

  return {
    routingDegraded: Number(routing?.count || 0),
    ingestFailures: Number(ingest?.count || 0),
  };
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

export async function listMailboxesPage(db, userId, options = {}) {
  const limit = clampLimit(options.limit, 50, 100);
  const cursor = decodeCursor(options.cursor);
  const clauses = ['user_id = ?1'];
  const params = [userId];
  if (options.domainId) {
    clauses.push(`domain_id = ?${params.length + 1}`);
    params.push(options.domainId);
  }
  if (cursor?.updatedAt && cursor?.id) {
    clauses.push(`(updated_at < ?${params.length + 1} OR (updated_at = ?${params.length + 1} AND id < ?${params.length + 2}))`);
    params.push(cursor.updatedAt, cursor.id);
  }
  const rows = await all(
    db.prepare(
      `SELECT *
       FROM mailboxes
       WHERE ${clauses.join(' AND ')}
       ORDER BY updated_at DESC, id DESC
       LIMIT ${limit + 1}`,
    ).bind(...params),
  );
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ updatedAt: last.updated_at, id: last.id }) : null,
  };
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
  const nextLocalPart = patch.localPart ?? current.local_part;
  const nextEmailAddress = patch.emailAddress ?? current.email_address;
  if (patch.isDefaultSender) {
    await db.prepare(`UPDATE mailboxes SET is_default_sender = 0 WHERE domain_id = ?1`).bind(current.domain_id).run();
  }
  await db
    .prepare(
      `UPDATE mailboxes
       SET local_part = ?3,
           email_address = ?4,
           display_name = ?5,
           signature_html = ?6,
           signature_text = ?7,
           is_default_sender = ?8,
           updated_at = ?9
       WHERE user_id = ?1 AND id = ?2`,
    )
    .bind(
      userId,
      mailboxId,
      nextLocalPart,
      nextEmailAddress,
      patch.displayName ?? current.display_name,
      patch.signatureHtml ?? current.signature_html,
      patch.signatureText ?? current.signature_text,
      patch.isDefaultSender ? 1 : 0,
      Date.now(),
    )
    .run();
  return getMailbox(db, userId, mailboxId);
}

export async function deleteMailbox(db, userId, mailboxId) {
  const mailbox = await getMailbox(db, userId, mailboxId);
  if (!mailbox) return null;

  await db
    .prepare(
      `UPDATE domains
       SET catch_all_mailbox_id = NULL,
           updated_at = ?3
       WHERE user_id = ?1 AND catch_all_mailbox_id = ?2`,
    )
    .bind(userId, mailboxId, Date.now())
    .run();

  await db
    .prepare(`DELETE FROM mailboxes WHERE user_id = ?1 AND id = ?2`)
    .bind(userId, mailboxId)
    .run();

  const replacement = await first(
    db.prepare(
      `SELECT id
       FROM mailboxes
       WHERE user_id = ?1 AND domain_id = ?2
       ORDER BY email_address ASC
       LIMIT 1`,
    ).bind(userId, mailbox.domain_id),
  );

  if (replacement) {
    await db
      .prepare(
        `UPDATE mailboxes
         SET is_default_sender = CASE WHEN id = ?3 THEN 1 ELSE 0 END,
             updated_at = ?4
         WHERE domain_id = ?2 AND user_id = ?1`,
      )
      .bind(userId, mailbox.domain_id, replacement.id, Date.now())
      .run();
  }

  return mailbox;
}

export async function listHtmlTemplatesPage(db, userId, options = {}) {
  const limit = clampLimit(options.limit, 50, 100);
  const cursor = decodeCursor(options.cursor);
  const clauses = ['user_id = ?1'];
  const params = [userId];
  if (options.domainId) {
    clauses.push(`domain_id = ?${params.length + 1}`);
    params.push(options.domainId);
  }
  if (cursor?.updatedAt && cursor?.id) {
    clauses.push(`(updated_at < ?${params.length + 1} OR (updated_at = ?${params.length + 1} AND id < ?${params.length + 2}))`);
    params.push(cursor.updatedAt, cursor.id);
  }
  const rows = await all(
    db.prepare(
      `SELECT *
       FROM html_templates
       WHERE ${clauses.join(' AND ')}
       ORDER BY updated_at DESC, id DESC
       LIMIT ${limit + 1}`,
    ).bind(...params),
  );
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ updatedAt: last.updated_at, id: last.id }) : null,
  };
}

export async function getHtmlTemplate(db, userId, templateId) {
  return first(
    db.prepare(`SELECT * FROM html_templates WHERE user_id = ?1 AND id = ?2`).bind(userId, templateId),
  );
}

export async function createHtmlTemplate(db, data) {
  const timestamp = Date.now();
  const id = data.id || createId('tpl_');
  await db
    .prepare(
      `INSERT INTO html_templates (
         id, user_id, domain_id, name, subject, html_content, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
    .bind(
      id,
      data.userId,
      data.domainId || null,
      data.name,
      data.subject || '',
      data.htmlContent || '',
      timestamp,
    )
    .run();
  return getHtmlTemplate(db, data.userId, id);
}

export async function updateHtmlTemplate(db, userId, templateId, patch) {
  const current = await getHtmlTemplate(db, userId, templateId);
  if (!current) return null;
  await db
    .prepare(
      `UPDATE html_templates
       SET domain_id = ?3,
           name = ?4,
           subject = ?5,
           html_content = ?6,
           updated_at = ?7
       WHERE user_id = ?1 AND id = ?2`,
    )
    .bind(
      userId,
      templateId,
      patch.domainId ?? current.domain_id ?? null,
      patch.name ?? current.name,
      patch.subject ?? current.subject,
      patch.htmlContent ?? current.html_content,
      Date.now(),
    )
    .run();
  return getHtmlTemplate(db, userId, templateId);
}

export async function deleteHtmlTemplate(db, userId, templateId) {
  const template = await getHtmlTemplate(db, userId, templateId);
  if (!template) return null;
  await db
    .prepare(`DELETE FROM html_templates WHERE user_id = ?1 AND id = ?2`)
    .bind(userId, templateId)
    .run();
  return template;
}

export async function getMailboxDependencySummary(db, userId, mailboxId) {
  const aliasDependency = await first(
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM alias_rules
       WHERE user_id = ?1
         AND mailbox_id = ?2
         AND mode != 'forward_only'`,
    ).bind(userId, mailboxId),
  );

  const catchAllDependency = await first(
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM domains
       WHERE user_id = ?1
         AND catch_all_mailbox_id = ?2
         AND catch_all_mode != 'forward_only'`,
    ).bind(userId, mailboxId),
  );

  return {
    inboxAliasCount: Number(aliasDependency?.count || 0),
    catchAllCount: Number(catchAllDependency?.count || 0),
  };
}

export async function listForwardDestinations(db, userId) {
  return all(
    db.prepare(
      `SELECT * FROM forward_destinations WHERE user_id = ?1 ORDER BY email ASC`,
    ).bind(userId),
  );
}

export async function listForwardDestinationsPage(db, userId, options = {}) {
  const limit = clampLimit(options.limit, 50, 100);
  const cursor = decodeCursor(options.cursor);
  const params = [userId];
  const clauses = ['user_id = ?1'];
  if (cursor?.updatedAt && cursor?.id) {
    clauses.push(`(updated_at < ?${params.length + 1} OR (updated_at = ?${params.length + 1} AND id < ?${params.length + 2}))`);
    params.push(cursor.updatedAt, cursor.id);
  }
  const rows = await all(
    db.prepare(
      `SELECT *
       FROM forward_destinations
       WHERE ${clauses.join(' AND ')}
       ORDER BY updated_at DESC, id DESC
       LIMIT ${limit + 1}`,
    ).bind(...params),
  );
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ updatedAt: last.updated_at, id: last.id }) : null,
  };
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

export async function listAliasRulesPage(db, userId, options = {}) {
  const limit = clampLimit(options.limit, 50, 100);
  const cursor = decodeCursor(options.cursor);
  const params = [userId];
  const clauses = ['a.user_id = ?1'];
  if (options.domainId) {
    clauses.push(`a.domain_id = ?${params.length + 1}`);
    params.push(options.domainId);
  }
  if (cursor?.updatedAt && cursor?.id) {
    clauses.push(`(a.updated_at < ?${params.length + 1} OR (a.updated_at = ?${params.length + 1} AND a.id < ?${params.length + 2}))`);
    params.push(cursor.updatedAt, cursor.id);
  }
  const rows = await all(
    db.prepare(
      `SELECT a.*, m.email_address AS mailbox_email, d.hostname
       FROM alias_rules a
       LEFT JOIN mailboxes m ON a.mailbox_id = m.id
       JOIN domains d ON a.domain_id = d.id
       WHERE ${clauses.join(' AND ')}
       ORDER BY a.updated_at DESC, a.id DESC
       LIMIT ${limit + 1}`,
    ).bind(...params),
  );
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => mapRow('alias_rules', row));
  const last = rows.slice(0, limit).at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ updatedAt: last.updated_at, id: last.id }) : null,
  };
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

export async function getAliasRuleByRecipient(db, recipientAddress) {
  const parts = parseRecipientAddress(recipientAddress);
  if (!parts) return null;

  const explicit = await first(
    db.prepare(
      `SELECT a.*, d.hostname, d.user_id, m.email_address AS mailbox_email, m.display_name AS mailbox_display_name
       FROM alias_rules a
       JOIN domains d ON d.id = a.domain_id
       LEFT JOIN mailboxes m ON m.id = a.mailbox_id
       WHERE a.enabled = 1
         AND a.is_catch_all = 0
         AND lower(d.hostname) = ?1
         AND lower(a.local_part) = ?2
       LIMIT 1`,
    ).bind(parts.hostname, parts.localPart),
  );
  if (explicit) return mapRow('alias_rules', explicit);

  const catchAll = await first(
    db.prepare(
      `SELECT a.*, d.hostname, d.user_id, m.email_address AS mailbox_email, m.display_name AS mailbox_display_name
       FROM alias_rules a
       JOIN domains d ON d.id = a.domain_id
       LEFT JOIN mailboxes m ON m.id = a.mailbox_id
       WHERE a.enabled = 1
         AND a.is_catch_all = 1
         AND lower(d.hostname) = ?1
       ORDER BY a.updated_at DESC
       LIMIT 1`,
    ).bind(parts.hostname),
  );
  return catchAll ? mapRow('alias_rules', catchAll) : null;
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

export async function findInboundMessageByRawKey(db, userId, rawKey) {
  if (!rawKey) return null;
  return first(
    db.prepare(
      `SELECT *
       FROM messages
       WHERE user_id = ?1
         AND direction = 'inbound'
         AND raw_r2_key = ?2
       LIMIT 1`,
    ).bind(userId, rawKey),
  );
}

export async function findInboundMessageByInternetMessageId(db, userId, domainId, internetMessageId) {
  if (!internetMessageId) return null;
  return first(
    db.prepare(
      `SELECT *
       FROM messages
       WHERE user_id = ?1
         AND domain_id = ?2
         AND direction = 'inbound'
         AND internet_message_id = ?3
       ORDER BY created_at DESC
       LIMIT 1`,
    ).bind(userId, domainId, internetMessageId),
  );
}

export async function recordIngestFailure(db, {
  userId = null,
  domainId = null,
  recipient,
  messageId = null,
  rawKey,
  reason,
  payload = {},
}) {
  const timestamp = Date.now();
  const existing = await first(
    db.prepare(
      `SELECT *
       FROM ingest_failures
       WHERE raw_r2_key = ?1 AND reason = ?2
       LIMIT 1`,
    ).bind(rawKey, reason),
  );
  const id = existing?.id || createId('ingf_');
  await db
    .prepare(
      `INSERT INTO ingest_failures (
         id, user_id, domain_id, recipient, message_id, raw_r2_key, reason, payload_json,
         first_seen_at, last_seen_at, retry_count, resolved_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 0, NULL)
       ON CONFLICT(raw_r2_key, reason) DO UPDATE SET
         user_id = excluded.user_id,
         domain_id = excluded.domain_id,
         recipient = excluded.recipient,
         message_id = excluded.message_id,
         payload_json = excluded.payload_json,
         last_seen_at = excluded.last_seen_at,
         retry_count = ingest_failures.retry_count + 1,
         resolved_at = NULL`,
    )
    .bind(
      id,
      userId,
      domainId,
      recipient,
      messageId,
      rawKey,
      reason,
      JSON.stringify(payload || {}),
      existing?.first_seen_at || timestamp,
    )
    .run();

  return first(
    db.prepare(`SELECT * FROM ingest_failures WHERE id = ?1`).bind(id),
  );
}

export async function resolveIngestFailuresForRawKey(db, rawKey) {
  if (!rawKey) return;
  await db
    .prepare(
      `UPDATE ingest_failures
       SET resolved_at = ?2,
           last_seen_at = ?2
       WHERE raw_r2_key = ?1
         AND resolved_at IS NULL`,
    )
    .bind(rawKey, Date.now())
    .run();
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
  const existingByRawKey = await findInboundMessageByRawKey(db, userId, rawKey);
  if (existingByRawKey) {
    return { messageId: existingByRawKey.id, threadId: existingByRawKey.thread_id, duplicate: true };
  }

  const existingByMessageId = await findInboundMessageByInternetMessageId(db, userId, domainId, internetMessageId);
  if (existingByMessageId) {
    return { messageId: existingByMessageId.id, threadId: existingByMessageId.thread_id, duplicate: true };
  }

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
  await resolveIngestFailuresForRawKey(db, rawKey);
  return { messageId, threadId, duplicate: false };
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

export async function listThreadsPage(db, userId, options = {}) {
  const folder = normalizeFolder(options.folder || 'inbox');
  const limit = clampLimit(options.limit, 50, 100);
  const cursor = decodeCursor(options.cursor);
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
  if (cursor?.latestMessageAt && cursor?.id) {
    clauses.push(`(t.latest_message_at < ?${params.length + 1} OR (t.latest_message_at = ?${params.length + 1} AND t.id < ?${params.length + 2}))`);
    params.push(cursor.latestMessageAt, cursor.id);
  }
  const rows = await all(
    db.prepare(
      `SELECT t.*, d.hostname, m.email_address AS mailbox_email
       FROM threads t
       LEFT JOIN domains d ON d.id = t.domain_id
       LEFT JOIN mailboxes m ON m.id = t.mailbox_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY t.latest_message_at DESC, t.id DESC
       LIMIT ${limit + 1}`,
    ).bind(...params),
  );
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const items = pageRows.map((row) => mapRow('threads', row));
  const last = pageRows.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ latestMessageAt: last.latest_message_at, id: last.id }) : null,
  };
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

export async function deleteThreadPermanently(db, userId, threadId) {
  const thread = await first(
    db.prepare(`SELECT id, folder FROM threads WHERE user_id = ?1 AND id = ?2`).bind(userId, threadId),
  );
  if (!thread || thread.folder !== 'trash') return null;

  const [messageRows, attachmentRows] = await Promise.all([
    all(
      db.prepare(
        `SELECT id, raw_r2_key
         FROM messages
         WHERE user_id = ?1
           AND thread_id = ?2`,
      ).bind(userId, threadId),
    ),
    all(
      db.prepare(
        `SELECT a.r2_key
         FROM attachments a
         JOIN messages m ON m.id = a.message_id
         WHERE a.user_id = ?1
           AND m.thread_id = ?2`,
      ).bind(userId, threadId),
    ),
  ]);

  const storageKeys = [
    ...new Set([
      ...messageRows.map((row) => row.raw_r2_key).filter(Boolean),
      ...attachmentRows.map((row) => row.r2_key).filter(Boolean),
    ]),
  ];

  await db
    .prepare(
      `DELETE FROM threads
       WHERE user_id = ?1
         AND id = ?2
         AND folder = 'trash'`,
    )
    .bind(userId, threadId)
    .run();

  return {
    deleted: true,
    threadId,
    deletedMessageCount: messageRows.length,
    deletedThreadCount: 1,
    storageKeys,
  };
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

export async function listDraftsPage(db, userId, options = {}) {
  const limit = clampLimit(options.limit, 50, 100);
  const cursor = decodeCursor(options.cursor);
  const params = [userId];
  const clauses = ['d.user_id = ?1'];
  if (cursor?.updatedAt && cursor?.id) {
    clauses.push(`(d.updated_at < ?${params.length + 1} OR (d.updated_at = ?${params.length + 1} AND d.id < ?${params.length + 2}))`);
    params.push(cursor.updatedAt, cursor.id);
  }
  const rows = await all(
    db.prepare(
      `SELECT d.*, m.email_address AS mailbox_email, dm.hostname
       FROM drafts d
       LEFT JOIN mailboxes m ON m.id = d.mailbox_id
       JOIN domains dm ON dm.id = d.domain_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY d.updated_at DESC, d.id DESC
       LIMIT ${limit + 1}`,
    ).bind(...params),
  );
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const items = pageRows.map((row) => mapRow('drafts', row));
  const last = pageRows.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ updatedAt: last.updated_at, id: last.id }) : null,
  };
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

export async function purgeDrafts(db, userId) {
  const draftRows = await all(
    db.prepare(
      `SELECT id, attachment_json
       FROM drafts
       WHERE user_id = ?1`,
    ).bind(userId),
  );

  const storageKeys = [
    ...new Set(
      draftRows.flatMap((row) => {
        try {
          const attachments = JSON.parse(row.attachment_json || '[]');
          return (Array.isArray(attachments) ? attachments : [])
            .map((attachment) => attachment?.r2Key || attachment?.r2_key || null)
            .filter(Boolean);
        } catch {
          return [];
        }
      }),
    ),
  ];

  if (!draftRows.length) {
    return {
      deletedDraftCount: 0,
      storageKeys: [],
    };
  }

  await db.prepare(`DELETE FROM drafts WHERE user_id = ?1`).bind(userId).run();

  return {
    deletedDraftCount: draftRows.length,
    storageKeys,
  };
}

export async function purgeTrashFolder(db, userId) {
  const [messageRows, attachmentRows, threadRows] = await Promise.all([
    all(
      db.prepare(
        `SELECT id, raw_r2_key, thread_id
         FROM messages
         WHERE user_id = ?1
           AND folder = 'trash'`,
      ).bind(userId),
    ),
    all(
      db.prepare(
        `SELECT a.r2_key
         FROM attachments a
         JOIN messages m ON m.id = a.message_id
         WHERE a.user_id = ?1
           AND m.folder = 'trash'`,
      ).bind(userId),
    ),
    all(
      db.prepare(
        `SELECT id
         FROM threads
         WHERE user_id = ?1
           AND folder = 'trash'`,
      ).bind(userId),
    ),
  ]);

  const messageIds = messageRows.map((row) => row.id);
  const threadIds = threadRows.map((row) => row.id);
  const storageKeys = [
    ...new Set([
      ...messageRows.map((row) => row.raw_r2_key).filter(Boolean),
      ...attachmentRows.map((row) => row.r2_key).filter(Boolean),
    ]),
  ];

  if (!messageIds.length) {
    return {
      deletedMessageCount: 0,
      deletedThreadCount: 0,
      storageKeys: [],
      threadIds: [],
    };
  }

  await db
    .prepare(
      `DELETE FROM messages
       WHERE user_id = ?1
         AND folder = 'trash'`,
    )
    .bind(userId)
    .run();

  await db
    .prepare(
      `DELETE FROM threads
       WHERE user_id = ?1
         AND id NOT IN (
           SELECT DISTINCT thread_id
           FROM messages
           WHERE user_id = ?1
         )`,
    )
    .bind(userId)
    .run();

  return {
    deletedMessageCount: messageIds.length,
    deletedThreadCount: threadIds.length,
    storageKeys,
    threadIds,
  };
}

export async function getAttachment(db, userId, attachmentId) {
  return first(
    db.prepare(`SELECT * FROM attachments WHERE user_id = ?1 AND id = ?2`).bind(userId, attachmentId),
  );
}
