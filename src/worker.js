import PostalMime from 'postal-mime';
import { requireUser } from './lib/auth.js';
import {
  applyThreadAction,
  createAliasRule,
  createDomain,
  createMailbox,
  deleteAliasRule,
  deleteDraft,
  ensureSchema,
  getAliasRule,
  getAliasRuleByRecipient,
  getAttachment,
  getConnection,
  getDomain,
  getDraft,
  getMailbox,
  getThread,
  listAliasRules,
  listConnections,
  listDomains,
  listDrafts,
  listForwardDestinations,
  listMailboxes,
  listThreads,
  saveConnection,
  saveDraft,
  saveInboundMessage,
  saveOutgoingMessage,
  updateAliasRule,
  updateDomain,
  updateMailbox,
  upsertForwardDestination,
  upsertUser,
} from './lib/db.js';
import { apiError, json, maybeReadJson, parseUrl, readJson } from './lib/http.js';
import { decryptText, encryptText, maskSecret } from './lib/crypto.js';
import {
  createId,
  normalizeDeliveryMode,
  normalizeFolder,
  parseAddressList,
  slugifyLocalPart,
} from './lib/mail.js';
import {
  deleteRoutingRule,
  enableEmailRouting,
  ensureDestinationAddress,
  getEmailRouting,
  listDestinationAddresses,
  listRoutingRules,
  listZones,
  updateCatchAllRule,
  upsertRoutingRule,
  verifyCloudflareToken,
} from './lib/providers/cloudflare.js';
import {
  listResendDomains,
  sendResendEmail,
  verifyResendApiKey,
} from './lib/providers/resend.js';
import { deriveSendingDomainPlan, isSendEnabledResendDomain, SEND_CAPABILITY } from './lib/sending.js';

const EMAIL_WORKER_DESTINATION = 'alias-forge-2000';

function buildRuntimeConfig(env) {
  return {
    appName: env.APP_NAME || 'Alias Forge 2000',
    ingestDomain: env.INGEST_DOMAIN || '',
    firebase: {
      apiKey: env.FIREBASE_API_KEY || '',
      authDomain: env.FIREBASE_AUTH_DOMAIN || '',
      projectId: env.FIREBASE_PROJECT_ID || '',
      appId: env.FIREBASE_APP_ID || '',
      messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || '',
    },
  };
}

async function loadSecret(db, env, userId, provider) {
  const connection = await getConnection(db, userId, provider);
  if (!connection) return null;
  return {
    ...connection,
    secret: await decryptText(env.APP_ENCRYPTION_KEY, connection.secret_ciphertext),
  };
}

function toConnectionSummary(connection) {
  if (!connection) return null;
  return {
    id: connection.id,
    provider: connection.provider,
    label: connection.label,
    status: connection.status,
    metadata: connection.metadata_json || {},
    secretMask: connection.metadata_json?.secretMask || '',
    createdAt: connection.created_at,
    updatedAt: connection.updated_at,
  };
}

function requireEncryptionKey(env) {
  if (!env.APP_ENCRYPTION_KEY) {
    throw new Error('APP_ENCRYPTION_KEY is not configured');
  }
}

function parsePath(url) {
  return url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
}

function buildWorkerRulePayload(domain, { isCatchAll, localPart, enabled }) {
  return {
    name: isCatchAll ? `catch-all ${domain.hostname}` : `${localPart}@${domain.hostname}`,
    enabled,
    priority: isCatchAll ? 0 : Date.now() % 100000,
    matchers: isCatchAll
      ? [{ type: 'all' }]
      : [{ type: 'literal', field: 'to', value: `${localPart}@${domain.hostname}` }],
    actions: [{ type: 'worker', value: [EMAIL_WORKER_DESTINATION] }],
  };
}

async function reconcileAliasRoutes(db, env, userId) {
  const cf = await loadSecret(db, env, userId, 'cloudflare');
  if (!cf) return;

  const [domains, aliases] = await Promise.all([
    listDomains(db, userId),
    listAliasRules(db, userId),
  ]);
  const domainsById = new Map(domains.map((domain) => [domain.id, domain]));

  for (const alias of aliases) {
    const domain = domainsById.get(alias.domain_id);
    if (!domain) continue;

    try {
      const payload = buildWorkerRulePayload(domain, {
        isCatchAll: Boolean(alias.is_catch_all),
        localPart: alias.local_part,
        enabled: Boolean(alias.enabled),
      });
      if (alias.is_catch_all) {
        await updateCatchAllRule(cf.secret, domain.zone_id, payload);
      } else {
        const cloudflareRule = await upsertRoutingRule(cf.secret, domain.zone_id, alias.cloudflare_rule_id, payload);
        const nextRuleId = cloudflareRule.id || cloudflareRule.tag || alias.cloudflare_rule_id || null;
        if (nextRuleId !== alias.cloudflare_rule_id) {
          await updateAliasRule(db, userId, alias.id, {
            cloudflareRuleId: nextRuleId,
          });
        }
      }
    } catch (error) {
      console.error('alias_route_reconcile_failed', {
        aliasId: alias.id,
        domainId: alias.domain_id,
        message: error.message,
      });
    }
  }
}

