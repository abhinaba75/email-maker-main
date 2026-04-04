const state = {
  runtime: null,
  auth: null,
  firebase: null,
  user: null,
  token: '',
  zones: [],
  data: {
    connections: [],
    domains: [],
    mailboxes: [],
    forwardDestinations: [],
    aliases: [],
    drafts: [],
  },
  sendingDomainId: null,
  sendingStatusMessage: null,
  threads: [],
  selectedThread: null,
  view: 'mail',
  folder: 'inbox',
  mailboxId: null,
  status: 'Booting mail console...',
  compose: null,
};

const refs = {
  bootScreen: document.getElementById('bootScreen'),
  loginOverlay: document.getElementById('loginOverlay'),
  loginMessage: document.getElementById('loginMessage'),
  googleLoginButton: document.getElementById('googleLoginButton'),
  appShell: document.getElementById('appShell'),
  sidebarTree: document.getElementById('sidebarTree'),
  contentView: document.getElementById('contentView'),
  statusMessage: document.getElementById('statusMessage'),
  statusUser: document.getElementById('statusUser'),
  statusFolder: document.getElementById('statusFolder'),
  userCard: document.getElementById('userCard'),
  searchBox: document.getElementById('searchBox'),
  composeOverlay: document.getElementById('composeOverlay'),
};

const sidebarModel = [
  {
    group: 'Mailbox',
    items: [
      { id: 'mail:inbox', label: 'Inbox' },
      { id: 'mail:sent', label: 'Sent Items' },
      { id: 'drafts', label: 'Drafts' },
      { id: 'mail:archive', label: 'Archive' },
      { id: 'mail:trash', label: 'Deleted Items' },
    ],
  },
  {
    group: 'Configuration',
    items: [
      { id: 'connections', label: 'Connections' },
      { id: 'domains', label: 'Domains & Mailboxes' },
      { id: 'aliases', label: 'Aliases & Catch-All' },
      { id: 'destinations', label: 'Forward Destinations' },
    ],
  },
];

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStatus(message) {
  state.status = message;
  refs.statusMessage.textContent = message;
}

function formatDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatAddresses(items) {
  return (items || [])
    .map((item) => {
      if (!item) return '';
      if (typeof item === 'string') return item;
      return item.name ? `${item.name} <${item.email}>` : item.email;
    })
    .filter(Boolean)
    .join(', ');
}

function getMailboxById(id) {
  return state.data.mailboxes.find((mailbox) => mailbox.id === id) || null;
}

function getDomainById(id) {
  return state.data.domains.find((domain) => domain.id === id) || null;
}

function getDomainSendCapability(domainId) {
  const domain = getDomainById(domainId);
  return domain?.sendCapability || domain?.send_capability || 'send_unavailable';
}

function getSendingDomain() {
  return state.data.domains.find((domain) => domain.id === state.sendingDomainId && domain.canSend) || null;
}

function getSendingMailboxes() {
  const sendingDomain = getSendingDomain();
  if (!sendingDomain) return [];
  return state.data.mailboxes.filter((mailbox) => mailbox.domain_id === sendingDomain.id);
}

function getDefaultMailbox() {
  const sendingMailboxes = getSendingMailboxes();
  return sendingMailboxes.find((mailbox) => mailbox.is_default_sender) || sendingMailboxes[0] || null;
}

function requireSendingMailbox() {
  const mailbox = getDefaultMailbox();
  if (!mailbox) {
    throw new Error(
      state.sendingStatusMessage
        || 'Sending is unavailable until exactly one verified Resend domain matches a Cloudflare mail domain.',
    );
  }
  return mailbox;
}

function formatSendCapability(value) {
  if (value === 'send_enabled') return 'Send enabled';
  if (value === 'receive_only') return 'Receive only';
  return 'Send unavailable';
}

