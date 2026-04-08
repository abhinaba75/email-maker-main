import PostalMime from 'postal-mime';
import { requireUser, verifyFirebaseToken } from './lib/auth.js';
import {
  applyThreadAction,
  createAliasRule,
  createDomain,
  createMailbox,
  deleteMailbox,
  deleteAliasRule,
  deleteDraft,
  ensureSchema,
  findInboundMessageByRawKey,
  getAliasRule,
  getAliasRuleByRecipient,
  getAlertCounts,
  getAttachment,
  getConnection,
  getDomain,
  getDraft,
  getMailbox,
  getMailboxDependencySummary,
  getThread,
  getUser,
  listAliasRules,
  listConnections,
  listDomains,
  listDrafts,
  listDraftsPage,
  listForwardDestinations,
  listForwardDestinationsPage,
  listMailboxes,
  listMailboxesPage,
  listThreads,
  listThreadsPage,
  listAliasRulesPage,
  recordIngestFailure,
  saveConnection,
  saveDraft,
  saveInboundMessage,
  saveOutgoingMessage,
  updateAliasRule,
  updateDomain,
  updateMailbox,
  updateUserSelectedSendingDomain,
  upsertForwardDestination,
  upsertUser,
} from './lib/db.js';
import { apiError, json, maybeReadJson, parseBearerToken, parseUrl, readJson } from './lib/http.js';
import { decryptText, encryptText, maskSecret } from './lib/crypto.js';
import { buildAiAssistRequest, parseAiAssistResult } from './lib/ai.js';
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
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_FREE_MODELS,
  generateGeminiContent,
  verifyGeminiApiKey,
} from './lib/providers/gemini.js';
import {
  generateGroqChat,
  GROQ_EMAIL_MODEL,
  verifyGroqApiKey,
} from './lib/providers/groq.js';
import {
  deriveSendingDomainPlan,
  getWorkspaceSendingStatus,
  getResendDomainHostname,
  getResendDomainStatus,
  isSendEnabledResendDomain,
  SEND_CAPABILITY,
} from './lib/sending.js';

const EMAIL_WORKER_DESTINATION = 'alias-forge-2000';
const DEFAULT_ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
]);
const PUBLIC_ATTACHMENT_TTL_SECONDS = 300;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 35 * 1024 * 1024;

function buildRuntimeConfig(env) {
  return {
    appName: env.APP_NAME || 'Alias Forge 2000',
    firebase: {
      apiKey: env.PUBLIC_FIREBASE_API_KEY || env.FIREBASE_API_KEY || '',
      authDomain: env.PUBLIC_FIREBASE_AUTH_DOMAIN || env.FIREBASE_AUTH_DOMAIN || '',
      projectId: env.PUBLIC_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID || '',
      appId: env.PUBLIC_FIREBASE_APP_ID || env.FIREBASE_APP_ID || '',
      messagingSenderId: env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID || env.FIREBASE_MESSAGING_SENDER_ID || '',
    },
  };
}

function getAllowedOrigins(env, requestOrigin) {
  const allowedOrigins = new Set(DEFAULT_ALLOWED_ORIGINS);
  if (requestOrigin) allowedOrigins.add(requestOrigin);
  String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => allowedOrigins.add(entry));
  return allowedOrigins;
}

function createCorsHeaders(request, env) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const allowedOrigins = getAllowedOrigins(env, requestOrigin);
  if (!allowedOrigins.has(origin)) return false;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Credentials': 'false',
    Vary: 'Origin',
  };
}

function withCors(request, env, response) {
  const corsHeaders = createCorsHeaders(request, env);
  if (!corsHeaders) return response;
  if (corsHeaders === false) {
    return apiError(403, 'Origin not allowed');
  }
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function createPreflightResponse(request, env) {
  const corsHeaders = createCorsHeaders(request, env);
  if (corsHeaders === false) {
    return apiError(403, 'Origin not allowed');
  }
  return new Response(null, {
    status: 204,
    headers: corsHeaders || {},
  });
}

function isApiRequest(url) {
  return url.pathname === '/api/runtime-config' || url.pathname.startsWith('/api/');
}

function encodeBase64Url(value) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return atob(normalized + pad);
}

function timingSafeEqualString(left, right) {
  const leftBytes = new TextEncoder().encode(String(left || ''));
  const rightBytes = new TextEncoder().encode(String(right || ''));
  if (leftBytes.length !== rightBytes.length) return false;
  let result = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    result |= leftBytes[index] ^ rightBytes[index];
  }
  return result === 0;
}

async function signAttachmentToken(env, payload) {
  requireEncryptionKey(env);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.APP_ENCRYPTION_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return encodeBase64Url(String.fromCharCode(...new Uint8Array(signature)));
}

async function verifyAttachmentSignature(env, payload, signature) {
  const expected = await signAttachmentToken(env, payload);
  return timingSafeEqualString(expected, signature);
}