async function reconcileSendingDomainState(db, env, userId, options = {}) {
  const resendConnection = options.resendConnection === undefined
    ? await loadSecret(db, env, userId, 'resend')
    : options.resendConnection;
  const domains = options.domains || await listDomains(db, userId);
  if (!domains.length) {
    return {
      domains,
      sendingDomainId: null,
      sendingStatusMessage: resendConnection
        ? 'No Cloudflare mail domains are provisioned yet.'
        : 'Connect Resend to enable sending from one exact-match domain.',
    };
  }

  let resendLookupFailed = false;
  let resendDomains = [];
  if (resendConnection) {
    try {
      resendDomains = options.resendDomains || await listResendDomains(resendConnection.secret);
    } catch (error) {
      console.error('resend_domain_lookup_failed', error);
      resendLookupFailed = true;
      resendDomains = [];
    }
  }
  const plan = deriveSendingDomainPlan(domains, {
    resendConnected: Boolean(resendConnection),
    resendDomains,
    resendLookupFailed,
  });
  const reconciledDomains = [];

  for (const domain of domains) {
    const domainPlan = plan.domainPlans.find((item) => item.domainId === domain.id);
    const needsUpdate = domain.send_capability !== domainPlan.sendCapability
      || (domain.resend_domain_id || null) !== domainPlan.resendDomainId
      || (domain.resend_status || 'not_started') !== domainPlan.resendStatus;

    const nextDomain = needsUpdate
      ? await updateDomain(db, userId, domain.id, {
          resendDomainId: domainPlan.resendDomainId,
          resendStatus: domainPlan.resendStatus,
          sendCapability: domainPlan.sendCapability,
        })
      : {
          ...domain,
          resend_domain_id: domainPlan.resendDomainId,
          resend_status: domainPlan.resendStatus,
          send_capability: domainPlan.sendCapability,
          sendCapability: domainPlan.sendCapability,
          canSend: domainPlan.sendCapability === SEND_CAPABILITY.ENABLED,
        };

    if (nextDomain.send_capability === SEND_CAPABILITY.ENABLED) {
      plan.sendingDomainId = nextDomain.id;
    }
    reconciledDomains.push(nextDomain);
  }

  return {
    domains: reconciledDomains,
    sendingDomainId: plan.sendingDomainId,
    sendingStatusMessage: plan.sendingStatusMessage,
  };
}

async function getAuthenticatedContext(request, env) {
  await ensureSchema(env.DB);
  const profile = await requireUser(request, env);
  const user = await upsertUser(env.DB, profile);
  return { user };
}

async function bootstrapData(db, env, userId) {
  await reconcileAliasRoutes(db, env, userId);
  const [connections, reconciliation, mailboxes, forwardDestinations, aliases, drafts] = await Promise.all([
    listConnections(db, userId),
    reconcileSendingDomainState(db, env, userId),
    listMailboxes(db, userId),
    listForwardDestinations(db, userId),
    listAliasRules(db, userId),
    listDrafts(db, userId),
  ]);
  return {
    connections: connections.map(toConnectionSummary),
    domains: reconciliation.domains,
    mailboxes,
    forwardDestinations,
    aliases,
    drafts,
    sendingDomainId: reconciliation.sendingDomainId,
    sendingStatusMessage: reconciliation.sendingStatusMessage,
  };
}

async function saveProviderConnection(db, env, userId, provider, label, secret, metadata) {
  requireEncryptionKey(env);
  const encrypted = await encryptText(env.APP_ENCRYPTION_KEY, secret);
  const connection = await saveConnection(db, {
    userId,
    provider,
    label,
    secretCiphertext: encrypted,
    metadata: {
      ...metadata,
      secretMask: maskSecret(secret),
    },
    status: 'connected',
  });
  return toConnectionSummary(connection);
}