function getSendingSummaryMessage() {
  const sendingDomain = getSendingDomain();
  if (sendingDomain) {
    return `Sending is enabled only on ${sendingDomain.hostname}. All other domains remain receive-only.`;
  }
  return state.sendingStatusMessage
    || 'Receiving works for every Cloudflare domain. Sending is unavailable until one exact-match Resend domain is verified.';
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
  }
  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }
  const response = await fetch(path, {
    ...options,
    headers,
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {
      // Ignore non-JSON errors.
    }
    throw new Error(message);
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response;
}

async function initFirebase() {
  const config = state.runtime.firebase;
  refs.bootScreen.classList.add('hidden');
  refs.loginOverlay.classList.remove('hidden');
  refs.appShell.classList.add('hidden');

  if (!config.apiKey || !config.projectId) {
    refs.loginMessage.textContent = 'Firebase runtime configuration is incomplete.';
    return;
  }

  try {
    const [{ initializeApp }, authModule] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js'),
    ]);

    const app = initializeApp(config);
    const auth = authModule.getAuth(app);
    const provider = new authModule.GoogleAuthProvider();

    state.firebase = { authModule, provider };
    state.auth = auth;

    refs.googleLoginButton.addEventListener('click', async () => {
      try {
        refs.loginMessage.textContent = 'Opening Google sign-in...';
        await authModule.signInWithPopup(auth, provider);
      } catch (error) {
        refs.loginMessage.textContent = error.message;
      }
    });

    authModule.onAuthStateChanged(auth, async (user) => {
      if (!user) {
        state.user = null;
        state.token = '';
        refs.loginOverlay.classList.remove('hidden');
        refs.appShell.classList.add('hidden');
        refs.loginMessage.textContent = 'Sign in to continue.';
        return;
      }

      state.token = await user.getIdToken();
      refs.loginOverlay.classList.add('hidden');
      refs.appShell.classList.remove('hidden');
      await refreshBootstrap();
      await loadZones();
    });
  } catch (error) {
    console.error(error);
    refs.loginMessage.textContent = `Google sign-in failed to initialize: ${error.message || 'unknown error'}`;
  }
}

async function refreshBootstrap() {
  setStatus('Loading workspace...');
  const payload = await api('/api/bootstrap');
  state.user = payload.user;
  state.sendingDomainId = payload.sendingDomainId || null;
  state.sendingStatusMessage = payload.sendingStatusMessage || null;
  state.data = {
    connections: payload.connections || [],
    domains: payload.domains || [],
    mailboxes: payload.mailboxes || [],
    forwardDestinations: payload.forwardDestinations || [],
    aliases: payload.aliases || [],
    drafts: payload.drafts || [],
  };
  if (state.view === 'mail') {
    await loadThreads();
  } else {
    render();
  }
}

async function loadThreads() {
  if (!state.user) return;
  setStatus(`Loading ${state.folder}...`);
  const query = new URLSearchParams({ folder: state.folder });
  if (state.mailboxId) query.set('mailboxId', state.mailboxId);
  if (refs.searchBox.value.trim()) query.set('query', refs.searchBox.value.trim());
  const payload = await api(`/api/threads?${query.toString()}`);
  state.threads = payload.threads || [];
  const selected = state.threads.find((thread) => thread.id === state.selectedThread?.id) || state.threads[0] || null;
  state.selectedThread = null;
  render();
  if (selected) {
    await selectThread(selected.id);
  } else {
    setStatus(`Ready. ${state.threads.length} thread(s) in ${state.folder}.`);
  }
}

async function selectThread(threadId) {
  const payload = await api(`/api/threads/${threadId}`);
  state.selectedThread = payload.thread;
  render();
  setStatus(`Opened "${state.selectedThread.subject || '(no subject)'}"`);
}

function switchView(target) {
  if (target.startsWith('mail:')) {
    state.view = 'mail';
    state.folder = target.split(':')[1];
    state.mailboxId = null;
    state.selectedThread = null;
    loadThreads().catch(showError);
    return;
  }
  state.view = target;
  state.selectedThread = null;
  render();
}

async function loadZones() {
  try {
    const payload = await api('/api/cloudflare/zones');
    state.zones = payload.zones || [];
  } catch {
    state.zones = [];
  }
}

