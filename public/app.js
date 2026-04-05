const EASTER_EGG_STORAGE_KEY = 'alias-forge-2000-eggs';
const KONAMI_SEQUENCE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const MENU_SECRET_SEQUENCE = ['Help', 'Window', 'Tools', 'View', 'Edit', 'File'];
const WINDOW_CONTROL_SEQUENCE = ['minimize', 'maximize', 'close'];
const EASTER_EGG_TOTAL = 10;
const AI_PROVIDER_LABELS = {
  gemini: 'Gemini',
  groq: 'Llama',
};
const GEMINI_MODEL_OPTIONS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
];
const AI_TONE_OPTIONS = [
  { id: 'professional', label: 'Professional' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'formal', label: 'Formal' },
  { id: 'concise', label: 'Concise' },
  { id: 'persuasive', label: 'Persuasive' },
  { id: 'empathetic', label: 'Empathetic' },
  { id: 'confident', label: 'Confident' },
  { id: 'upbeat', label: 'Upbeat' },
];

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
  selectedSendingDomainId: null,
  sendingDomainId: null,
  sendingStatusMessage: null,
  threads: [],
  selectedThread: null,
  view: 'mail',
  folder: 'inbox',
  mailboxId: null,
  status: 'Booting mail console...',
  compose: null,
  easterEggs: {
    unlocked: loadUnlockedEggs(),
    titleClicks: [],
    titleClickTimers: [],
    titleDoubleClickUntil: 0,
    folderClicks: [],
    menuTrail: [],
    controlTrail: [],
    konamiTrail: [],
    minesweeper: null,
    matrixMode: false,
    plusMode: false,
  },
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
  eggOverlay: document.getElementById('eggOverlay'),
  effectLayer: document.getElementById('effectLayer'),
  windowTitle: document.getElementById('windowTitle'),
  shellWindow: document.querySelector('.shell-window'),
  menuItems: Array.from(document.querySelectorAll('[data-menu]')),
  windowControls: Array.from(document.querySelectorAll('[data-window-control]')),
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