async function handleCloudflareConnection(request, env, user) {
  if (request.method === 'GET') {
    const connection = await getConnection(env.DB, user.id, 'cloudflare');
    return json({ connection: toConnectionSummary(connection) });
  }

  const body = await readJson(request);
  const token = String(body.token || '').trim();
  if (!token) return apiError(400, 'Cloudflare token is required');

  const tokenVerification = await verifyCloudflareToken(token);
  const zones = await listZones(token);
  const connection = await saveProviderConnection(
    env.DB,
    env,
    user.id,
    'cloudflare',
    body.label || 'Cloudflare',
    token,
    {
      tokenVerification,
      zoneCount: zones.length,
      accounts: [...new Set(zones.map((zone) => zone.account?.name).filter(Boolean))],
    },
  );
  await reconcileAliasRoutes(env.DB, env, user.id);
  return json({ connection, zones });
}

async function handleResendConnection(request, env, user) {
  if (request.method === 'GET') {
    const connection = await getConnection(env.DB, user.id, 'resend');
    return json({ connection: toConnectionSummary(connection) });
  }

  const body = await readJson(request);
  const apiKey = String(body.apiKey || '').trim();
  if (!apiKey) return apiError(400, 'Resend API key is required');
  const domains = await verifyResendApiKey(apiKey);
  const connection = await saveProviderConnection(
    env.DB,
    env,
    user.id,
    'resend',
    body.label || 'Resend',
    apiKey,
    {
      domainCount: domains?.data?.length || 0,
      verifiedDomainCount: (domains?.data || []).filter(isSendEnabledResendDomain).length,
    },
  );
  const reconciliation = await reconcileSendingDomainState(env.DB, env, user.id, {
    resendConnection: {
      ...connection,
      secret: apiKey,
    },
    resendDomains: domains?.data || [],
  });
  await reconcileAliasRoutes(env.DB, env, user.id);
  return json({
    connection,
    sendingDomainId: reconciliation.sendingDomainId,
    sendingStatusMessage: reconciliation.sendingStatusMessage,
  });
}

async function handleCloudflareZones(env, user) {
  const cf = await loadSecret(env.DB, env, user.id, 'cloudflare');
  if (!cf) return apiError(400, 'Connect Cloudflare first');
  const zones = await listZones(cf.secret);
  return json({ zones });
}

async function handleDomains(request, env, user, pathParts) {
  if (request.method === 'GET' && pathParts.length === 2) {
    const reconciliation = await reconcileSendingDomainState(env.DB, env, user.id);
    return json({
      domains: reconciliation.domains,
      sendingDomainId: reconciliation.sendingDomainId,
      sendingStatusMessage: reconciliation.sendingStatusMessage,
    });
  }

  if (request.method === 'POST' && pathParts.length === 2) {
    const body = await readJson(request);
    const cf = await loadSecret(env.DB, env, user.id, 'cloudflare');
    if (!cf) return apiError(400, 'Connect Cloudflare first');

    const zones = await listZones(cf.secret);
    const zone = zones.find((entry) => entry.id === body.zoneId);
    if (!zone) return apiError(404, 'Cloudflare zone not found');

    const hostname = String(body.hostname || zone.name).trim().toLowerCase();
    const localPart = slugifyLocalPart(body.defaultMailboxLocalPart || 'admin');
    const displayName = String(body.displayName || body.label || zone.name).trim();
    let routingStatus = 'pending';
    try {
      await enableEmailRouting(cf.secret, zone.id);
      routingStatus = 'enabled';
    } catch {
      try {
        const routing = await getEmailRouting(cf.secret, zone.id);
        routingStatus = routing.enabled ? 'enabled' : 'pending';
      } catch {
        routingStatus = 'pending';
      }
    }

    const domain = await createDomain(env.DB, {
      userId: user.id,
      zoneId: zone.id,
      accountId: zone.account?.id || '',
      hostname,
      label: body.label || hostname,
      resendStatus: 'not_configured',
      sendCapability: SEND_CAPABILITY.UNAVAILABLE,
      routingStatus,
    });

    const mailbox = await createMailbox(env.DB, {
      userId: user.id,
      domainId: domain.id,
      localPart,
      emailAddress: `${localPart}@${hostname}`,
      displayName,
      signatureHtml: `<p>${displayName}</p>`,
      signatureText: displayName,
      isDefaultSender: true,
    });

    const reconciliation = await reconcileSendingDomainState(env.DB, env, user.id);
    const updatedDomain = reconciliation.domains.find((item) => item.id === domain.id) || domain;

    return json({
      domain: updatedDomain,
      mailbox,
      sendingDomainId: reconciliation.sendingDomainId,
      sendingStatusMessage: reconciliation.sendingStatusMessage,
    }, { status: 201 });
  }

  if (request.method === 'POST' && pathParts.length === 4 && pathParts[3] === 'refresh') {
    const domain = await getDomain(env.DB, user.id, pathParts[2]);
    if (!domain) return apiError(404, 'Domain not found');
    const cf = await loadSecret(env.DB, env, user.id, 'cloudflare');
    const patch = {};
    if (cf) {
      try {
        const routing = await getEmailRouting(cf.secret, domain.zone_id);
        patch.routingStatus = routing.enabled ? 'enabled' : 'pending';
      } catch {
        patch.routingStatus = domain.routing_status;
      }
    }
    const updated = await updateDomain(env.DB, user.id, domain.id, patch);
    const reconciliation = await reconcileSendingDomainState(env.DB, env, user.id);
    return json({
      domain: reconciliation.domains.find((item) => item.id === updated.id) || updated,
      sendingDomainId: reconciliation.sendingDomainId,
      sendingStatusMessage: reconciliation.sendingStatusMessage,
    });
  }

  return apiError(405, 'Unsupported domain route');
}