function renderSidebar() {
  const domainNodes = state.data.domains.map((domain) => {
    const mailboxes = state.data.mailboxes.filter((mailbox) => mailbox.domain_id === domain.id);
    return `
      <div class="tree-group">
        <div class="tree-group-label">${escapeHtml(domain.hostname)}</div>
        ${mailboxes.map((mailbox) => `
          <div class="tree-item ${state.mailboxId === mailbox.id && state.view === 'mail' ? 'active' : ''}" data-mailbox="${mailbox.id}">
            <span>✉</span>
            <span>${escapeHtml(mailbox.email_address)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');

  refs.sidebarTree.innerHTML = `
    ${sidebarModel.map((group) => `
      <div class="tree-group">
        <div class="tree-group-label">${group.group}</div>
        ${group.items.map((item) => {
          const isActive = item.id === state.view || item.id === `mail:${state.folder}`;
          const badge = item.id === `mail:${state.folder}` ? state.threads.length : '';
          return `
            <div class="tree-item ${isActive ? 'active' : ''}" data-view="${item.id}">
              <span>${item.id.startsWith('mail:') ? '▸' : '◆'}</span>
              <span>${item.label}</span>
              ${badge ? `<span class="tree-badge">${badge}</span>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `).join('')}
    ${domainNodes}
  `;

  refs.userCard.innerHTML = state.user ? `
    <strong>${escapeHtml(state.user.display_name || state.user.email)}</strong><br>
    ${escapeHtml(state.user.email)}<br>
    <button class="button" id="logoutButton" type="button">Sign out</button>
  ` : '<span class="muted">Not signed in.</span>';

  const logoutButton = document.getElementById('logoutButton');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      await state.firebase.authModule.signOut(state.auth);
    });
  }
}

function renderMailView() {
  const mailboxFilter = state.mailboxId ? getMailboxById(state.mailboxId) : null;
  const emptyMessage = state.data.domains.length
    ? `No messages in ${mailboxFilter?.email_address || 'your inbox'} yet. Incoming mail will appear here after the alias route processes a message.`
    : 'Add a domain, mailbox, and alias rule to start receiving mail in the console.';
  refs.contentView.innerHTML = `
    <div class="mail-layout">
      <section class="split-panel">
        <div class="mail-list-head">
          <span>${escapeHtml(state.folder.replace(/^\w/, (x) => x.toUpperCase()))}</span>
          <span class="muted">${escapeHtml(mailboxFilter?.email_address || 'All mailboxes')} • ${state.threads.length} thread(s)</span>
        </div>
        <div class="list-grid">
          ${state.threads.length ? state.threads.map((thread) => `
            <div class="list-row ${state.selectedThread?.id === thread.id ? 'active' : ''}" data-thread="${thread.id}">
              <div><strong>${escapeHtml(thread.mailbox_email || thread.hostname || '')}</strong></div>
              <div>
                <strong>${escapeHtml(thread.subject || '(no subject)')}</strong><br>
                <span>${escapeHtml(thread.snippet || '')}</span>
              </div>
              <div>${escapeHtml(formatDateTime(thread.latest_message_at))}</div>
            </div>
          `).join('') : `<div class="surface"><span class="muted">${escapeHtml(emptyMessage)}</span></div>`}
        </div>
      </section>

      <section class="split-panel">
        <div class="mail-list-head">
          <span>${escapeHtml(state.selectedThread?.subject || 'Preview')}</span>
          ${state.selectedThread ? `<span class="muted">${state.selectedThread.messages.length} message(s)</span>` : ''}
        </div>
        <div class="preview-stack">
          ${state.selectedThread ? state.selectedThread.messages.map((message) => `
            <article class="message-card">
              <div class="message-meta">
                <div><strong>From:</strong> ${escapeHtml(formatAddresses([message.from_json]))}</div>
                <div><strong>To:</strong> ${escapeHtml(formatAddresses(message.to_json))}</div>
                ${message.cc_json?.length ? `<div><strong>Cc:</strong> ${escapeHtml(formatAddresses(message.cc_json))}</div>` : ''}
                <div><strong>Date:</strong> ${escapeHtml(formatDateTime(message.sent_at || message.received_at || message.created_at))}</div>
              </div>
              <div class="message-body">${escapeHtml(message.text_body || message.snippet || '(no content)')}</div>
              ${message.attachments?.length ? `
                <div class="message-attachments">
                  ${message.attachments.map((attachment) => `
                    <button class="attachment-pill" type="button" data-attachment="${attachment.id}">
                      📎 ${escapeHtml(attachment.file_name)}
                    </button>
                  `).join('')}
                </div>
              ` : ''}
            </article>
          `).join('') : `<div class="surface"><span class="muted">Select a thread to preview the conversation.</span></div>`}
        </div>
      </section>
    </div>
  `;
}

function renderConnectionsView() {
  const cf = state.data.connections.find((item) => item.provider === 'cloudflare');
  const resend = state.data.connections.find((item) => item.provider === 'resend');
  const sendingDomain = getSendingDomain();
  refs.contentView.innerHTML = `
    <div class="stack">
      <section class="property-sheet">
        <div class="property-title">Provider Connections</div>
        <div class="form-grid">
          <form id="cloudflareForm" class="stack">
            <label class="label">Label<input name="label" value="${escapeHtml(cf?.label || 'Cloudflare')}"></label>
            <label class="label">API Token<input name="token" type="password" placeholder="Cloudflare API Token"></label>
            <div class="muted">Stored encrypted on the Worker. Current: ${escapeHtml(cf?.secretMask || 'Not connected')}</div>
            <button class="button primary" type="submit">Save Cloudflare Connection</button>
          </form>
          <form id="resendForm" class="stack">
            <label class="label">Label<input name="label" value="${escapeHtml(resend?.label || 'Resend')}"></label>
            <label class="label">API Key<input name="apiKey" type="password" placeholder="re_..."></label>
            <div class="muted">Stored encrypted on the Worker. Current: ${escapeHtml(resend?.secretMask || 'Not connected')}</div>
            <button class="button primary" type="submit">Save Resend Connection</button>
          </form>
        </div>
        <div class="notice">
          Cloudflare powers receiving, alias rules, and forwarding for every configured domain. Resend only enables outbound send on the one exact-match verified domain.
          <br>
          ${escapeHtml(sendingDomain ? `Active sending domain: ${sendingDomain.hostname}` : getSendingSummaryMessage())}
        </div>
      </section>
    </div>
  `;

  document.getElementById('cloudflareForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      setStatus('Verifying Cloudflare token...');
      await api('/api/providers/cloudflare', {
        method: 'POST',
        body: JSON.stringify({
          label: form.get('label'),
          token: form.get('token'),
        }),
      });
      await refreshBootstrap();
      setStatus('Cloudflare connected.');
    } catch (error) {
      showError(error);
    }
  });

  document.getElementById('resendForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      setStatus('Verifying Resend API key...');
      await api('/api/providers/resend', {
        method: 'POST',
        body: JSON.stringify({
          label: form.get('label'),
          apiKey: form.get('apiKey'),
        }),
      });
      await refreshBootstrap();
      setStatus('Resend connected.');
    } catch (error) {
      showError(error);
    }
  });
}