async function buildAttachmentUrl(request, env, attachment) {
  const expiresAt = Math.floor(Date.now() / 1000) + PUBLIC_ATTACHMENT_TTL_SECONDS;
  const payload = `${attachment.r2Key}:${expiresAt}`;
  const sig = await signAttachmentToken(env, payload);
  const url = new URL('/api/public/attachments', request.url);
  url.searchParams.set('key', encodeBase64Url(attachment.r2Key));
  url.searchParams.set('exp', String(expiresAt));
  url.searchParams.set('sig', sig);
  return url.toString();
}

async function markDomainRoutingHealth(db, userId, domainId, { ok, message = null, routingStatus = null }) {
  return updateDomain(db, userId, domainId, {
    routingStatus: routingStatus || (ok ? 'enabled' : 'degraded'),
    routingError: ok ? null : String(message || 'Routing synchronization failed'),
    routingCheckedAt: Date.now(),
  });
}

function getRealtimeStub(env, userId) {
  const id = env.REALTIME_HUB.idFromName(userId);
  return env.REALTIME_HUB.get(id);
}

async function publishRealtimeEvent(env, userId, event) {
  try {
    const stub = getRealtimeStub(env, userId);
    await stub.fetch('https://realtime.internal/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch (error) {
    console.error('realtime_publish_failed', {
      userId,
      type: event?.type,
      message: error.message,
    });
  }
}

export class RealtimeHub {
  constructor(state) {
    this.state = state;
    this.sockets = new Set();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/connect')) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected websocket', { status: 426 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      this.sockets.add(server);
      const removeSocket = () => this.sockets.delete(server);
      server.addEventListener('close', removeSocket);
      server.addEventListener('error', removeSocket);
      server.send(JSON.stringify({ type: 'realtime.connected' }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith('/publish') && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const payload = JSON.stringify({
        ...body,
        emittedAt: Date.now(),
      });
      for (const socket of [...this.sockets]) {
        try {
          socket.send(payload);
        } catch {
          this.sockets.delete(socket);
        }
      }
      return new Response('ok');
    }

    return new Response('Not found', { status: 404 });
  }
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

async function reconcileAliasRoutes(db, env, userId, options = {}) {
  const cf = await loadSecret(db, env, userId, 'cloudflare');
  if (!cf) return;

  const [domains, aliases] = await Promise.all([
    listDomains(db, userId),
    listAliasRules(db, userId),
  ]);
  const requestedDomainIds = options.domainIds ? new Set(options.domainIds) : null;
  const domainsById = new Map(
    domains
      .filter((domain) => !requestedDomainIds || requestedDomainIds.has(domain.id))
      .map((domain) => [domain.id, domain]),
  );
  const aliasesByDomain = new Map();
  for (const alias of aliases) {
    if (!domainsById.has(alias.domain_id)) continue;
    const items = aliasesByDomain.get(alias.domain_id) || [];
    items.push(alias);
    aliasesByDomain.set(alias.domain_id, items);
  }

  for (const [domainId, domain] of domainsById.entries()) {
    const domainAliases = aliasesByDomain.get(domainId) || [];
    let lastError = null;
    for (const alias of domainAliases) {
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
        lastError = error;
        console.error('alias_route_reconcile_failed', {
          aliasId: alias.id,
          domainId: alias.domain_id,
          message: error.message,
        });
      }
    }
    await markDomainRoutingHealth(db, userId, domainId, {
      ok: !lastError,
      message: lastError?.message || null,
    });
    await publishRealtimeEvent(env, userId, {
      type: lastError ? 'routing.degraded' : 'routing.updated',
      domainId,
      message: lastError?.message || null,
    });
  }
}

async function syncResendDomainMetadata(db, userId, domains, resendDomains) {
  const resendByHostname = new Map(
    (resendDomains || [])
      .map((domain) => [getResendDomainHostname(domain), domain])
      .filter(([hostname]) => hostname),
  );
  const updatedDomains = [];

  for (const domain of domains) {
    const resendDomain = resendByHostname.get(domain.hostname) || null;
    const nextResendDomainId = resendDomain?.id || null;
    const nextResendStatus = resendDomain ? getResendDomainStatus(resendDomain) : 'not_configured';
    const needsUpdate = (domain.resend_domain_id || null) !== nextResendDomainId
      || (domain.resend_status || 'not_started') !== nextResendStatus;

    updatedDomains.push(
      needsUpdate
        ? await updateDomain(db, userId, domain.id, {
            resendDomainId: nextResendDomainId,
            resendStatus: nextResendStatus,
          })
        : {
            ...domain,
            resend_domain_id: nextResendDomainId,
            resend_status: nextResendStatus,
          },
    );
  }

  return updatedDomains;
}

async function resolveSelectedSendingDomainId(db, userId, user, domains) {
  const domainIds = new Set(domains.map((domain) => domain.id));
  let selectedSendingDomainId = user?.selected_sending_domain_id || null;

  if (selectedSendingDomainId && !domainIds.has(selectedSendingDomainId)) {
    await updateUserSelectedSendingDomain(db, userId, null);
    selectedSendingDomainId = null;
  }

  if (!selectedSendingDomainId) {
    const candidates = domains.filter((domain) => domain.resend_domain_id);
    if (candidates.length === 1) {
      selectedSendingDomainId = candidates[0].id;
      await updateUserSelectedSendingDomain(db, userId, selectedSendingDomainId);
    }
  }

  return selectedSendingDomainId;
}

async function reconcileSendingDomainState(db, env, userId, options = {}) {
  const resendConnection = options.resendConnection === undefined
    ? await loadSecret(db, env, userId, 'resend')
    : options.resendConnection;
  let domains = options.domains || await listDomains(db, userId);
  if (options.refreshResendMetadata && resendConnection) {
    try {
      const resendDomains = options.resendDomains || await listResendDomains(resendConnection.secret);
      domains = await syncResendDomainMetadata(db, userId, domains, resendDomains);
    } catch (error) {
      console.error('resend_domain_metadata_sync_failed', error);
    }
  }

  if (!domains.length) {
    return {
      domains,
      selectedSendingDomainId: null,
      sendingDomainId: null,
      sendingStatusMessage: resendConnection
        ? 'No Cloudflare mail domains are provisioned yet.'
        : 'Connect Resend and add a domain to enable sending.',
    };
  }

  const user = options.user || await getUser(db, userId);
  const selectedSendingDomainId = await resolveSelectedSendingDomainId(db, userId, user, domains);
  const plan = deriveSendingDomainPlan(domains, {
    selectedSendingDomainId,
    resendConnected: Boolean(resendConnection),
  });
  const reconciledDomains = [];

  for (const domain of domains) {
    const domainPlan = plan.domainPlans.find((item) => item.domainId === domain.id);
    const needsUpdate = domain.send_capability !== domainPlan.sendCapability;

    const nextDomain = needsUpdate
      ? await updateDomain(db, userId, domain.id, {
          sendCapability: domainPlan.sendCapability,
        })
      : {
          ...domain,
          send_capability: domainPlan.sendCapability,
          sendCapability: domainPlan.sendCapability,
          canSend: domainPlan.sendCapability === SEND_CAPABILITY.ENABLED,
        };

    reconciledDomains.push({
      ...nextDomain,
      send_capability: domainPlan.sendCapability,
      sendCapability: domainPlan.sendCapability,
      canSend: domainPlan.sendCapability === SEND_CAPABILITY.ENABLED,
      isSelectedSendingDomain: nextDomain.id === plan.selectedSendingDomainId,
    });
  }

  return {
    domains: reconciledDomains,
    selectedSendingDomainId: plan.selectedSendingDomainId,
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

async function getRealtimeContext(request, env) {
  await ensureSchema(env.DB);
  const url = parseUrl(request);
  const token = url.searchParams.get('token') || parseBearerToken(request);
  if (!token) {
    const error = new Error('Missing bearer token');
    error.status = 401;
    throw error;
  }
  const profile = await verifyFirebaseToken(token, env);
  const user = await upsertUser(env.DB, profile);
  return { user };
}

async function bootstrapData(db, env, userId) {
  const [user, connections, domains, mailboxesPage, alerts] = await Promise.all([
    getUser(db, userId),
    listConnections(db, userId),
    listDomains(db, userId),
    listMailboxesPage(db, userId, { limit: 100 }),
    getAlertCounts(db, userId),
  ]);
  const resendConnected = connections.some((connection) => connection.provider === 'resend');
  const selectedSendingDomainId = domains.some((domain) => domain.id === user?.selected_sending_domain_id)
    ? user.selected_sending_domain_id
    : null;
  const sendingDomain = domains.find((domain) => domain.send_capability === SEND_CAPABILITY.ENABLED) || null;
  const selectedDomain = domains.find((domain) => domain.id === selectedSendingDomainId) || null;
  const sendingStatusMessage = sendingDomain
    ? null
    : getWorkspaceSendingStatus({ resendConnected, selectedDomain });
  const hydratedDomains = domains.map((domain) => ({
    ...domain,
    sendCapability: domain.send_capability || SEND_CAPABILITY.RECEIVE_ONLY,
    canSend: (domain.send_capability || SEND_CAPABILITY.RECEIVE_ONLY) === SEND_CAPABILITY.ENABLED,
    isSelectedSendingDomain: domain.id === selectedSendingDomainId,
  }));
  return {
    connections: connections.map(toConnectionSummary),
    domains: hydratedDomains,
    mailboxes: mailboxesPage.items,
    selectedSendingDomainId,
    sendingDomainId: sendingDomain?.id || null,
    sendingStatusMessage,
    alertCounts: alerts,
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
    user,
    resendConnection: {
      ...connection,
      secret: apiKey,
    },
    resendDomains: domains?.data || [],
    refreshResendMetadata: true,
  });
  return json({
    connection,
    selectedSendingDomainId: reconciliation.selectedSendingDomainId,
    sendingDomainId: reconciliation.sendingDomainId,
    sendingStatusMessage: reconciliation.sendingStatusMessage,
  });
}

async function handleGeminiConnection(request, env, user) {
  if (request.method === 'GET') {
    const connection = await getConnection(env.DB, user.id, 'gemini');
    return json({ connection: toConnectionSummary(connection) });
  }

  const body = await readJson(request);
  const apiKey = String(body.apiKey || '').trim();
  if (!apiKey) return apiError(400, 'Gemini API key is required');

  const defaultModel = String(body.defaultModel || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  const verification = await verifyGeminiApiKey(apiKey);
  const connection = await saveProviderConnection(
    env.DB,
    env,
    user.id,
    'gemini',
    body.label || 'Gemini',
    apiKey,
    {
      defaultModel,
      modelCount: verification.modelCount,
      availableModels: GEMINI_FREE_MODELS,
      sampleModels: verification.models
        .slice(0, 8)
        .map((model) => model.name?.replace(/^models\//, '') || ''),
    },
  );
  return json({ connection });
}

async function handleGroqConnection(request, env, user) {
  if (request.method === 'GET') {
    const connection = await getConnection(env.DB, user.id, 'groq');
    return json({ connection: toConnectionSummary(connection) });
  }

  const body = await readJson(request);
  const apiKey = String(body.apiKey || '').trim();
  if (!apiKey) return apiError(400, 'Groq API key is required');

  const verification = await verifyGroqApiKey(apiKey);
  const connection = await saveProviderConnection(
    env.DB,
    env,
    user.id,
    'groq',
    body.label || 'Llama',
    apiKey,
    {
      model: GROQ_EMAIL_MODEL,
      modelCount: verification?.data?.length || 0,
    },
  );
  return json({ connection });
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
      selectedSendingDomainId: reconciliation.selectedSendingDomainId,
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
    let routingError = null;
    try {
      await enableEmailRouting(cf.secret, zone.id);
      routingStatus = 'enabled';
    } catch (error) {
      try {
        const routing = await getEmailRouting(cf.secret, zone.id);
        routingStatus = routing.enabled ? 'enabled' : 'pending';
      } catch {
        routingStatus = 'pending';
      }
      routingError = error.message || 'Unable to confirm Cloudflare routing state';
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
      routingError: routingStatus === 'enabled' ? null : routingError,
      routingCheckedAt: Date.now(),
    });

    const resend = await loadSecret(env.DB, env, user.id, 'resend');

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

    const reconciliation = await reconcileSendingDomainState(env.DB, env, user.id, {
      user,
      resendConnection: resend,
      refreshResendMetadata: Boolean(resend),
    });
    const updatedDomain = reconciliation.domains.find((item) => item.id === domain.id) || domain;

    return json({
      domain: updatedDomain,
      mailbox,
      selectedSendingDomainId: reconciliation.selectedSendingDomainId,
      sendingDomainId: reconciliation.sendingDomainId,
      sendingStatusMessage: reconciliation.sendingStatusMessage,
    }, { status: 201 });
  }

  if (request.method === 'POST' && pathParts.length === 4 && pathParts[3] === 'refresh') {
    const domain = await getDomain(env.DB, user.id, pathParts[2]);
    if (!domain) return apiError(404, 'Domain not found');
    const cf = await loadSecret(env.DB, env, user.id, 'cloudflare');
    const resend = await loadSecret(env.DB, env, user.id, 'resend');
    const patch = {};
    if (cf) {
      try {
        const routing = await getEmailRouting(cf.secret, domain.zone_id);
        patch.routingStatus = routing.enabled ? 'enabled' : 'pending';
        patch.routingError = null;
      } catch (error) {
        patch.routingStatus = domain.routing_status;
        patch.routingError = error.message || domain.routing_error || null;
      }
      patch.routingCheckedAt = Date.now();
    }
    const updated = await updateDomain(env.DB, user.id, domain.id, patch);
    const reconciliation = await reconcileSendingDomainState(env.DB, env, user.id, {
      user,
      domains: [updated, ...(await listDomains(env.DB, user.id)).filter((item) => item.id !== updated.id)],
      resendConnection: resend,
      refreshResendMetadata: Boolean(resend),
    });
    return json({
      domain: reconciliation.domains.find((item) => item.id === updated.id) || updated,
      selectedSendingDomainId: reconciliation.selectedSendingDomainId,
      sendingDomainId: reconciliation.sendingDomainId,
      sendingStatusMessage: reconciliation.sendingStatusMessage,
    });
  }

  if (request.method === 'POST' && pathParts.length === 4 && pathParts[3] === 'repair-routing') {
    const domain = await getDomain(env.DB, user.id, pathParts[2]);
    if (!domain) return apiError(404, 'Domain not found');
    await reconcileAliasRoutes(env.DB, env, user.id, {
      domainIds: [domain.id],
    });
    const updated = await getDomain(env.DB, user.id, domain.id);
    return json({ domain: updated });
  }

  if (request.method === 'POST' && pathParts.length === 4 && pathParts[3] === 'select-sending') {
    const domain = await getDomain(env.DB, user.id, pathParts[2]);
    if (!domain) return apiError(404, 'Domain not found');
    const updatedUser = await updateUserSelectedSendingDomain(env.DB, user.id, domain.id);
    const reconciliation = await reconcileSendingDomainState(env.DB, env, user.id, {
      user: updatedUser,
    });
    return json({
      domain: reconciliation.domains.find((item) => item.id === domain.id) || domain,
      selectedSendingDomainId: reconciliation.selectedSendingDomainId,
      sendingDomainId: reconciliation.sendingDomainId,
      sendingStatusMessage: reconciliation.sendingStatusMessage,
    });
  }

  return apiError(405, 'Unsupported domain route');
}

async function handleMailboxes(request, env, user, pathParts) {
  if (request.method === 'GET') {
    const url = parseUrl(request);
    const page = await listMailboxesPage(env.DB, user.id, {
      domainId: url.searchParams.get('domainId'),
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
    });
    return json({
      items: page.items,
      nextCursor: page.nextCursor,
      mailboxes: page.items,
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
    const current = await getMailbox(env.DB, user.id, pathParts[2]);
    if (!current) return apiError(404, 'Mailbox not found');
    const localPart = body.localPart ? slugifyLocalPart(body.localPart) : current.local_part;
    const domain = await getDomain(env.DB, user.id, current.domain_id);
    const mailbox = await updateMailbox(env.DB, user.id, pathParts[2], {
      ...body,
      localPart,
      emailAddress: `${localPart}@${domain.hostname}`,
    });
    if (!mailbox) return apiError(404, 'Mailbox not found');
    return json({ mailbox });
  }

  if (request.method === 'DELETE' && pathParts.length === 3) {
    const dependencies = await getMailboxDependencySummary(env.DB, user.id, pathParts[2]);
    if (dependencies.inboxAliasCount || dependencies.catchAllCount) {
      return apiError(
        409,
        'This mailbox is still used by inbox aliases or catch-all delivery. Reassign those rules before deleting the mailbox.',
      );
    }
    const mailbox = await deleteMailbox(env.DB, user.id, pathParts[2]);
    if (!mailbox) return apiError(404, 'Mailbox not found');
    return json({ mailbox, ok: true });
  }

  return apiError(405, 'Unsupported mailbox route');
}

async function handleForwardDestinations(request, env, user) {
  const cf = await loadSecret(env.DB, env, user.id, 'cloudflare');
  if (request.method === 'GET') {
    const url = parseUrl(request);
    const page = await listForwardDestinationsPage(env.DB, user.id, {
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
    });
    return json({
      items: page.items,
      nextCursor: page.nextCursor,
      forwardDestinations: page.items,
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
    const page = await listAliasRulesPage(env.DB, user.id, {
      domainId: url.searchParams.get('domainId'),
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
    });
    return json({
      items: page.items,
      nextCursor: page.nextCursor,
      aliases: page.items,
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

    let cloudflareRule;
    try {
      cloudflareRule = body.isCatchAll
        ? await updateCatchAllRule(cf.secret, domain.zone_id, payload)
        : await upsertRoutingRule(cf.secret, domain.zone_id, null, payload);
      await markDomainRoutingHealth(env.DB, user.id, domain.id, { ok: true });
      await publishRealtimeEvent(env, user.id, {
        type: 'routing.updated',
        domainId: domain.id,
      });
    } catch (error) {
      await markDomainRoutingHealth(env.DB, user.id, domain.id, { ok: false, message: error.message });
      await publishRealtimeEvent(env, user.id, {
        type: 'routing.degraded',
        domainId: domain.id,
        message: error.message,
      });
      throw error;
    }

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
    try {
      if (existing.is_catch_all) {
        cloudflareRule = await updateCatchAllRule(cf.secret, domain.zone_id, payload);
      } else {
        cloudflareRule = await upsertRoutingRule(cf.secret, domain.zone_id, existing.cloudflare_rule_id, payload);
      }
      await markDomainRoutingHealth(env.DB, user.id, domain.id, { ok: true });
      await publishRealtimeEvent(env, user.id, {
        type: 'routing.updated',
        domainId: domain.id,
      });
    } catch (error) {
      await markDomainRoutingHealth(env.DB, user.id, domain.id, { ok: false, message: error.message });
      await publishRealtimeEvent(env, user.id, {
        type: 'routing.degraded',
        domainId: domain.id,
        message: error.message,
      });
      throw error;
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
    try {
      if (existing.is_catch_all) {
        await updateCatchAllRule(cf.secret, domain.zone_id, {
          enabled: false,
          matchers: [{ type: 'all' }],
          actions: [{ type: 'drop' }],
        });
      } else if (existing.cloudflare_rule_id) {
        await deleteRoutingRule(cf.secret, domain.zone_id, existing.cloudflare_rule_id);
      }
      await markDomainRoutingHealth(env.DB, user.id, domain.id, { ok: true });
      await publishRealtimeEvent(env, user.id, {
        type: 'routing.updated',
        domainId: domain.id,
      });
    } catch (error) {
      await markDomainRoutingHealth(env.DB, user.id, domain.id, { ok: false, message: error.message });
      await publishRealtimeEvent(env, user.id, {
        type: 'routing.degraded',
        domainId: domain.id,
        message: error.message,
      });
      throw error;
    }
    await deleteAliasRule(env.DB, user.id, existing.id);
    if (existing.is_catch_all) {
      await updateDomain(env.DB, user.id, domain.id, {
        catchAllMode: 'inbox_only',
        catchAllMailboxId: null,
        catchAllForwardIds: [],
      });
    }
    return json({ ok: true });
  }

  return apiError(405, 'Unsupported alias route');
}

async function handleThreads(request, env, user, pathParts) {
  if (request.method === 'GET' && pathParts.length === 2) {
    const url = parseUrl(request);
    const page = await listThreadsPage(env.DB, user.id, {
      folder: url.searchParams.get('folder') || 'inbox',
      mailboxId: url.searchParams.get('mailboxId') || null,
      domainId: url.searchParams.get('domainId') || null,
      query: url.searchParams.get('query') || '',
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
    });
    return json({
      items: page.items,
      nextCursor: page.nextCursor,
      threads: page.items,
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
    await publishRealtimeEvent(env, user.id, {
      type: 'thread.updated',
      threadId: thread.id,
      folder: thread.folder,
    });
    return json({ thread });
  }

  return apiError(405, 'Unsupported thread route');
}

async function handleDrafts(request, env, user, pathParts) {
  if (request.method === 'GET' && pathParts.length === 2) {
    const url = parseUrl(request);
    const page = await listDraftsPage(env.DB, user.id, {
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
    });
    return json({
      items: page.items,
      nextCursor: page.nextCursor,
      drafts: page.items,
    });
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
    await publishRealtimeEvent(env, user.id, {
      type: 'draft.updated',
      draftId: draft.id,
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
    await publishRealtimeEvent(env, user.id, {
      type: 'draft.updated',
      draftId: draft.id,
    });
    return json({ draft });
  }

  if (request.method === 'DELETE' && pathParts.length === 3) {
    await deleteDraft(env.DB, user.id, pathParts[2]);
    await publishRealtimeEvent(env, user.id, {
      type: 'draft.updated',
      draftId: pathParts[2],
      deleted: true,
    });
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function preserveSpacesForHtml(text) {
  return escapeHtml(text).replace(/(^ +| {2,})/g, (segment) => '&nbsp;'.repeat(segment.length));
}

function textToEmailHtml(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) return '';
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split('\n').map((line) => preserveSpacesForHtml(line)).join('<br>'));
  return `<div>${paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('')}</div>`;
}

async function prepareResendAttachments(request, env, attachments) {
  let totalBytes = 0;
  const result = [];
  for (const attachment of attachments || []) {
    const byteSize = Number(attachment.byteSize || 0);
    if (byteSize > MAX_ATTACHMENT_BYTES) {
      const maxMb = Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024);
      const error = new Error(`Attachment "${attachment.fileName}" exceeds the ${maxMb} MB limit.`);
      error.status = 400;
      throw error;
    }
    totalBytes += byteSize;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      const maxMb = Math.round(MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024);
      const error = new Error(`Attachments exceed the ${maxMb} MB total limit.`);
      error.status = 400;
      throw error;
    }
    result.push({
      filename: attachment.fileName,
      path: await buildAttachmentUrl(request, env, attachment),
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
    return apiError(400, 'Choose a sender mailbox from the selected sending domain before sending.');
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
        || 'Selected mailbox does not belong to the active sending domain. Choose a sender from the selected sending domain.',
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
  const attachments = await prepareResendAttachments(request, env, payload.attachments || []);
  const htmlBody = String(payload.htmlBody || '').trim() || textToEmailHtml(payload.textBody || '');
  const sendResult = await sendResendEmail(resend.secret, {
    from: formatSender(mailbox.display_name, mailbox.email_address),
    to: to.map((item) => item.email),
    cc: cc.map((item) => item.email),
    bcc: bcc.map((item) => item.email),
    subject: payload.subject || '(no subject)',
    text: payload.textBody || '',
    html: htmlBody,
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
    htmlBody,
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

  await publishRealtimeEvent(env, user.id, {
    type: 'thread.updated',
    threadId: stored.threadId,
    folder: 'sent',
  });
  if (draftId) {
    await publishRealtimeEvent(env, user.id, {
      type: 'draft.updated',
      draftId,
      deleted: true,
    });
  }

  return json({ sent: sendResult, stored });
}

async function handleAiAssist(request, env, user) {
  const body = await readJson(request);
  const provider = String(body.provider || '').trim().toLowerCase();
  if (!['gemini', 'groq'].includes(provider)) {
    return apiError(400, 'Choose Gemini or Llama for AI compose and rewrite.');
  }

  const connection = await loadSecret(env.DB, env, user.id, provider);
  if (!connection) {
    return apiError(
      400,
      provider === 'groq'
        ? 'Connect Llama in Connections to enable Groq-powered rewrite and compose.'
        : 'Connect Gemini in Connections to enable Gemini-powered rewrite and compose.',
    );
  }

  const aiRequest = buildAiAssistRequest({
    action: body.action,
    prompt: body.prompt,
    tone: body.tone,
    outputMode: body.outputMode,
    subject: body.subject,
    textBody: body.textBody,
    selectionText: body.selectionText,
    to: body.to || [],
    cc: body.cc || [],
    bcc: body.bcc || [],
  });

  const model = provider === 'groq'
    ? GROQ_EMAIL_MODEL
    : String(
        body.model
          || connection.metadata_json?.defaultModel
          || DEFAULT_GEMINI_MODEL,
      ).trim() || DEFAULT_GEMINI_MODEL;

  const result = provider === 'groq'
    ? await generateGroqChat(connection.secret, {
        systemInstruction: aiRequest.systemInstruction,
        prompt: aiRequest.prompt,
      })
    : await generateGeminiContent(connection.secret, {
        model,
        systemInstruction: aiRequest.systemInstruction,
        prompt: aiRequest.prompt,
      });

  return json({
    provider,
    action: aiRequest.action,
    tone: aiRequest.tone,
    useSelection: aiRequest.useSelection,
    model,
    result: parseAiAssistResult(result.text, {
      useSelection: aiRequest.useSelection,
      outputMode: aiRequest.outputMode,
      fallbackSubject: body.subject || '',
      fallbackText: body.textBody || '',
      fallbackHtml: body.htmlBody || '',
    }),
  });
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

async function handlePublicAttachment(request, env) {
  const url = parseUrl(request);
  const key = url.searchParams.get('key');
  const exp = Number(url.searchParams.get('exp') || 0);
  const sig = url.searchParams.get('sig') || '';
  if (!key || !exp || !sig) return apiError(400, 'Missing attachment signature');
  if (exp < Math.floor(Date.now() / 1000)) return apiError(403, 'Attachment URL expired');
  const r2Key = decodeBase64Url(key);
  const valid = await verifyAttachmentSignature(env, `${r2Key}:${exp}`, sig);
  if (!valid) return apiError(403, 'Invalid attachment signature');
  const object = await env.MAIL_BUCKET.get(r2Key);
  if (!object) return apiError(404, 'Attachment not found');
  const headers = new Headers();
  object.writeHttpMetadata(headers);
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
  if (payload.userId && await findInboundMessageByRawKey(env.DB, payload.userId, payload.rawKey)) {
    return;
  }
  const object = await env.MAIL_BUCKET.get(payload.rawKey);
  if (!object) {
    await recordIngestFailure(env.DB, {
      userId: payload.userId || null,
      domainId: payload.domainId || null,
      recipient: payload.to || '',
      messageId: payload.messageId || null,
      rawKey: payload.rawKey,
      reason: 'raw_message_missing',
      payload,
    });
    if (payload.userId) {
      await publishRealtimeEvent(env, payload.userId, {
        type: 'ingest.failed',
        reason: 'raw_message_missing',
      });
    }
    return;
  }
  const parser = new PostalMime();
  const parsed = await parser.parse(await object.arrayBuffer());
  const aliasMetadata = payload.userId
    ? payload
    : await getAliasRuleByRecipient(env.DB, payload.to);
  if (!aliasMetadata) {
    await recordIngestFailure(env.DB, {
      userId: payload.userId || null,
      domainId: payload.domainId || null,
      recipient: payload.to || '',
      messageId: parsed.messageId || payload.messageId || null,
      rawKey: payload.rawKey,
      reason: 'alias_not_found',
      payload,
    });
    if (payload.userId) {
      await publishRealtimeEvent(env, payload.userId, {
        type: 'ingest.failed',
        reason: 'alias_not_found',
      });
    }
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

    const stored = await saveInboundMessage(env.DB, {
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
    await publishRealtimeEvent(env, aliasMetadata.user_id || aliasMetadata.userId, {
      type: 'thread.updated',
      threadId: stored.threadId,
      folder: 'inbox',
      duplicate: stored.duplicate,
    });
}

export default {
  async fetch(request, env) {
    const url = parseUrl(request);
    if (isApiRequest(url)) {
      if (request.method === 'OPTIONS') {
        return createPreflightResponse(request, env);
      }
      if (createCorsHeaders(request, env) === false) {
        return apiError(403, 'Origin not allowed');
      }
    }
    if (url.pathname === '/api/runtime-config') {
      return withCors(request, env, json(buildRuntimeConfig(env)));
    }

    if (url.pathname === '/api/public/attachments' && request.method === 'GET') {
      return withCors(request, env, await handlePublicAttachment(request, env));
    }

    if (url.pathname === '/api/realtime' && request.method === 'GET') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return apiError(426, 'Expected websocket upgrade');
      }
      const { user } = await getRealtimeContext(request, env);
      const stub = getRealtimeStub(env, user.id);
      return stub.fetch('https://realtime.internal/connect', {
        headers: request.headers,
      });
    }

    const parts = parsePath(url);
    if (parts[0] !== 'api') {
      const assetResponse = await env.ASSETS.fetch(request);
      return withCors(request, env, assetResponse);
    }

    try {
      const { user } = await getAuthenticatedContext(request, env);

      if (parts[1] === 'bootstrap' && request.method === 'GET') {
        return withCors(request, env, json({
          user,
          ...(await bootstrapData(env.DB, env, user.id)),
        }));
      }

      if (parts[1] === 'session' && request.method === 'GET') {
        return withCors(request, env, json({ user }));
      }

      if (parts[1] === 'providers' && parts[2] === 'cloudflare') {
        return withCors(request, env, await handleCloudflareConnection(request, env, user));
      }

      if (parts[1] === 'providers' && parts[2] === 'resend') {
        return withCors(request, env, await handleResendConnection(request, env, user));
      }

      if (parts[1] === 'providers' && parts[2] === 'gemini') {
        return withCors(request, env, await handleGeminiConnection(request, env, user));
      }

      if (parts[1] === 'providers' && parts[2] === 'groq') {
        return withCors(request, env, await handleGroqConnection(request, env, user));
      }

      if (parts[1] === 'cloudflare' && parts[2] === 'zones' && request.method === 'GET') {
        return withCors(request, env, await handleCloudflareZones(env, user));
      }

      if (parts[1] === 'domains') {
        return withCors(request, env, await handleDomains(request, env, user, parts));
      }

      if (parts[1] === 'mailboxes') {
        return withCors(request, env, await handleMailboxes(request, env, user, parts));
      }

      if (parts[1] === 'forward-destinations') {
        return withCors(request, env, await handleForwardDestinations(request, env, user));
      }

      if (parts[1] === 'aliases') {
        return withCors(request, env, await handleAliases(request, env, user, parts));
      }

      if (parts[1] === 'threads') {
        return withCors(request, env, await handleThreads(request, env, user, parts));
      }

      if (parts[1] === 'drafts') {
        return withCors(request, env, await handleDrafts(request, env, user, parts));
      }

      if (parts[1] === 'uploads' && request.method === 'POST') {
        return withCors(request, env, await handleUpload(request, env, user));
      }

      if (parts[1] === 'send' && request.method === 'POST') {
        return withCors(request, env, await handleSend(request, env, user));
      }

      if (parts[1] === 'ai' && parts[2] === 'assist' && request.method === 'POST') {
        return withCors(request, env, await handleAiAssist(request, env, user));
      }

      if (parts[1] === 'attachments' && parts[2] && request.method === 'GET') {
        return withCors(request, env, await handleAttachmentDownload(env, user, parts[2]));
      }

      return withCors(request, env, apiError(404, 'Route not found'));
    } catch (error) {
      console.error('worker_error', error);
      return withCors(request, env, apiError(error.status || 500, error.message || 'Internal server error'));
    }
  },

  async email(message, env, ctx) {
    await ensureSchema(env.DB);
    const aliasRule = await getAliasRuleByRecipient(env.DB, message.to);
    if (!aliasRule) {
      const rawKey = `raw/${Date.now()}-${createId('raw_')}.eml`;
      const raw = await new Response(message.raw).arrayBuffer();
      await env.MAIL_BUCKET.put(rawKey, raw, {
        httpMetadata: {
          contentType: 'message/rfc822',
        },
      });
      await recordIngestFailure(env.DB, {
        recipient: message.to || '',
        messageId: message.headers?.get?.('message-id') || null,
        rawKey,
        reason: 'alias_not_found',
        payload: {
          to: message.to,
          from: message.from,
        },
      });
      console.warn('email_alias_not_found', { to: message.to, rawKey });
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