async function handleMailboxes(request, env, user, pathParts) {
  if (request.method === 'GET') {
    const url = parseUrl(request);
    return json({
      mailboxes: await listMailboxes(env.DB, user.id, url.searchParams.get('domainId')),
    });
  }

  if (request.method === 'POST' && pathParts.length === 2) {
    const body = await readJson(request);
    const domain = await getDomain(env.DB, user.id, body.domainId);
    if (!domain) return apiError(404, 'Domain not found');
    const localPart = slugifyLocalPart(body.localPart);
    const mailbox = await createMailbox(env.DB, {
      userId: user.id,
      domainId: domain.id,
      localPart,
      emailAddress: `${localPart}@${domain.hostname}`,
      displayName: body.displayName || `${localPart}@${domain.hostname}`,
      signatureHtml: body.signatureHtml || '',
      signatureText: body.signatureText || '',
      isDefaultSender: Boolean(body.isDefaultSender),
    });
    return json({ mailbox }, { status: 201 });
  }

  if ((request.method === 'PATCH' || request.method === 'PUT') && pathParts.length === 3) {
    const body = await readJson(request);
    const mailbox = await updateMailbox(env.DB, user.id, pathParts[2], body);
    if (!mailbox) return apiError(404, 'Mailbox not found');
    return json({ mailbox });
  }

  return apiError(405, 'Unsupported mailbox route');
}

async function handleForwardDestinations(request, env, user) {
  const cf = await loadSecret(env.DB, env, user.id, 'cloudflare');
  if (request.method === 'GET') {
    return json({
      forwardDestinations: await listForwardDestinations(env.DB, user.id),
    });
  }

  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return apiError(400, 'Destination email is required');
  let destination = null;
  if (cf && body.accountId) {
    destination = await ensureDestinationAddress(cf.secret, body.accountId, email);
  }
  const saved = await upsertForwardDestination(env.DB, {
    userId: user.id,
    email,
    displayName: body.displayName || email,
    cloudflareDestinationId: destination?.id || null,
    verificationState: destination?.verified ? 'verified' : 'pending',
  });
  return json({ forwardDestination: saved }, { status: 201 });
}