function renderDomainsView() {
  refs.contentView.innerHTML = `
    <div class="stack">
      <section class="property-sheet">
        <div class="property-title">Add Domain</div>
        <form id="domainForm" class="form-grid">
          <label class="label">
            Cloudflare Zone
            <select name="zoneId">
              <option value="">Select a zone</option>
              ${state.zones.map((zone) => `<option value="${zone.id}">${escapeHtml(zone.name)}</option>`).join('')}
            </select>
          </label>
          <label class="label">Mail Hostname<input name="hostname" placeholder="mail.example.com or example.com"></label>
          <label class="label">Label<input name="label" placeholder="Primary Brand Mail"></label>
          <label class="label">Default Sender Local Part<input name="defaultMailboxLocalPart" value="admin"></label>
          <label class="label full">Display Name<input name="displayName" placeholder="Alias Forge Operator"></label>
          <div class="full"><button class="button primary" type="submit">Provision Domain</button></div>
        </form>
        <div class="notice">
          Cloudflare is enough to provision receiving. Sending turns on automatically only when exactly one verified Resend domain matches a Cloudflare hostname exactly.
        </div>
      </section>

      <section class="property-sheet">
        <div class="property-title">Provisioned Domains</div>
        <table class="grid-table">
          <thead>
            <tr><th>Hostname</th><th>Routing</th><th>Capability</th><th>Resend</th><th>Mailboxes</th><th>Action</th></tr>
          </thead>
          <tbody>
            ${state.data.domains.map((domain) => {
              const mailboxes = state.data.mailboxes.filter((mailbox) => mailbox.domain_id === domain.id);
              return `
                <tr>
                  <td>${escapeHtml(domain.hostname)}</td>
                  <td>${escapeHtml(domain.routing_status)}</td>
                  <td>${escapeHtml(formatSendCapability(domain.sendCapability || domain.send_capability))}</td>
                  <td>${escapeHtml(domain.resend_status)}</td>
                  <td>${mailboxes.map((mailbox) => escapeHtml(mailbox.email_address)).join('<br>')}</td>
                  <td><button class="button refresh-domain" data-domain="${domain.id}" type="button">Refresh</button></td>
                </tr>
              `;
            }).join('') || '<tr><td colspan="6" class="muted">No domains configured.</td></tr>'}
          </tbody>
        </table>
        <div class="notice">${escapeHtml(getSendingSummaryMessage())}</div>
      </section>

      <section class="property-sheet">
        <div class="property-title">Add Mailbox</div>
        <form id="mailboxForm" class="form-grid">
          <label class="label">
            Domain
            <select name="domainId">
              <option value="">Select a domain</option>
              ${state.data.domains.map((domain) => `<option value="${domain.id}">${escapeHtml(domain.hostname)}</option>`).join('')}
            </select>
          </label>
          <label class="label">Local Part<input name="localPart" placeholder="sales"></label>
          <label class="label">Display Name<input name="displayName" placeholder="Sales Desk"></label>
          <label class="label">Signature Text<input name="signatureText" placeholder="Regards, Sales Desk"></label>
          <label class="label full">Signature HTML<textarea name="signatureHtml" placeholder="<p>Regards,<br>Sales Desk</p>"></textarea></label>
          <label class="label"><input type="checkbox" name="isDefaultSender"> Default sender for domain</label>
          <div class="full"><button class="button" type="submit">Create Mailbox</button></div>
        </form>
        <div class="notice">Default sender preference only matters on the one send-enabled domain. Receive-only domains still work for inboxes, aliases, and forwarding.</div>
      </section>
    </div>
  `;

  document.getElementById('domainForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      setStatus('Provisioning domain...');
      await api('/api/domains', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      await refreshBootstrap();
      setStatus('Domain provisioned.');
    } catch (error) {
      showError(error);
    }
  });

  document.querySelectorAll('.refresh-domain').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        setStatus('Refreshing domain status...');
        await api(`/api/domains/${button.dataset.domain}/refresh`, { method: 'POST', body: JSON.stringify({}) });
        await refreshBootstrap();
        setStatus('Domain refreshed.');
      } catch (error) {
        showError(error);
      }
    });
  });

  document.getElementById('mailboxForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    body.isDefaultSender = form.get('isDefaultSender') === 'on';
    try {
      setStatus('Creating mailbox...');
      await api('/api/mailboxes', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await refreshBootstrap();
      setStatus('Mailbox created.');
    } catch (error) {
      showError(error);
    }
  });
}