function loadUnlockedEggs() {
  try {
    const raw = localStorage.getItem(EASTER_EGG_STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveUnlockedEggs() {
  try {
    localStorage.setItem(
      EASTER_EGG_STORAGE_KEY,
      JSON.stringify(Array.from(state.easterEggs.unlocked).sort()),
    );
  } catch {
    // Ignore storage failures.
  }
}

function unlockEgg(id, title, detail) {
  const alreadyUnlocked = state.easterEggs.unlocked.has(id);
  if (!alreadyUnlocked) {
    state.easterEggs.unlocked.add(id);
    saveUnlockedEggs();
  }
  showEggToast(
    alreadyUnlocked ? title : `Easter Egg ${state.easterEggs.unlocked.size}/${EASTER_EGG_TOTAL}: ${title}`,
    detail,
  );
}

function clearEffectLayer() {
  refs.effectLayer.innerHTML = '';
}

function showEggToast(title, detail) {
  const toast = document.createElement('div');
  toast.className = 'egg-toast';
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
  refs.effectLayer.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3400);
}

function closeEggDialog() {
  refs.eggOverlay.classList.add('hidden');
  refs.eggOverlay.innerHTML = '';
}

function showEggDialog(title, bodyHtml, actionsHtml = '<button class="button primary egg-close" type="button">OK</button>') {
  refs.eggOverlay.classList.remove('hidden');
  refs.eggOverlay.innerHTML = `
    <div class="window dialog egg-special-window">
      <div class="title-bar">
        <div class="title-bar-text">${escapeHtml(title)}</div>
        <div class="title-bar-controls"><button class="egg-close" aria-label="Close"></button></div>
      </div>
      <div class="window-body egg-window-body">
        <div class="egg-window-copy">${bodyHtml}</div>
        <div class="egg-actions">${actionsHtml}</div>
      </div>
    </div>
  `;
  refs.eggOverlay.querySelectorAll('.egg-close').forEach((button) => {
    button.addEventListener('click', closeEggDialog);
  });
}

function setThemeFlags() {
  document.body.classList.toggle('egg-theme-matrix', state.easterEggs.matrixMode);
  document.body.classList.toggle('egg-theme-plus', state.easterEggs.plusMode);
}

function activateMatrixMode() {
  state.easterEggs.matrixMode = !state.easterEggs.matrixMode;
  setThemeFlags();
  unlockEgg('matrix-mode', 'Matrix mode', state.easterEggs.matrixMode ? 'Phosphor theme enabled.' : 'Phosphor theme disabled.');
  setStatus(state.easterEggs.matrixMode ? 'Matrix mode engaged.' : 'Matrix mode disengaged.');
}

function activatePlusMode() {
  state.easterEggs.plusMode = !state.easterEggs.plusMode;
  setThemeFlags();
  unlockEgg('konami-plus', 'Plus! Pack mode', state.easterEggs.plusMode ? 'Desktop palette switched to Plus! colors.' : 'Plus! colors returned to normal.');
}

function triggerEnvelopeRain() {
  unlockEgg('mail-rain', 'Mail rain', 'The desktop is shedding envelopes.');
  clearEffectLayer();
  for (let index = 0; index < 18; index += 1) {
    const envelope = document.createElement('div');
    envelope.className = 'egg-envelope';
    envelope.style.left = `${Math.random() * 96}%`;
    envelope.style.setProperty('--rotation', `${-16 + Math.random() * 32}deg`);
    envelope.style.setProperty('--duration', `${3.2 + Math.random() * 2.1}s`);
    envelope.style.animationDelay = `${Math.random() * 0.6}s`;
    refs.effectLayer.appendChild(envelope);
    window.setTimeout(() => envelope.remove(), 6200);
  }
}

function triggerPipeDream() {
  unlockEgg('pipe-dream', 'Pipe dream', 'A miniature screen saver has drifted across the desk.');
  clearEffectLayer();
  const overlay = document.createElement('div');
  overlay.className = 'pipes-overlay';
  refs.effectLayer.appendChild(overlay);
  const colors = ['#9fc6ff', '#72d4d4', '#ffd07a', '#ff9eb7'];
  for (let index = 0; index < 10; index += 1) {
    const pipe = document.createElement('div');
    pipe.className = 'pipe-segment';
    pipe.style.left = `${Math.random() * 80}%`;
    pipe.style.top = `${Math.random() * 80}%`;
    pipe.style.setProperty('--width', `${90 + Math.random() * 180}px`);
    pipe.style.setProperty('--height', `${14 + Math.random() * 20}px`);
    pipe.style.setProperty('--pipe-color', colors[index % colors.length]);
    pipe.style.setProperty('--duration', `${4.6 + Math.random() * 3.2}s`);
    pipe.style.setProperty('--rotate', `${[0, 90][index % 2]}deg`);
    pipe.style.setProperty('--from-x', '0px');
    pipe.style.setProperty('--from-y', '0px');
    pipe.style.setProperty('--to-x', `${-180 + Math.random() * 360}px`);
    pipe.style.setProperty('--to-y', `${-180 + Math.random() * 360}px`);
    overlay.appendChild(pipe);
  }
  window.setTimeout(() => overlay.remove(), 8200);
}

function triggerBlueScreen() {
  unlockEgg('blue-screen', 'Blue screen', 'Kernel panic theatrics activated.');
  refs.eggOverlay.classList.remove('hidden');
  refs.eggOverlay.innerHTML = `
    <div class="bsod-screen" tabindex="0">
      <strong>Windows</strong>
      <div>A fatal exception 0E has occurred at 0028:C0011E36 in VXD MAILROUTER(01) + 00000D86.</div>
      <div>The current application will be terminated.</div>
      <br>
      <div>* Press any key to return to the mail console.</div>
      <div>* If this is the first time you have seen this stop error screen, congratulations, you found an easter egg.</div>
    </div>
  `;
  const close = () => {
    document.removeEventListener('keydown', onKeydown);
    closeEggDialog();
  };
  const onKeydown = () => close();
  document.addEventListener('keydown', onKeydown, { once: true });
  refs.eggOverlay.querySelector('.bsod-screen').addEventListener('click', close);
  refs.eggOverlay.querySelector('.bsod-screen').focus();
}

function showWinverDialog() {
  unlockEgg('winver-dialog', 'Winver', 'Version information unlocked.');
  showEggDialog(
    'About EmailRouter by e075',
    `
      <p>EmailRouter by e075<br>Version 2.0.0.2000</p>
      <p>Alias Forge 2000 shell with forwarding, inboxing, and hidden operator toys.</p>
      <p>Secrets discovered: ${state.easterEggs.unlocked.size} / ${EASTER_EGG_TOTAL}</p>
    `,
  );
}

function showClippyDialog() {
  unlockEgg('clippy-visit', 'Office assistant', 'A support mascot left a note.');
  const notes = [
    'It looks like you are routing mail. Would you like help hiding ten easter eggs?',
    'Tip: double-clicking old software usually reveals a secret.',
    'Remember: forward everything except your dignity.',
  ];
  const note = notes[Math.floor(Math.random() * notes.length)];
  showEggDialog(
    'Message from Office Assistant',
    `<p>${escapeHtml(note)}</p><p>The assistant recommends clicking suspicious UI chrome from time to time.</p>`,
  );
}

function showTaskManagerDialog() {
  unlockEgg('task-manager', 'Task manager', 'Control sequence accepted.');
  showEggDialog(
    'Close Program',
    `
      <p>One hidden console process is currently running in the background.</p>
      <table class="task-list">
        <thead><tr><th>Task</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>MAILROUTER.EXE</td><td>Running</td></tr>
          <tr><td>SECRETSAUCE.DLL</td><td>Idle</td></tr>
          <tr><td>CLIPPY32.EXE</td><td>Waiting for applause</td></tr>
        </tbody>
      </table>
    `,
    '<button class="button egg-close" type="button">Return</button><button class="button primary egg-end-task" type="button">End Clippy32.exe</button>',
  );
  const endTask = refs.eggOverlay.querySelector('.egg-end-task');
  if (endTask) {
    endTask.addEventListener('click', () => {
      showEggToast('Task ended', 'Clippy32.exe respawned immediately.');
      closeEggDialog();
    });
  }
}

function showTimeWarpDialog() {
  unlockEgg('time-warp', 'Time warp', 'The shell briefly forgot which decade it is.');
  refs.shellWindow.classList.add('egg-shake');
  window.setTimeout(() => refs.shellWindow.classList.remove('egg-shake'), 1000);
  showEggDialog(
    'Clock Skew Detected',
    `<p>The system briefly reported ${(new Date()).getFullYear() - 26} before snapping back to the present.</p><p>Nothing else was affected, aside from your sense of continuity.</p>`,
  );
}

function createMinesweeperBoard() {
  const mines = new Set([1, 6, 12]);
  return Array.from({ length: 16 }, (_, index) => ({
    index,
    mine: mines.has(index),
    revealed: false,
  }));
}

function getNeighborIndexes(index) {
  const row = Math.floor(index / 4);
  const column = index % 4;
  const neighbors = [];
  for (let y = -1; y <= 1; y += 1) {
    for (let x = -1; x <= 1; x += 1) {
      if (!x && !y) continue;
      const nextRow = row + y;
      const nextColumn = column + x;
      if (nextRow < 0 || nextRow > 3 || nextColumn < 0 || nextColumn > 3) continue;
      neighbors.push(nextRow * 4 + nextColumn);
    }
  }
  return neighbors;
}

function countNeighborMines(index) {
  return getNeighborIndexes(index)
    .filter((neighbor) => state.easterEggs.minesweeper[neighbor].mine)
    .length;
}

function renderMinesweeperDialog(message = 'Clear every safe square without detonating the desk.') {
  const board = state.easterEggs.minesweeper || createMinesweeperBoard();
  state.easterEggs.minesweeper = board;
  const boardHtml = board.map((cell) => {
    let label = '';
    if (cell.revealed && cell.mine) label = '*';
    else if (cell.revealed) label = countNeighborMines(cell.index) || '';
    return `
      <button
        class="button mine-cell ${cell.revealed ? 'revealed' : ''}"
        type="button"
        data-mine-index="${cell.index}"
        ${cell.revealed ? 'disabled' : ''}
      >${label}</button>
    `;
  }).join('');

  showEggDialog(
    'Minesweeper',
    `<p>${escapeHtml(message)}</p><div class="mines-grid">${boardHtml}</div>`,
    '<button class="button egg-restart-mines" type="button">Restart</button><button class="button primary egg-close" type="button">Close</button>',
  );

  refs.eggOverlay.querySelectorAll('[data-mine-index]').forEach((button) => {
    button.addEventListener('click', () => revealMineCell(Number(button.dataset.mineIndex)));
  });
  const restart = refs.eggOverlay.querySelector('.egg-restart-mines');
  if (restart) {
    restart.addEventListener('click', () => {
      state.easterEggs.minesweeper = createMinesweeperBoard();
      renderMinesweeperDialog('Fresh field deployed.');
    });
  }
}

function revealMineCell(index) {
  const cell = state.easterEggs.minesweeper[index];
  if (!cell || cell.revealed) return;
  cell.revealed = true;
  if (cell.mine) {
    state.easterEggs.minesweeper = createMinesweeperBoard();
    renderMinesweeperDialog('Mine hit. Fortunately this is the fake version.');
    return;
  }
  const safeCells = state.easterEggs.minesweeper.filter((item) => !item.mine && item.revealed).length;
  if (safeCells === 13) {
    showEggToast('Minesweeper cleared', 'Every safe square is open.');
    renderMinesweeperDialog('Board cleared. The desktop salutes you.');
    return;
  }
  renderMinesweeperDialog('Clear every safe square without detonating the desk.');
}

function handleSearchCommand(rawValue) {
  const command = String(rawValue || '').trim().toLowerCase();
  if (!command) return false;
  if (command === 'winver') {
    showWinverDialog();
    return true;
  }
  if (command === 'matrix') {
    activateMatrixMode();
    return true;
  }
  if (command === 'pipes') {
    triggerPipeDream();
    return true;
  }
  if (command === 'bluescreen' || command === 'bsod') {
    triggerBlueScreen();
    return true;
  }
  return false;
}

function trackTimedSequence(storeKey, expectedSequence, nextValue, onMatch) {
  const now = Date.now();
  const trail = state.easterEggs[storeKey].filter((entry) => now - entry.timestamp < 5500);
  trail.push({ value: nextValue, timestamp: now });
  state.easterEggs[storeKey] = trail.slice(-expectedSequence.length);
  const values = state.easterEggs[storeKey].map((entry) => entry.value);
  if (values.length === expectedSequence.length && values.every((value, index) => value === expectedSequence[index])) {
    state.easterEggs[storeKey] = [];
    onMatch();
  }
}

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

function getConnectionByProvider(provider) {
  return state.data.connections.find((connection) => connection.provider === provider) || null;
}

function getGeminiConnection() {
  return getConnectionByProvider('gemini');
}

function getGroqConnection() {
  return getConnectionByProvider('groq');
}

function getAvailableAiProviders() {
  const providers = [];
  if (getGeminiConnection()) providers.push('gemini');
  if (getGroqConnection()) providers.push('groq');
  return providers;
}

function getDefaultGeminiModel() {
  const configuredModel = getGeminiConnection()?.metadata?.defaultModel;
  return GEMINI_MODEL_OPTIONS.some((option) => option.id === configuredModel)
    ? configuredModel
    : GEMINI_MODEL_OPTIONS[0].id;
}

function getDefaultAiProvider() {
  return getAvailableAiProviders()[0] || 'gemini';
}

function getAiProviderLabel(provider) {
  return AI_PROVIDER_LABELS[provider] || provider;
}

function getDomainSendCapability(domainId) {
  const domain = getDomainById(domainId);
  return domain?.sendCapability || domain?.send_capability || 'send_unavailable';
}

function getSelectedSendingDomain() {
  return state.data.domains.find((domain) => domain.id === state.selectedSendingDomainId) || null;
}

function getSendingDomain() {
  return state.data.domains.find((domain) => domain.id === state.sendingDomainId && domain.canSend) || null;
}

function getSelectedSendingMailboxes() {
  const selectedDomain = getSelectedSendingDomain();
  if (!selectedDomain) return [];
  return state.data.mailboxes.filter((mailbox) => mailbox.domain_id === selectedDomain.id);
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

function getSelectedSendingMailbox() {
  const selectedMailboxes = getSelectedSendingMailboxes();
  return selectedMailboxes.find((mailbox) => mailbox.is_default_sender) || selectedMailboxes[0] || null;
}

function requireSendingMailbox() {
  if (!getSendingDomain()) {
    throw new Error(
      state.sendingStatusMessage
        || 'Choose a sending domain and connect Resend before composing mail.',
    );
  }
  const mailbox = getDefaultMailbox();
  if (!mailbox) {
    throw new Error(
      state.sendingStatusMessage
        || 'Choose a sending domain and connect Resend before composing mail.',
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
  const selectedSendingDomain = getSelectedSendingDomain();
  const sendingDomain = getSendingDomain();
  if (sendingDomain) {
    return `Sending is enabled only on ${sendingDomain.hostname}. All other domains remain receive-only.`;
  }
  if (selectedSendingDomain) {
    return state.sendingStatusMessage
      || `Selected sending domain: ${selectedSendingDomain.hostname}. Sending is currently unavailable.`;
  }
  return state.sendingStatusMessage
    || 'Receiving works for every Cloudflare domain. Choose one provisioned domain to use for sending.';
}

function getComposeEditor() {
  return document.getElementById('composeEditor');
}

function getComposeAiPromptInput() {
  return document.getElementById('composeAiPrompt');
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
  state.selectedSendingDomainId = payload.selectedSendingDomainId || null;
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
  const gemini = getGeminiConnection();
  const groq = getGroqConnection();
  const sendingDomain = getSendingDomain();
  refs.contentView.innerHTML = `
    <div class="stack">
      <section class="property-sheet">
        <div class="property-title">Provider Connections</div>
        <div class="connections-grid">
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
          <form id="geminiForm" class="stack">
            <label class="label">Label<input name="label" value="${escapeHtml(gemini?.label || 'Gemini')}"></label>
            <label class="label">API Key<input name="apiKey" type="password" placeholder="AIza..."></label>
            <label class="label">
              Default Free Model
              <select name="defaultModel">
                ${GEMINI_MODEL_OPTIONS.map((option) => `
                  <option value="${option.id}" ${option.id === (gemini?.metadata?.defaultModel || getDefaultGeminiModel()) ? 'selected' : ''}>
                    ${escapeHtml(option.label)}
                  </option>
                `).join('')}
              </select>
            </label>
            <div class="muted">Stored encrypted on the Worker. Current: ${escapeHtml(gemini?.secretMask || 'Not connected')}</div>
            <div class="muted">Gemini is limited to free-tier email composition and rewrite models in this console.</div>
            <button class="button primary" type="submit">Save Gemini Connection</button>
          </form>
          <form id="groqForm" class="stack">
            <label class="label">Label<input name="label" value="${escapeHtml(groq?.label || 'Llama')}"></label>
            <label class="label">API Key<input name="apiKey" type="password" placeholder="gsk_..."></label>
            <div class="muted">Stored encrypted on the Worker. Current: ${escapeHtml(groq?.secretMask || 'Not connected')}</div>
            <div class="muted">Llama is fixed to <code>llama-3.3-70b-versatile</code> for email composition and rewrite.</div>
            <button class="button primary" type="submit">Save Llama Connection</button>
          </form>
        </div>
        <div class="notice">
          Cloudflare powers receiving, alias rules, and forwarding for every configured domain. Resend powers outbound delivery for whichever provisioned domain you explicitly mark as the sending domain. Gemini and Llama are constrained to email composition, rewrite, and HTML email drafting tools inside compose.
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

  document.getElementById('geminiForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      setStatus('Verifying Gemini API key...');
      await api('/api/providers/gemini', {
        method: 'POST',
        body: JSON.stringify({
          label: form.get('label'),
          apiKey: form.get('apiKey'),
          defaultModel: form.get('defaultModel'),
        }),
      });
      await refreshBootstrap();
      setStatus('Gemini connected.');
    } catch (error) {
      showError(error);
    }
  });

  document.getElementById('groqForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      setStatus('Verifying Llama connection...');
      await api('/api/providers/groq', {
        method: 'POST',
        body: JSON.stringify({
          label: form.get('label'),
          apiKey: form.get('apiKey'),
        }),
      });
      await refreshBootstrap();
      setStatus('Llama connected.');
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
          Cloudflare is enough to provision receiving. After provisioning, choose exactly one domain to use for sending. Resend is required only for outbound delivery.
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
              const actionLabel = domain.isSelectedSendingDomain ? 'Sending Domain' : 'Use for Sending';
              return `
                <tr>
                  <td>${escapeHtml(domain.hostname)}</td>
                  <td>${escapeHtml(domain.routing_status)}</td>
                  <td>${escapeHtml(formatSendCapability(domain.sendCapability || domain.send_capability))}</td>
                  <td>${escapeHtml(domain.resend_status)}</td>
                  <td>${mailboxes.map((mailbox) => escapeHtml(mailbox.email_address)).join('<br>')}</td>
                  <td>
                    ${domain.isSelectedSendingDomain
                      ? `<span class="chip">${escapeHtml(actionLabel)}</span>`
                      : `<button class="button select-sending-domain" data-domain="${domain.id}" type="button">${escapeHtml(actionLabel)}</button>`}
                    <button class="button refresh-domain" data-domain="${domain.id}" type="button">Refresh</button>
                  </td>
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
        <div class="notice">Default sender preference only matters on the selected sending domain. Receive-only domains still work for inboxes, aliases, and forwarding.</div>
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

  document.querySelectorAll('.select-sending-domain').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        setStatus('Selecting sending domain...');
        await api(`/api/domains/${button.dataset.domain}/select-sending`, { method: 'POST', body: JSON.stringify({}) });
        await refreshBootstrap();
        setStatus('Sending domain updated.');
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

function normalizeComposeEditorMode(value) {
  return value === 'html' ? 'html' : 'rich';
}

function stripHtmlToText(html) {
  const container = document.createElement('div');
  container.innerHTML = String(html || '');
  return container.innerText.replace(/\u00a0/g, ' ').trim();
}

function textToComposeHtml(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) return '<p><br></p>';
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split('\n').map((line) => escapeHtml(line)).join('<br>'));
  return `<p>${paragraphs.join('</p><p>')}</p>`;
}

function getComposeDocumentHtml() {
  if (!state.compose) return '<p><br></p>';
  if (String(state.compose.htmlBody || '').trim()) return state.compose.htmlBody;
  return textToComposeHtml(state.compose.textBody || '');
}

function inferComposeEditorMode(payload = null) {
  const candidateHtml = String(payload?.htmlBody || '').trim();
  return /<(?:!doctype|html|head|body|table|style)\b/i.test(candidateHtml) ? 'html' : 'rich';
}

function getComposeSelection() {
  if (!state.compose) return null;
  if (state.compose.editorMode === 'html') {
    const source = document.getElementById('composeHtmlSource');
    if (!source) return null;
    const start = source.selectionStart ?? 0;
    const end = source.selectionEnd ?? 0;
    if (end > start) {
      return {
        kind: 'html',
        start,
        end,
        text: source.value.slice(start, end),
      };
    }
    return null;
  }

  const editor = getComposeEditor();
  const selection = window.getSelection();
  if (!editor || !selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer) || range.collapsed) return null;
  return {
    kind: 'rich',
    range: range.cloneRange(),
    text: selection.toString(),
  };
}

function replaceRichSelection(range, html) {
  const editor = getComposeEditor();
  if (!editor) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const fragment = range.createContextualFragment(html);
  const lastNode = fragment.lastChild;
  range.deleteContents();
  range.insertNode(fragment);
  const nextRange = document.createRange();
  if (lastNode) {
    nextRange.setStartAfter(lastNode);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }
  editor.focus();
}

function insertComposeHtml(html) {
  if (state.compose?.editorMode === 'html') {
    const source = document.getElementById('composeHtmlSource');
    if (!source) return;
    const start = source.selectionStart ?? source.value.length;
    const end = source.selectionEnd ?? start;
    source.value = `${source.value.slice(0, start)}${html}${source.value.slice(end)}`;
    source.focus();
    source.selectionStart = start + html.length;
    source.selectionEnd = start + html.length;
    return;
  }

  const selection = getComposeSelection();
  const editor = getComposeEditor();
  if (!editor) return;
  editor.focus();
  if (selection?.kind === 'rich') {
    replaceRichSelection(selection.range, html);
    return;
  }
  document.execCommand('insertHTML', false, html);
}

function replaceComposeSelection(selection, replacementText) {
  if (!selection || !replacementText) return;
  if (selection.kind === 'html') {
    const source = document.getElementById('composeHtmlSource');
    if (!source) return;
    source.value = `${source.value.slice(0, selection.start)}${replacementText}${source.value.slice(selection.end)}`;
    source.focus();
    source.selectionStart = selection.start;
    source.selectionEnd = selection.start + replacementText.length;
    return;
  }
  replaceRichSelection(selection.range, textToComposeHtml(replacementText));
}

function updateComposeFieldsFromAi(result) {
  const subjectInput = document.querySelector('#composeForm [name="subject"]');
  if (subjectInput && typeof result.subject === 'string') {
    subjectInput.value = result.subject;
  }

  if (state.compose?.editorMode === 'html') {
    const source = document.getElementById('composeHtmlSource');
    if (source) {
      source.value = result.htmlBody || textToComposeHtml(result.textBody || '');
      source.focus();
    }
    return;
  }

  const editor = getComposeEditor();
  if (editor) {
    editor.innerHTML = result.htmlBody || textToComposeHtml(result.textBody || '');
    editor.focus();
  }
}

function setComposeAiBusy(isBusy) {
  document.querySelectorAll('.compose-ai-button').forEach((button) => {
    button.disabled = isBusy || button.dataset.aiDisabled === 'true';
  });
}

async function runComposeAiAction(action) {
  if (!state.compose) return;
  const form = document.getElementById('composeForm');
  const selection = getComposeSelection();
  if (form) {
    await syncComposeFromForm(form);
  }

  const provider = state.compose.aiProvider || getDefaultAiProvider();
  if (!getAvailableAiProviders().includes(provider)) {
    throw new Error('Connect Gemini or Llama in Connections before using AI tools.');
  }

  setComposeAiBusy(true);
  try {
    setStatus(`Running ${getAiProviderLabel(provider)}...`);
    const payload = await api('/api/ai/assist', {
      method: 'POST',
      body: JSON.stringify({
        provider,
        model: provider === 'gemini' ? state.compose.aiModel : null,
        tone: state.compose.aiTone,
        action,
        prompt: state.compose.aiPrompt || '',
        outputMode: state.compose.editorMode === 'html' ? 'html_email' : 'plain_text',
        subject: state.compose.subject,
        textBody: state.compose.editorMode === 'html'
          ? (document.getElementById('composeHtmlSource')?.value || state.compose.htmlBody || '')
          : state.compose.textBody,
        htmlBody: state.compose.htmlBody || '',
        selectionText: selection?.text || '',
        to: state.compose.to || [],
        cc: state.compose.cc || [],
        bcc: state.compose.bcc || [],
      }),
    });

    if (selection?.text && payload.result?.replacementText) {
      replaceComposeSelection(selection, payload.result.replacementText);
    } else {
      updateComposeFieldsFromAi(payload.result || {});
    }

    if (form) {
      await syncComposeFromForm(form);
    }
    scheduleDraftSave();
    setStatus(`${getAiProviderLabel(provider)} updated the draft.`);
  } finally {
    setComposeAiBusy(false);
  }
}

function applyComposeFormat(action) {
  if (!state.compose) return;
  if (state.compose.editorMode === 'html') {
    throw new Error('Switch to Design mode to use formatting tools. HTML mode edits the raw email markup directly.');
  }
  const editor = getComposeEditor();
  if (!editor) return;
  editor.focus();

  if (action === 'link') {
    const url = window.prompt('Enter the link URL');
    if (url) document.execCommand('createLink', false, url);
    return;
  }

  if (action === 'emoji') {
    insertComposeHtml('&#128578;');
    return;
  }

  if (action === 'signature') {
    const mailbox = getMailboxById(state.compose.mailboxId);
    const signature = mailbox?.signature_html || textToComposeHtml(mailbox?.signature_text || '');
    if (signature) insertComposeHtml(signature);
    return;
  }

  const commands = {
    bold: ['bold'],
    italic: ['italic'],
    underline: ['underline'],
    strike: ['strikeThrough'],
    bullets: ['insertUnorderedList'],
    numbering: ['insertOrderedList'],
    quote: ['formatBlock', '<blockquote>'],
    clear: ['removeFormat'],
    undo: ['undo'],
    redo: ['redo'],
  };
  const command = commands[action];
  if (!command) return;
  document.execCommand(command[0], false, command[1] || null);
}

function renderCompose() {
  if (!state.compose) {
    refs.composeOverlay.classList.add('hidden');
    refs.composeOverlay.innerHTML = '';
    return;
  }

  state.compose.editorMode = normalizeComposeEditorMode(state.compose.editorMode);
  state.compose.aiProvider = getAvailableAiProviders().includes(state.compose.aiProvider)
    ? state.compose.aiProvider
    : getDefaultAiProvider();
  state.compose.aiModel = GEMINI_MODEL_OPTIONS.some((option) => option.id === state.compose.aiModel)
    ? state.compose.aiModel
    : getDefaultGeminiModel();
  state.compose.aiTone = AI_TONE_OPTIONS.some((option) => option.id === state.compose.aiTone)
    ? state.compose.aiTone
    : 'professional';
  state.compose.aiPrompt = state.compose.aiPrompt || '';

  const selectedSendingMailboxes = getSelectedSendingMailboxes();
  const composeMailboxIsSelected = selectedSendingMailboxes.some((mailbox) => mailbox.id === state.compose.mailboxId);
  const composeMailboxCanSend = Boolean(getSendingDomain()) && composeMailboxIsSelected;
  const mailboxOptions = [
    !composeMailboxIsSelected
      ? `<option value="">${escapeHtml(
          state.compose.mailboxId
            ? 'Select a sender from the selected sending domain'
            : 'No sending mailbox selected',
        )}</option>`
      : '',
    ...selectedSendingMailboxes.map((mailbox) => `
      <option value="${mailbox.id}" ${mailbox.id === state.compose.mailboxId ? 'selected' : ''}>
        ${escapeHtml(mailbox.email_address)}
      </option>
    `),
  ].join('');
  const composeNotice = composeMailboxCanSend
    ? `Messages from this window will send through ${escapeHtml(getSendingDomain()?.hostname || 'the active sending domain')}.`
    : escapeHtml(
        composeMailboxIsSelected
          ? getSendingSummaryMessage()
          : state.compose.mailboxId
            ? 'This draft still points at a receive-only mailbox. Pick a sender from the selected sending domain before sending.'
            : getSendingSummaryMessage(),
      );
  const availableAiProviders = getAvailableAiProviders();
  const aiEnabled = availableAiProviders.length > 0;
  const aiProviderOptions = availableAiProviders.length
    ? availableAiProviders.map((provider) => `
        <option value="${provider}" ${provider === state.compose.aiProvider ? 'selected' : ''}>
          ${escapeHtml(getAiProviderLabel(provider))}
        </option>
      `).join('')
    : '<option value="">Connect Gemini or Llama first</option>';
  const aiProviderBadge = state.compose.aiProvider === 'groq'
    ? `<div class="compose-static-pill">Model: llama-3.3-70b-versatile</div>`
    : `
      <label class="label compact">
        Gemini Model
        <select name="aiModel">
          ${GEMINI_MODEL_OPTIONS.map((option) => `
            <option value="${option.id}" ${option.id === state.compose.aiModel ? 'selected' : ''}>
              ${escapeHtml(option.label)}
            </option>
          `).join('')}
        </select>
      </label>
    `;
  const aiDisabledAttr = aiEnabled ? 'false' : 'true';
  const composeBodyMarkup = state.compose.editorMode === 'html'
    ? `
      <label class="label full">
        HTML Source
        <textarea id="composeHtmlSource" class="compose-html-source" spellcheck="false">${escapeHtml(getComposeDocumentHtml())}</textarea>
      </label>
    `
    : `
      <label class="label full">
        Message
        <div id="composeEditor" class="compose-editor" contenteditable="true">${getComposeDocumentHtml()}</div>
      </label>
    `;

  refs.composeOverlay.classList.remove('hidden');
  refs.composeOverlay.innerHTML = `
    <div class="window compose-window">
      <div class="title-bar">
        <div class="title-bar-text">${state.compose.id ? 'Edit Draft' : 'Compose Message'}</div>
        <div class="title-bar-controls"><button id="closeComposeButton" aria-label="Close"></button></div>
      </div>
      <div class="window-body stack">
        <form id="composeForm" class="stack">
          <input type="hidden" name="editorMode" value="${state.compose.editorMode}">
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
            <div class="full compose-tool-panel">
              <div class="compose-mode-switch">
                <button class="button compose-mode-button ${state.compose.editorMode === 'rich' ? 'active' : ''}" data-compose-mode="rich" type="button">Design</button>
                <button class="button compose-mode-button ${state.compose.editorMode === 'html' ? 'active' : ''}" data-compose-mode="html" type="button">HTML</button>
              </div>
              <div class="compose-ai-row">
                <label class="label compact">
                  AI Engine
                  <select name="aiProvider" ${aiEnabled ? '' : 'disabled'}>
                    ${aiProviderOptions}
                  </select>
                </label>
                ${aiProviderBadge}
                <label class="label compact">
                  Tone
                  <select name="aiTone" ${aiEnabled ? '' : 'disabled'}>
                    ${AI_TONE_OPTIONS.map((option) => `
                      <option value="${option.id}" ${option.id === state.compose.aiTone ? 'selected' : ''}>
                        ${escapeHtml(option.label)}
                      </option>
                    `).join('')}
                  </select>
                </label>
                <label class="label compose-ai-prompt">
                  AI Prompt
                  <input id="composeAiPrompt" name="aiPrompt" value="${escapeHtml(state.compose.aiPrompt || '')}" placeholder="Draft a follow-up, rewrite this warmer, or build a full HTML promo email...">
                </label>
                <button class="button compose-ai-button" data-ai-action="compose" data-ai-disabled="${aiDisabledAttr}" type="button" ${aiEnabled ? '' : 'disabled'}>AI Compose</button>
                <button class="button compose-ai-button" data-ai-action="rewrite" data-ai-disabled="${aiDisabledAttr}" type="button" ${aiEnabled ? '' : 'disabled'}>Rewrite</button>
                <button class="button compose-ai-button" data-ai-action="shorten" data-ai-disabled="${aiDisabledAttr}" type="button" ${aiEnabled ? '' : 'disabled'}>Shorter</button>
                <button class="button compose-ai-button" data-ai-action="expand" data-ai-disabled="${aiDisabledAttr}" type="button" ${aiEnabled ? '' : 'disabled'}>Longer</button>
                <button class="button compose-ai-button" data-ai-action="formalize" data-ai-disabled="${aiDisabledAttr}" type="button" ${aiEnabled ? '' : 'disabled'}>Formal</button>
                <button class="button compose-ai-button" data-ai-action="casualize" data-ai-disabled="${aiDisabledAttr}" type="button" ${aiEnabled ? '' : 'disabled'}>Casual</button>
                <button class="button compose-ai-button" data-ai-action="proofread" data-ai-disabled="${aiDisabledAttr}" type="button" ${aiEnabled ? '' : 'disabled'}>Fix</button>
                <button class="button compose-ai-button" data-ai-action="summarize" data-ai-disabled="${aiDisabledAttr}" type="button" ${aiEnabled ? '' : 'disabled'}>Summarize</button>
              </div>
              <div class="compose-ai-note muted">
                AI tools are pre-tuned for email composition and rewrite only. Highlight text to transform a selection, or switch to HTML mode when you want Gemini or Llama to generate raw HTML email code.
              </div>
              ${state.compose.editorMode === 'rich' ? `
                <div class="compose-format-row">
                  <button class="button compose-format-button" data-format="bold" type="button"><strong>B</strong></button>
                  <button class="button compose-format-button" data-format="italic" type="button"><em>I</em></button>
                  <button class="button compose-format-button" data-format="underline" type="button"><span class="format-underline">U</span></button>
                  <button class="button compose-format-button" data-format="strike" type="button"><span class="format-strike">S</span></button>
                  <button class="button compose-format-button" data-format="bullets" type="button">Bullets</button>
                  <button class="button compose-format-button" data-format="numbering" type="button">Numbering</button>
                  <button class="button compose-format-button" data-format="quote" type="button">Quote</button>
                  <button class="button compose-format-button" data-format="link" type="button">Link</button>
                  <button class="button compose-format-button" data-format="clear" type="button">Clear</button>
                  <button class="button compose-format-button" data-format="emoji" type="button">Emoji</button>
                  <button class="button compose-format-button" data-format="signature" type="button">Signature</button>
                  <button class="button compose-format-button" data-format="undo" type="button">Undo</button>
                  <button class="button compose-format-button" data-format="redo" type="button">Redo</button>
                </div>
              ` : `
                <div class="compose-ai-note muted">HTML mode sends the raw markup in <code>htmlBody</code>. Use it for coded newsletters, promotional layouts, or AI-generated email templates.</div>
              `}
            </div>
            ${composeBodyMarkup}
            <label class="label full">
              Attachments
              <input id="attachmentInput" type="file" multiple>
            </label>
            <div class="full chip-list">
              ${(state.compose.attachments || []).map((attachment) => `<span class="chip">${escapeHtml(attachment.fileName)}</span>`).join('')}
            </div>
          </div>
          <div class="toolbar">
            <button class="button primary" type="submit" ${composeMailboxCanSend ? '' : 'disabled'}>Send</button>
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
  document.querySelectorAll('.compose-mode-button').forEach((button) => {
    button.addEventListener('click', async () => {
      const form = document.getElementById('composeForm');
      if (form) await syncComposeFromForm(form);
      state.compose.editorMode = button.dataset.composeMode;
      renderCompose();
    });
  });
  document.querySelectorAll('.compose-ai-button').forEach((button) => {
    button.addEventListener('click', () => runComposeAiAction(button.dataset.aiAction).catch(showError));
  });
  document.querySelectorAll('.compose-format-button').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      try {
        applyComposeFormat(button.dataset.format);
        scheduleDraftSave();
      } catch (error) {
        showError(error);
      }
    });
  });
  document.querySelector('#composeForm [name="aiProvider"]')?.addEventListener('change', async (event) => {
    const form = document.getElementById('composeForm');
    if (form) await syncComposeFromForm(form);
    state.compose.aiProvider = event.target.value;
    if (state.compose.aiProvider === 'gemini' && !GEMINI_MODEL_OPTIONS.some((option) => option.id === state.compose.aiModel)) {
      state.compose.aiModel = getDefaultGeminiModel();
    }
    renderCompose();
  });
  document.querySelector('#composeForm [name="aiTone"]')?.addEventListener('change', (event) => {
    state.compose.aiTone = event.target.value;
  });
  document.querySelector('#composeForm [name="aiModel"]')?.addEventListener('change', (event) => {
    state.compose.aiModel = event.target.value;
  });
  getComposeAiPromptInput()?.addEventListener('input', (event) => {
    state.compose.aiPrompt = event.target.value;
  });
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

  const form = document.getElementById('composeForm');
  if (form) {
    form.addEventListener('input', scheduleDraftSave, { passive: true });
    form.addEventListener('change', scheduleDraftSave, { passive: true });
  }
}

function render() {
  renderContent();
  renderCompose();
  updateToolbarState();
  refs.statusMessage.textContent = state.status;
}

function updateToolbarState() {
  const selectedThread = state.selectedThread;
  const canCompose = Boolean(getSendingDomain() && getDefaultMailbox());
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
  const editorMode = normalizeComposeEditorMode(formData.get('editorMode') || state.compose?.editorMode);
  let htmlBody = '';
  let textBody = '';

  if (editorMode === 'html') {
    htmlBody = document.getElementById('composeHtmlSource')?.value || '';
    textBody = stripHtmlToText(htmlBody);
  } else {
    const editor = getComposeEditor();
    htmlBody = String(editor?.innerHTML || '').trim();
    textBody = String(editor?.innerText || '').replace(/\u00a0/g, ' ').trim();
  }

  state.compose = {
    ...state.compose,
    mailboxId: mailbox?.id || state.compose.mailboxId || null,
    domainId: mailbox?.domain_id || state.compose.domainId || null,
    fromAddress: mailbox?.email_address || state.compose.fromAddress || '',
    to: parseInlineAddressList(formData.get('to')),
    cc: parseInlineAddressList(formData.get('cc')),
    bcc: parseInlineAddressList(formData.get('bcc')),
    subject: String(formData.get('subject') || ''),
    textBody,
    htmlBody,
    editorMode,
    aiProvider: String(formData.get('aiProvider') || state.compose.aiProvider || getDefaultAiProvider()),
    aiModel: String(formData.get('aiModel') || state.compose.aiModel || getDefaultGeminiModel()),
    aiTone: String(formData.get('aiTone') || state.compose.aiTone || 'professional'),
    aiPrompt: String(formData.get('aiPrompt') || state.compose.aiPrompt || ''),
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
  const mailbox = payload
    ? getMailboxById(payload.mailboxId) || getSelectedSendingMailbox() || getDefaultMailbox()
    : requireSendingMailbox();
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
  state.compose = {
    ...state.compose,
    editorMode: payload?.editorMode || inferComposeEditorMode(payload),
    aiProvider: payload?.aiProvider || getDefaultAiProvider(),
    aiModel: payload?.aiModel || getDefaultGeminiModel(),
    aiTone: payload?.aiTone || 'professional',
    aiPrompt: payload?.aiPrompt || '',
  };
  renderCompose();
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
    throw new Error('Reply is blocked for receive-only domains. Forward the message or send a new mail from the selected sending domain.');
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

function bindEasterEggs() {
  refs.windowTitle.addEventListener('dblclick', () => {
    state.easterEggs.titleDoubleClickUntil = Date.now() + 320;
    state.easterEggs.titleClickTimers.forEach((timer) => window.clearTimeout(timer));
    state.easterEggs.titleClickTimers = [];
    showClippyDialog();
  });

  refs.windowTitle.addEventListener('click', () => {
    const timer = window.setTimeout(() => {
      state.easterEggs.titleClickTimers = state.easterEggs.titleClickTimers.filter((entry) => entry !== timer);
      const now = Date.now();
      if (now < state.easterEggs.titleDoubleClickUntil) {
        return;
      }
      state.easterEggs.titleClicks = state.easterEggs.titleClicks.filter((timestamp) => now - timestamp < 2200);
      state.easterEggs.titleClicks.push(now);
      if (state.easterEggs.titleClicks.length >= 5) {
        state.easterEggs.titleClicks = [];
        triggerEnvelopeRain();
      }
    }, 260);
    state.easterEggs.titleClickTimers.push(timer);
  });

  refs.statusFolder.addEventListener('click', () => {
    const now = Date.now();
    state.easterEggs.folderClicks = state.easterEggs.folderClicks.filter((timestamp) => now - timestamp < 1200);
    state.easterEggs.folderClicks.push(now);
    if (state.easterEggs.folderClicks.length >= 3) {
      state.easterEggs.folderClicks = [];
      unlockEgg('minesweeper', 'Minesweeper', 'A tiny minefield appeared in the status bar.');
      state.easterEggs.minesweeper = createMinesweeperBoard();
      renderMinesweeperDialog();
    }
  });

  refs.menuItems.forEach((item) => {
    item.addEventListener('click', () => {
      item.classList.add('menu-active');
      window.setTimeout(() => item.classList.remove('menu-active'), 220);
      trackTimedSequence('menuTrail', MENU_SECRET_SEQUENCE, item.dataset.menu, showTimeWarpDialog);
      setStatus(`${item.dataset.menu} menu is decorative, but listening.`);
    });
  });

  refs.windowControls.forEach((button) => {
    button.addEventListener('click', () => {
      trackTimedSequence('controlTrail', WINDOW_CONTROL_SEQUENCE, button.dataset.windowControl, showTaskManagerDialog);
      setStatus('Window controls are decorative in browser mode.');
    });
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
      return;
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    state.easterEggs.konamiTrail.push(key);
    state.easterEggs.konamiTrail = state.easterEggs.konamiTrail.slice(-KONAMI_SEQUENCE.length);
    if (state.easterEggs.konamiTrail.length === KONAMI_SEQUENCE.length
      && state.easterEggs.konamiTrail.every((value, index) => value === KONAMI_SEQUENCE[index])) {
      state.easterEggs.konamiTrail = [];
      activatePlusMode();
    }
  });
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
    if (event.key === 'Enter' && handleSearchCommand(refs.searchBox.value)) {
      event.preventDefault();
      refs.searchBox.value = '';
      return;
    }
    if (event.key === 'Enter' && state.view === 'mail') {
      loadThreads().catch(showError);
    }
  });
  bindEasterEggs();
}

async function boot() {
  bindGlobalActions();
  setThemeFlags();
  state.runtime = await fetch('/api/runtime-config').then((response) => response.json());
  refs.loginMessage.textContent = 'Ready for Google sign-in.';
  await initFirebase();
  await loadZones();
  render();
}

boot().catch(showError);