async function handleAliases(request, env, user, pathParts) {
  if (request.method === 'GET' && pathParts.length === 2) {
    const url = parseUrl(request);
    return json({
      aliases: await listAliasRules(env.DB, user.id, url.searchParams.get('domainId')),
    });
  }

  const cf = await loadSecret(env.DB, env, user.id, 'cloudflare');
  if (!cf) return apiError(400, 'Connect Cloudflare first');

  if (request.method === 'POST' && pathParts.length === 2) {
    const body = await readJson(request);
    const domain = await getDomain(env.DB, user.id, body.domainId);
    if (!domain) return apiError(404, 'Domain not found');

    const mode = normalizeDeliveryMode(body.mode);
    const localPart = body.isCatchAll ? null : slugifyLocalPart(body.localPart);
    const mailbox = body.mailboxId ? await getMailbox(env.DB, user.id, body.mailboxId) : null;
    const forwardDestinationRows = (await listForwardDestinations(env.DB, user.id)).filter((item) =>
      (body.forwardDestinationIds || []).includes(item.id),
    );
    if (mode !== 'forward_only' && !mailbox) {
      return apiError(400, 'A mailbox is required for inbox delivery');
    }
    if ((mode === 'forward_only' || mode === 'inbox_and_forward')
      && !forwardDestinationRows.some((item) => item.verification_state === 'verified')) {
      return apiError(400, 'Forwarding requires at least one verified destination address.');
    }

    const aliasId = createId('alr_');
    const payload = buildWorkerRulePayload(domain, {
      isCatchAll: Boolean(body.isCatchAll),
      localPart,
      enabled: true,
    });

    const cloudflareRule = body.isCatchAll
      ? await updateCatchAllRule(cf.secret, domain.zone_id, payload)
      : await upsertRoutingRule(cf.secret, domain.zone_id, null, payload);

    const alias = await createAliasRule(env.DB, {
      id: aliasId,
      userId: user.id,
      domainId: domain.id,
      mailboxId: mailbox?.id || null,
      localPart,
      isCatchAll: Boolean(body.isCatchAll),
      mode,
      ingressAddress: body.isCatchAll ? `*@${domain.hostname}` : `${localPart}@${domain.hostname}`,
      forwardDestinationIds: forwardDestinationRows.map((item) => item.id),
      cloudflareRuleId: cloudflareRule.id || cloudflareRule.tag || null,
      enabled: true,
    });

    if (body.isCatchAll) {
      await updateDomain(env.DB, user.id, domain.id, {
        catchAllMode: mode,
        catchAllMailboxId: mailbox?.id || null,
        catchAllForwardIds: forwardDestinationRows.map((item) => item.id),
      });
    }

    return json({ alias }, { status: 201 });
  }

  if ((request.method === 'PATCH' || request.method === 'PUT') && pathParts.length === 3) {
    const existing = await getAliasRule(env.DB, user.id, pathParts[2]);
    if (!existing) return apiError(404, 'Alias not found');
    const body = await readJson(request);
    const domain = await getDomain(env.DB, user.id, existing.domain_id);
    const mailbox = body.mailboxId ? await getMailbox(env.DB, user.id, body.mailboxId) : existing.mailbox_id ? await getMailbox(env.DB, user.id, existing.mailbox_id) : null;
    const forwardDestinationRows = (await listForwardDestinations(env.DB, user.id)).filter((item) =>
      (body.forwardDestinationIds || existing.forward_destination_json || []).includes(item.id),
    );
    const mode = normalizeDeliveryMode(body.mode || existing.mode);
    const nextLocalPart = existing.is_catch_all ? null : slugifyLocalPart(body.localPart || existing.local_part);
    if ((mode === 'forward_only' || mode === 'inbox_and_forward')
      && !forwardDestinationRows.some((item) => item.verification_state === 'verified')) {
      return apiError(400, 'Forwarding requires at least one verified destination address.');
    }
    const payload = buildWorkerRulePayload(domain, {
      isCatchAll: Boolean(existing.is_catch_all),
      localPart: nextLocalPart,
      enabled: body.enabled !== false,
    });
    let cloudflareRule = null;
    if (existing.is_catch_all) {
      cloudflareRule = await updateCatchAllRule(cf.secret, domain.zone_id, payload);
    } else {
      cloudflareRule = await upsertRoutingRule(cf.secret, domain.zone_id, existing.cloudflare_rule_id, payload);
    }
    const alias = await updateAliasRule(env.DB, user.id, existing.id, {
      mailboxId: mailbox?.id || null,
      localPart: nextLocalPart,
      mode,
      ingressAddress: existing.is_catch_all ? `*@${domain.hostname}` : `${nextLocalPart}@${domain.hostname}`,
      forwardDestinationIds: forwardDestinationRows.map((item) => item.id),
      cloudflareRuleId: cloudflareRule.id || cloudflareRule.tag || existing.cloudflare_rule_id,
      enabled: body.enabled !== false,
    });
    if (existing.is_catch_all) {
      await updateDomain(env.DB, user.id, domain.id, {
        catchAllMode: mode,
        catchAllMailboxId: mailbox?.id || null,
        catchAllForwardIds: forwardDestinationRows.map((item) => item.id),
      });
    }
    return json({ alias });
  }

  if (request.method === 'DELETE' && pathParts.length === 3) {
    const existing = await getAliasRule(env.DB, user.id, pathParts[2]);
    if (!existing) return apiError(404, 'Alias not found');
    const domain = await getDomain(env.DB, user.id, existing.domain_id);
    if (existing.is_catch_all) {
      await updateCatchAllRule(cf.secret, domain.zone_id, {
        enabled: false,
        matchers: [{ type: 'all' }],
        actions: [{ type: 'drop' }],
      });
    } else if (existing.cloudflare_rule_id) {
      await deleteRoutingRule(cf.secret, domain.zone_id, existing.cloudflare_rule_id);
    }
    await deleteAliasRule(env.DB, user.id, existing.id);
    return json({ ok: true });
  }

  return apiError(405, 'Unsupported alias route');
}