function renderAliasesView() {
  refs.contentView.innerHTML = `
    <div class="stack">
      <section class="property-sheet">
        <div class="property-title">Create Alias Rule</div>
        <form id="aliasForm" class="form-grid">
          <label class="label">
            Domain
            <select name="domainId">${state.data.domains.map((domain) => `<option value="${domain.id}">${escapeHtml(domain.hostname)}</option>`).join('')}</select>
          </label>
          <label class="label">Local Part<input name="localPart" placeholder="newsletters"></label>
          <label class="label">
            Mailbox
            <select name="mailboxId">${state.data.mailboxes.map((mailbox) => `<option value="${mailbox.id}">${escapeHtml(mailbox.email_address)}</option>`).join('')}</select>
          </label>
          <label class="label">
            Delivery Mode
            <select name="mode">
              <option value="inbox_only">Inbox only</option>
              <option value="forward_only">Forward only</option>
              <option value="inbox_and_forward">Inbox + forward</option>
            </select>
          </label>
          <label class="label"><input type="checkbox" name="isCatchAll"> Catch-all rule</label>
          <div class="label full">
            Forward destinations
            <div class="chip-list">
              ${state.data.forwardDestinations.map((destination) => `
                <label class="chip">
                  <input type="checkbox" name="forwardDestinationIds" value="${destination.id}">
                  ${escapeHtml(destination.email)}
                </label>
              `).join('') || '<span class="muted">Add destinations first.</span>'}
            </div>
          </div>
          <div class="full"><button class="button primary" type="submit">Save Rule</button></div>
        </form>
      </section>

      <section class="property-sheet">
        <div class="property-title">Current Alias Rules</div>
        <table class="grid-table">
          <thead>
            <tr><th>Alias</th><th>Mode</th><th>Mailbox</th><th>Destinations</th><th></th></tr>
          </thead>
          <tbody>
            ${state.data.aliases.map((alias) => `
              <tr>
                <td>${alias.is_catch_all ? `*@${escapeHtml(alias.hostname)}` : `${escapeHtml(alias.local_part)}@${escapeHtml(alias.hostname)}`}</td>
                <td>${escapeHtml(alias.mode)}</td>
                <td>${escapeHtml(alias.mailbox_email || 'Forward only')}</td>
                <td>${(alias.forward_destination_json || []).map((id) => escapeHtml(state.data.forwardDestinations.find((destination) => destination.id === id)?.email || id)).join('<br>')}</td>
                <td><button class="button delete-alias" data-alias="${alias.id}" type="button">Delete</button></td>
              </tr>
            `).join('') || '<tr><td colspan="5" class="muted">No aliases configured.</td></tr>'}
          </tbody>
        </table>
      </section>
    </div>
  `;

  document.getElementById('aliasForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      domainId: form.get('domainId'),
      localPart: form.get('localPart'),
      mailboxId: form.get('mailboxId'),
      mode: form.get('mode'),
      isCatchAll: form.get('isCatchAll') === 'on',
      forwardDestinationIds: form.getAll('forwardDestinationIds'),
    };
    try {
      setStatus('Saving alias rule...');
      await api('/api/aliases', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await refreshBootstrap();
      setStatus('Alias rule saved.');
    } catch (error) {
      showError(error);
    }
  });

  document.querySelectorAll('.delete-alias').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        setStatus('Deleting alias rule...');
        await api(`/api/aliases/${button.dataset.alias}`, { method: 'DELETE' });
        await refreshBootstrap();
        setStatus('Alias deleted.');
      } catch (error) {
        showError(error);
      }
    });
  });
}

function renderDestinationsView() {
  refs.contentView.innerHTML = `
    <div class="stack">
      <section class="property-sheet">
        <div class="property-title">Add Forward Destination</div>
        <form id="destinationForm" class="form-grid">
          <label class="label">
            Domain Context
            <select name="domainId">
              ${state.data.domains.map((domain) => `<option value="${domain.id}">${escapeHtml(domain.hostname)}</option>`).join('')}
            </select>
          </label>
          <label class="label">Destination Email<input name="email" placeholder="you@outlook.com"></label>
          <label class="label full">Display Name<input name="displayName" placeholder="Primary Inbox"></label>
          <div class="full"><button class="button primary" type="submit">Create Destination</button></div>
        </form>
      </section>

      <section class="property-sheet">
        <div class="property-title">Known Destinations</div>
        <table class="grid-table">
          <thead>
            <tr><th>Email</th><th>Name</th><th>Verification</th></tr>
          </thead>
          <tbody>
            ${state.data.forwardDestinations.map((destination) => `
              <tr>
                <td>${escapeHtml(destination.email)}</td>
                <td>${escapeHtml(destination.display_name || '')}</td>
                <td>${escapeHtml(destination.verification_state)}</td>
              </tr>
            `).join('') || '<tr><td colspan="3" class="muted">No forward destinations configured.</td></tr>'}
          </tbody>
        </table>
      </section>
    </div>
  `;

  document.getElementById('destinationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const domain = getDomainById(form.get('domainId'));
    try {
      setStatus('Saving forward destination...');
      await api('/api/forward-destinations', {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          displayName: form.get('displayName'),
          accountId: domain?.account_id || '',
        }),
      });
      await refreshBootstrap();
      setStatus('Forward destination saved.');
    } catch (error) {
      showError(error);
    }
  });
}

function renderDraftsView() {
  refs.contentView.innerHTML = `
    <div class="stack">
      <section class="property-sheet">
        <div class="property-title">Drafts</div>
        <table class="grid-table">
          <thead>
            <tr><th>From</th><th>Subject</th><th>Updated</th><th></th></tr>
          </thead>
          <tbody>
            ${state.data.drafts.map((draft) => `
              <tr>
                <td>${escapeHtml(draft.from_address)}</td>
                <td>${escapeHtml(draft.subject || '(no subject)')}</td>
                <td>${escapeHtml(formatDateTime(draft.updated_at))}</td>
                <td><button class="button open-draft" data-draft="${draft.id}" type="button">Open</button></td>
              </tr>
            `).join('') || '<tr><td colspan="4" class="muted">No drafts available.</td></tr>'}
          </tbody>
        </table>
      </section>
    </div>
  `;

  document.querySelectorAll('.open-draft').forEach((button) => {
    button.addEventListener('click', () => {
      const draft = state.data.drafts.find((item) => item.id === button.dataset.draft);
      if (draft) {
        openCompose({
          id: draft.id,
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
        });
      }
    });
  });
}

function renderContent() {
  refs.statusUser.textContent = state.user?.email || '';
  refs.statusFolder.textContent = state.view === 'mail' ? state.folder : state.view;
  renderSidebar();

  if (state.view === 'mail') renderMailView();
  else if (state.view === 'connections') renderConnectionsView();
  else if (state.view === 'domains') renderDomainsView();
  else if (state.view === 'aliases') renderAliasesView();
  else if (state.view === 'destinations') renderDestinationsView();
  else if (state.view === 'drafts') renderDraftsView();

  refs.sidebarTree.querySelectorAll('[data-view]').forEach((node) => {
    node.addEventListener('click', () => switchView(node.dataset.view));
  });
  refs.sidebarTree.querySelectorAll('[data-mailbox]').forEach((node) => {
    node.addEventListener('click', () => {
      state.view = 'mail';
      state.folder = 'inbox';
      state.mailboxId = node.dataset.mailbox;
      state.selectedThread = null;
      loadThreads().catch(showError);
    });
  });
  refs.contentView.querySelectorAll('[data-thread]').forEach((row) => {
    row.addEventListener('click', () => selectThread(row.dataset.thread).catch(showError));
  });
  refs.contentView.querySelectorAll('[data-attachment]').forEach((button) => {
    button.addEventListener('click', () => downloadAttachment(button.dataset.attachment).catch(showError));
  });
}