async function handleThreads(request, env, user, pathParts) {
  if (request.method === 'GET' && pathParts.length === 2) {
    const url = parseUrl(request);
    return json({
      threads: await listThreads(env.DB, user.id, {
        folder: url.searchParams.get('folder') || 'inbox',
        mailboxId: url.searchParams.get('mailboxId') || null,
        domainId: url.searchParams.get('domainId') || null,
        query: url.searchParams.get('query') || '',
      }),
    });
  }

  if (request.method === 'GET' && pathParts.length === 3) {
    const thread = await getThread(env.DB, user.id, pathParts[2]);
    if (!thread) return apiError(404, 'Thread not found');
    return json({ thread });
  }

  if (request.method === 'POST' && pathParts.length === 4 && pathParts[3] === 'actions') {
    const body = await readJson(request);
    const thread = await applyThreadAction(env.DB, user.id, pathParts[2], body.action);
    if (!thread) return apiError(404, 'Thread not found');
    return json({ thread });
  }

  return apiError(405, 'Unsupported thread route');
}

async function handleDrafts(request, env, user, pathParts) {
  if (request.method === 'GET' && pathParts.length === 2) {
    return json({ drafts: await listDrafts(env.DB, user.id) });
  }

  if (request.method === 'POST' && pathParts.length === 2) {
    const body = await readJson(request);
    const draft = await saveDraft(env.DB, {
      id: body.id || null,
      userId: user.id,
      domainId: body.domainId,
      mailboxId: body.mailboxId || null,
      threadId: body.threadId || null,
      fromAddress: body.fromAddress,
      to: body.to || [],
      cc: body.cc || [],
      bcc: body.bcc || [],
      subject: body.subject || '',
      textBody: body.textBody || '',
      htmlBody: body.htmlBody || '',
      attachments: body.attachments || [],
    });
    return json({ draft }, { status: 201 });
  }

  if ((request.method === 'PATCH' || request.method === 'PUT') && pathParts.length === 3) {
    const body = await readJson(request);
    const current = await getDraft(env.DB, user.id, pathParts[2]);
    if (!current) return apiError(404, 'Draft not found');
    const draft = await saveDraft(env.DB, {
      id: current.id,
      userId: user.id,
      domainId: body.domainId || current.domain_id,
      mailboxId: body.mailboxId ?? current.mailbox_id,
      threadId: body.threadId ?? current.thread_id,
      fromAddress: body.fromAddress || current.from_address,
      to: body.to ?? current.to_json,
      cc: body.cc ?? current.cc_json,
      bcc: body.bcc ?? current.bcc_json,
      subject: body.subject ?? current.subject,
      textBody: body.textBody ?? current.text_body,
      htmlBody: body.htmlBody ?? current.html_body,
      attachments: body.attachments ?? current.attachment_json,
    });
    return json({ draft });
  }

  if (request.method === 'DELETE' && pathParts.length === 3) {
    await deleteDraft(env.DB, user.id, pathParts[2]);
    return json({ ok: true });
  }

  return apiError(405, 'Unsupported draft route');
}

async function handleUpload(request, env, user) {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) return apiError(400, 'No file uploaded');
  const key = `uploads/${user.id}/${Date.now()}-${createId('up_')}-${file.name}`;
  await env.MAIL_BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: {
      contentType: file.type || 'application/octet-stream',
    },
  });
  return json({
    attachment: {
      id: createId('upl_'),
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      byteSize: file.size,
      r2Key: key,
    },
  });
}