function renderCompose() {
  if (!state.compose) {
    refs.composeOverlay.classList.add('hidden');
    refs.composeOverlay.innerHTML = '';
    return;
  }

  const sendingMailboxes = getSendingMailboxes();
  const composeMailboxIsSendEnabled = sendingMailboxes.some((mailbox) => mailbox.id === state.compose.mailboxId);
  const mailboxOptions = [
    !composeMailboxIsSendEnabled
      ? `<option value="">${escapeHtml(
          state.compose.mailboxId
            ? 'Select a sender from the send-enabled domain'
            : 'No send-enabled mailbox selected',
        )}</option>`
      : '',
    ...sendingMailboxes.map((mailbox) => `
      <option value="${mailbox.id}" ${mailbox.id === state.compose.mailboxId ? 'selected' : ''}>
        ${escapeHtml(mailbox.email_address)}
      </option>
    `),
  ].join('');
  const composeNotice = composeMailboxIsSendEnabled
    ? `Messages from this window will send through ${escapeHtml(getSendingDomain()?.hostname || 'the active sending domain')}.`
    : escapeHtml(
        state.compose.mailboxId
          ? 'This draft still points at a receive-only mailbox. Pick a sender from the one send-enabled domain before sending.'
          : getSendingSummaryMessage(),
      );

  refs.composeOverlay.classList.remove('hidden');
  refs.composeOverlay.innerHTML = `
    <div class="window compose-window">
      <div class="title-bar">
        <div class="title-bar-text">${state.compose.id ? 'Edit Draft' : 'Compose Message'}</div>
        <div class="title-bar-controls"><button id="closeComposeButton" aria-label="Close"></button></div>
      </div>
      <div class="window-body stack">
        <form id="composeForm" class="stack">
          <div class="form-grid">
            <label class="label">
              From
              <select name="mailboxId">${mailboxOptions}</select>
            </label>
            <label class="label">
              To
              <input name="to" value="${escapeHtml(formatAddresses(state.compose.to))}" placeholder="alice@example.com, bob@example.com">
            </label>
            <label class="label">
              Cc
              <input name="cc" value="${escapeHtml(formatAddresses(state.compose.cc))}">
            </label>
            <label class="label">
              Bcc
              <input name="bcc" value="${escapeHtml(formatAddresses(state.compose.bcc))}">
            </label>
            <label class="label full">
              Subject
              <input name="subject" value="${escapeHtml(state.compose.subject || '')}">
            </label>
            <div class="full notice">${composeNotice}</div>
            <label class="label full">
              Message
              <textarea class="compose-body" name="textBody">${escapeHtml(state.compose.textBody || '')}</textarea>
            </label>
            <label class="label full">
              Attachments
              <input id="attachmentInput" type="file" multiple>
            </label>
            <div class="full chip-list">
              ${(state.compose.attachments || []).map((attachment) => `<span class="chip">${escapeHtml(attachment.fileName)}</span>`).join('')}
            </div>
          </div>
          <div class="toolbar">
            <button class="button primary" type="submit">Send</button>
            <button class="button" type="button" id="saveDraftButton">Save Draft</button>
            <button class="button" type="button" id="discardDraftButton">Discard</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('closeComposeButton').addEventListener('click', closeCompose);
  document.getElementById('discardDraftButton').addEventListener('click', closeCompose);
  document.getElementById('saveDraftButton').addEventListener('click', () => saveComposeDraft().catch(showError));
  document.getElementById('attachmentInput').addEventListener('change', (event) => uploadAttachments(event.target.files).catch(showError));
  document.getElementById('composeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await syncComposeFromForm(event.currentTarget);
    try {
      setStatus('Sending message...');
      await api('/api/send', {
        method: 'POST',
        body: JSON.stringify({
          ...state.compose,
          draftId: state.compose.id || null,
        }),
      });
      closeCompose();
      await refreshBootstrap();
      if (state.view === 'mail' && state.folder === 'sent') {
        await loadThreads();
      }
      setStatus('Message sent.');
    } catch (error) {
      showError(error);
    }
  });
}

function render() {
  renderContent();
  renderCompose();
  updateToolbarState();
  refs.statusMessage.textContent = state.status;
}

function updateToolbarState() {
  const selectedThread = state.selectedThread;
  const canCompose = Boolean(getDefaultMailbox());
  const canReply = Boolean(selectedThread)
    && canCompose
    && getDomainSendCapability(selectedThread.domain_id) === 'send_enabled';
  const canForward = Boolean(selectedThread) && canCompose;

  document.getElementById('newMessageButton').disabled = !canCompose;
  document.getElementById('replyButton').disabled = !canReply;
  document.getElementById('forwardButton').disabled = !canForward;
  document.getElementById('archiveButton').disabled = !selectedThread;
  document.getElementById('trashButton').disabled = !selectedThread;
}

function parseInlineAddressList(text) {
  return String(text || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((email) => ({ email, name: '' }));
}

async function syncComposeFromForm(form) {
  const formData = new FormData(form);
  const selectedMailboxId = String(formData.get('mailboxId') || '').trim();
  const mailbox = selectedMailboxId ? getMailboxById(selectedMailboxId) : null;
  state.compose = {
    ...state.compose,
    mailboxId: mailbox?.id || state.compose.mailboxId || null,
    domainId: mailbox?.domain_id || state.compose.domainId || null,
    fromAddress: mailbox?.email_address || state.compose.fromAddress || '',
    to: parseInlineAddressList(formData.get('to')),
    cc: parseInlineAddressList(formData.get('cc')),
    bcc: parseInlineAddressList(formData.get('bcc')),
    subject: formData.get('subject'),
    textBody: formData.get('textBody'),
    htmlBody: '',
  };
}

let draftTimer = null;

async function saveComposeDraft() {
  if (!state.compose) return;
  const form = document.getElementById('composeForm');
  if (form) {
    await syncComposeFromForm(form);
  }
  const payload = await api('/api/drafts', {
    method: 'POST',
    body: JSON.stringify(state.compose),
  });
  state.compose.id = payload.draft.id;
  await refreshBootstrap();
  renderCompose();
  setStatus('Draft saved.');
}

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    saveComposeDraft().catch(showError);
  }, 1200);
}

async function uploadAttachments(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length || !state.compose) return;
  const form = document.getElementById('composeForm');
  if (form) {
    await syncComposeFromForm(form);
  }
  for (const file of files) {
    const formData = new FormData();
    formData.append('file', file);
    const payload = await api('/api/uploads', {
      method: 'POST',
      body: formData,
    });
    state.compose.attachments.push(payload.attachment);
  }
  renderCompose();
  scheduleDraftSave();
}

function closeCompose() {
  state.compose = null;
  renderCompose();
}

function quoteThread(thread) {
  if (!thread?.messages?.length) return '';
  const latest = thread.messages[thread.messages.length - 1];
  return `\n\n--- Original Message ---\nFrom: ${formatAddresses([latest.from_json])}\nTo: ${formatAddresses(latest.to_json)}\nSubject: ${latest.subject || ''}\n\n${latest.text_body || latest.snippet || ''}`;
}

function openCompose(payload = null) {
  const mailbox = payload ? getMailboxById(payload.mailboxId) || getDefaultMailbox() : requireSendingMailbox();
  state.compose = payload || {
    id: null,
    domainId: mailbox?.domain_id || null,
    mailboxId: mailbox?.id || null,
    threadId: null,
    fromAddress: mailbox?.email_address || '',
    to: [],
    cc: [],
    bcc: [],
    subject: '',
    textBody: '',
    htmlBody: '',
    attachments: [],
  };
  renderCompose();
  const form = document.getElementById('composeForm');
  if (form) {
    form.addEventListener('input', scheduleDraftSave, { passive: true });
    form.addEventListener('change', scheduleDraftSave, { passive: true });
  }
}

async function downloadAttachment(attachmentId) {
  const response = await api(`/api/attachments/${attachmentId}`);
  const blob = await response.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'attachment';
  link.click();
  URL.revokeObjectURL(link.href);
}

function selectedThreadOrThrow() {
  if (!state.selectedThread) throw new Error('Select a thread first');
  return state.selectedThread;
}

async function handleThreadAction(action) {
  const thread = selectedThreadOrThrow();
  await api(`/api/threads/${thread.id}/actions`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
  await loadThreads();
}

function buildReplyPayload(mode) {
  const thread = selectedThreadOrThrow();
  if (mode !== 'forward' && getDomainSendCapability(thread.domain_id) !== 'send_enabled') {
    throw new Error('Reply is blocked for receive-only domains. Forward the message or send a new mail from the one send-enabled domain.');
  }
  const latest = thread.messages[thread.messages.length - 1];
  const mailbox = requireSendingMailbox();
  const to = mode === 'forward'
    ? []
    : [{ email: latest.from_json?.email || '', name: latest.from_json?.name || '' }];
  return {
    id: null,
    domainId: mailbox?.domain_id || null,
    mailboxId: mailbox?.id || null,
    threadId: thread.id,
    fromAddress: mailbox?.email_address || '',
    to,
    cc: [],
    bcc: [],
    subject: `${mode === 'forward' ? 'Fwd' : 'Re'}: ${thread.subject || ''}`,
    textBody: mode === 'forward' ? `Forwarding message.${quoteThread(thread)}` : quoteThread(thread),
    htmlBody: '',
    attachments: [],
  };
}

function showError(error) {
  console.error(error);
  setStatus(error.message || 'An unexpected error occurred.');
  refs.statusMessage.textContent = error.message || 'An unexpected error occurred.';
}

async function refreshCurrentView() {
  await refreshBootstrap();
  await loadZones();
  render();
}

function bindGlobalActions() {
  document.getElementById('newMessageButton').addEventListener('click', () => {
    try {
      openCompose();
    } catch (error) {
      showError(error);
    }
  });
  document.getElementById('replyButton').addEventListener('click', () => {
    try {
      openCompose(buildReplyPayload('reply'));
    } catch (error) {
      showError(error);
    }
  });
  document.getElementById('forwardButton').addEventListener('click', () => {
    try {
      openCompose(buildReplyPayload('forward'));
    } catch (error) {
      showError(error);
    }
  });
  document.getElementById('archiveButton').addEventListener('click', () => handleThreadAction('archive').catch(showError));
  document.getElementById('trashButton').addEventListener('click', () => handleThreadAction('trash').catch(showError));
  document.getElementById('refreshButton').addEventListener('click', () => refreshCurrentView().catch(showError));
  refs.searchBox.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && state.view === 'mail') {
      loadThreads().catch(showError);
    }
  });
}

async function boot() {
  bindGlobalActions();
  state.runtime = await fetch('/api/runtime-config').then((response) => response.json());
  refs.loginMessage.textContent = 'Ready for Google sign-in.';
  await initFirebase();
  await loadZones();
  render();
}

boot().catch(showError);