function formatSender(displayName, email) {
  return displayName ? `${displayName} <${email}>` : email;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function materializeAttachments(env, attachments) {
  const result = [];
  for (const attachment of attachments || []) {
    const object = await env.MAIL_BUCKET.get(attachment.r2Key);
    if (!object) continue;
    result.push({
      filename: attachment.fileName,
      content: toBase64(await object.arrayBuffer()),
    });
  }
  return result;
}

async function handleSend(request, env, user) {
  const body = await readJson(request);
  const draftId = body.draftId || body.id || null;
  const draft = draftId ? await getDraft(env.DB, user.id, draftId) : null;
  const payload = draft
    ? {
        domainId: draft.domain_id,
        mailboxId: draft.mailbox_id,
        threadId: draft.thread_id,
        fromAddress: draft.from_address,
        to: draft.to_json,
        cc: draft.cc_json,
        bcc: draft.bcc_json,
        subject: draft.subject,
        textBody: draft.text_body,
        htmlBody: draft.html_body,
        attachments: draft.attachment_json || [],
        ...body,
      }
    : body;

  if (!payload.mailboxId) {
    return apiError(400, 'Choose a sender mailbox from the send-enabled domain before sending.');
  }

  const resend = await loadSecret(env.DB, env, user.id, 'resend');
  const reconciliation = await reconcileSendingDomainState(env.DB, env, user.id, {
    resendConnection: resend,
  });
  const mailbox = await getMailbox(env.DB, user.id, payload.mailboxId);
  if (!mailbox) return apiError(404, 'Mailbox not found');
  const domain = await getDomain(env.DB, user.id, mailbox.domain_id);
  if (!domain) return apiError(404, 'Domain not found');
  if (domain.send_capability !== SEND_CAPABILITY.ENABLED) {
    return apiError(
      400,
      reconciliation.sendingStatusMessage
        || 'Selected mailbox belongs to a receive-only domain. Choose a sender from the one send-enabled domain.',
    );
  }
  if (!resend) {
    return apiError(400, reconciliation.sendingStatusMessage || 'Connect Resend to enable sending.');
  }
  const to = parseAddressList(payload.to || []);
  const cc = parseAddressList(payload.cc || []);
  const bcc = parseAddressList(payload.bcc || []);
  if (!to.length) {
    return apiError(400, 'Add at least one valid recipient in the To field.');
  }
  const attachments = await materializeAttachments(env, payload.attachments || []);
  const sendResult = await sendResendEmail(resend.secret, {
    from: formatSender(mailbox.display_name, mailbox.email_address),
    to: to.map((item) => item.email),
    cc: cc.map((item) => item.email),
    bcc: bcc.map((item) => item.email),
    subject: payload.subject || '(no subject)',
    text: payload.textBody || '',
    html: payload.htmlBody || payload.textBody || '',
    attachments,
  });

  const stored = await saveOutgoingMessage(env.DB, {
    userId: user.id,
    domainId: domain.id,
    mailboxId: mailbox.id,
    threadId: payload.threadId || null,
    from: { email: mailbox.email_address, name: mailbox.display_name },
    to,
    cc,
    bcc,
    subject: payload.subject || '(no subject)',
    textBody: payload.textBody || '',
    htmlBody: payload.htmlBody || payload.textBody || '',
    internetMessageId: `<${createId('forge-')}@${domain.hostname}>`,
    providerMessageId: sendResult.id || null,
    attachments: payload.attachments || [],
    references: [],
    inReplyTo: null,
    sentAt: Date.now(),
  });

  if (draftId) {
    await deleteDraft(env.DB, user.id, draftId);
  }

  return json({ sent: sendResult, stored });
}

async function handleAttachmentDownload(env, user, attachmentId) {
  const attachment = await getAttachment(env.DB, user.id, attachmentId);
  if (!attachment) return apiError(404, 'Attachment not found');
  const object = await env.MAIL_BUCKET.get(attachment.r2_key);
  if (!object) return apiError(404, 'Attachment content not found');
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', attachment.mime_type || 'application/octet-stream');
  headers.set('Content-Disposition', `${attachment.disposition || 'attachment'}; filename="${attachment.file_name}"`);
  return new Response(object.body, { headers });
}

function parseOneAddress(value) {
  if (!value) return null;
  if (typeof value === 'object' && value.address) {
    return { email: value.address, name: value.name || '' };
  }
  if (typeof value === 'string') {
    const match = value.match(/^(.*)<([^>]+)>$/);
    if (match) return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() };
    return { name: '', email: value.trim() };
  }
  return null;
}

function normalizeParsedList(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(parseOneAddress).filter(Boolean);
  return [parseOneAddress(input)].filter(Boolean);
}

async function queueIngest(payload, env) {
  const object = await env.MAIL_BUCKET.get(payload.rawKey);
  if (!object) return;
  const parser = new PostalMime();
  const parsed = await parser.parse(await object.arrayBuffer());
  const aliasMetadata = payload.userId
    ? payload
    : await getAliasRuleByRecipient(env.DB, payload.to);
  if (!aliasMetadata) {
    console.warn('queue_alias_not_found', { to: payload.to, rawKey: payload.rawKey });
    return;
  }

  const textBody = parsed.text || '';
  const htmlBody = parsed.html || '';
  const attachments = [];
  for (const attachment of parsed.attachments || []) {
    const key = `attachments/${aliasMetadata.user_id || aliasMetadata.userId}/${Date.now()}-${createId('att_')}-${attachment.filename || 'attachment.bin'}`;
    await env.MAIL_BUCKET.put(key, attachment.content, {
      httpMetadata: {
        contentType: attachment.mimeType || 'application/octet-stream',
      },
    });
    attachments.push({
      fileName: attachment.filename || 'attachment.bin',
      mimeType: attachment.mimeType || 'application/octet-stream',
      byteSize: attachment.content?.byteLength || attachment.content?.length || 0,
      contentId: attachment.contentId || null,
      disposition: attachment.disposition || 'attachment',
      r2Key: key,
    });
  }

  await saveInboundMessage(env.DB, {
    userId: aliasMetadata.user_id || aliasMetadata.userId,
    domainId: aliasMetadata.domain_id || aliasMetadata.domainId,
    mailboxId: aliasMetadata.mailbox_id || aliasMetadata.mailboxId,
    aliasRuleId: aliasMetadata.id || aliasMetadata.aliasRuleId,
    from: parseOneAddress(parsed.from),
    to: normalizeParsedList(parsed.to),
    cc: normalizeParsedList(parsed.cc),
    subject: parsed.subject || '',
    textBody,
    htmlBody,
    internetMessageId: parsed.messageId || payload.messageId || null,
    inReplyTo: parsed.inReplyTo || null,
    references: Array.isArray(parsed.references) ? parsed.references : [],
    rawKey: payload.rawKey,
    receivedAt: payload.receivedAt || Date.now(),
    attachments,
  });
}

export default {
  async fetch(request, env) {
    const url = parseUrl(request);
    if (url.pathname === '/api/runtime-config') {
      return json(buildRuntimeConfig(env));
    }

    const parts = parsePath(url);
    if (parts[0] !== 'api') {
      return env.ASSETS.fetch(request);
    }

    try {
      const { user } = await getAuthenticatedContext(request, env);

      if (parts[1] === 'bootstrap' && request.method === 'GET') {
        return json({
          user,
          ...(await bootstrapData(env.DB, env, user.id)),
        });
      }

      if (parts[1] === 'session' && request.method === 'GET') {
        return json({ user });
      }

      if (parts[1] === 'providers' && parts[2] === 'cloudflare') {
        return handleCloudflareConnection(request, env, user);
      }

      if (parts[1] === 'providers' && parts[2] === 'resend') {
        return handleResendConnection(request, env, user);
      }

      if (parts[1] === 'cloudflare' && parts[2] === 'zones' && request.method === 'GET') {
        return handleCloudflareZones(env, user);
      }

      if (parts[1] === 'domains') {
        return handleDomains(request, env, user, parts);
      }

      if (parts[1] === 'mailboxes') {
        return handleMailboxes(request, env, user, parts);
      }

      if (parts[1] === 'forward-destinations') {
        return handleForwardDestinations(request, env, user);
      }

      if (parts[1] === 'aliases') {
        return handleAliases(request, env, user, parts);
      }

      if (parts[1] === 'threads') {
        return handleThreads(request, env, user, parts);
      }

      if (parts[1] === 'drafts') {
        return handleDrafts(request, env, user, parts);
      }

      if (parts[1] === 'uploads' && request.method === 'POST') {
        return handleUpload(request, env, user);
      }

      if (parts[1] === 'send' && request.method === 'POST') {
        return handleSend(request, env, user);
      }

      if (parts[1] === 'attachments' && parts[2] && request.method === 'GET') {
        return handleAttachmentDownload(env, user, parts[2]);
      }

      return apiError(404, 'Route not found');
    } catch (error) {
      console.error('worker_error', error);
      return apiError(error.status || 500, error.message || 'Internal server error');
    }
  },

  async email(message, env, ctx) {
    await ensureSchema(env.DB);
    const aliasRule = await getAliasRuleByRecipient(env.DB, message.to);
    if (!aliasRule) {
      console.warn('email_alias_not_found', { to: message.to });
      return;
    }

    const forwardDestinations = aliasRule.forward_destination_json?.length
      ? (await listForwardDestinations(env.DB, aliasRule.user_id)).filter(
          (item) => aliasRule.forward_destination_json.includes(item.id) && item.verification_state === 'verified',
        )
      : [];

    if (aliasRule.mode === 'forward_only' || aliasRule.mode === 'inbox_and_forward') {
      for (const destination of forwardDestinations) {
        await message.forward(destination.email);
      }
    }

    if (aliasRule.mode === 'forward_only') {
      console.log('email_forward_only_processed', {
        aliasRuleId: aliasRule.id,
        to: message.to,
        forwards: forwardDestinations.map((item) => item.email),
      });
      return;
    }

    const rawKey = `raw/${Date.now()}-${createId('raw_')}.eml`;
    const raw = await new Response(message.raw).arrayBuffer();
    await env.MAIL_BUCKET.put(rawKey, raw, {
      httpMetadata: {
        contentType: 'message/rfc822',
      },
    });
    const payload = {
      aliasRuleId: aliasRule.id,
      userId: aliasRule.user_id,
      domainId: aliasRule.domain_id,
      mailboxId: aliasRule.mailbox_id,
      to: message.to,
      from: message.from,
      rawKey,
      receivedAt: Date.now(),
      messageId: message.headers?.get?.('message-id') || null,
    };
    const sendPromise = env.MAIL_INGEST_QUEUE.send(payload);
    if (ctx?.waitUntil) {
      ctx.waitUntil(sendPromise);
      return;
    }
    await sendPromise;
  },

  async queue(batch, env) {
    await ensureSchema(env.DB);
    for (const item of batch.messages) {
      await queueIngest(item.body, env);
      item.ack();
    }
  },
};
