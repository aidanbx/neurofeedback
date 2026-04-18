'use strict';

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const connectBtn  = $('connectBtn');
const testModeBtn = $('testModeBtn');
const channelBtns = $('channelBtns');
const connState   = $('connState');
const statusMsg   = $('statusMsg');

// ── App state ──────────────────────────────────────────────────────────────
let selectedChannel = 0;
let _activePanel    = null; // 'settings' | 'programs' | null

const nfHost = new NFHost($('main'));

// ── Icon strip + slide panel ───────────────────────────────────────────────
const slidePanel      = $('slidePanel');
const settingsContent = $('settingsContent');
const programsContent = $('programsContent');
const gearBtn         = $('gearBtn');
const brainBtn        = $('brainBtn');
const historyBtn      = $('historyBtn');

function _closePanel() {
  _activePanel = null;
  slidePanel.classList.add('closed');
  gearBtn.classList.remove('active');
  brainBtn.classList.remove('active');
}

function _openPanel(type) {
  if (_activePanel === type) { _closePanel(); return; }
  _activePanel = type;

  settingsContent.style.display = type === 'settings' ? '' : 'none';
  programsContent.style.display = type === 'programs' ? '' : 'none';

  gearBtn.classList.toggle('active', type === 'settings');
  brainBtn.classList.toggle('active', type === 'programs');
  historyBtn.classList.remove('active');

  if (type === 'programs') _renderProgramsList();
  slidePanel.classList.remove('closed');
}

function _renderProgramsList() {
  programsContent.querySelectorAll('.slide-prog-list').forEach(el => el.remove());

  const programs = nfHost.programs;
  if (!programs.length) return;

  const list = document.createElement('div');
  list.className = 'slide-prog-list';
  programs.forEach(p => {
    const item = document.createElement('div');
    item.className = 'slide-prog-item' + (p.id === nfHost.programId ? ' active' : '');
    item.innerHTML = `<div class="slide-prog-name">${p.title || p.id}</div>`
      + (p.description ? `<div class="slide-prog-desc">${p.description}</div>` : '');
    item.addEventListener('click', () => {
      nfHost.selectProgram(p.id);
      _closePanel();
    });
    list.appendChild(item);
  });
  programsContent.appendChild(list);
}

gearBtn.addEventListener('click', () => {
  window.NFSessions?.hide();
  _openPanel('settings');
});

brainBtn.addEventListener('click', () => {
  window.NFSessions?.hide();
  _openPanel('programs');
});

historyBtn.addEventListener('click', () => {
  _closePanel();
  window.NFSessions?.show();
});

// Close panel when clicking outside the strip + slide panel
document.addEventListener('click', e => {
  if (!_activePanel) return;
  if (!slidePanel.contains(e.target) && !$('iconStrip').contains(e.target)) {
    _closePanel();
  }
});

// ── Connection ─────────────────────────────────────────────────────────────
connectBtn.addEventListener('click', async () => {
  await fetch('/api/connect-toggle', { method: 'POST' });
  tick();
});

testModeBtn.addEventListener('click', async () => {
  await fetch('/api/test-mode', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}' });
  tick();
});

// ── Channel buttons ────────────────────────────────────────────────────────
for (let i = 0; i < 8; i++) {
  const b = document.createElement('button');
  b.textContent = `Ch${i + 1}`;
  b.addEventListener('click', () => { selectedChannel = i; refreshChannelBtns(); tick(); });
  channelBtns.appendChild(b);
}
function refreshChannelBtns() {
  [...channelBtns.children].forEach((b, i) => b.classList.toggle('active', i === selectedChannel));
}
refreshChannelBtns();

// ── Main tick loop ─────────────────────────────────────────────────────────
async function tick() {
  try {
    const state = await fetch('/api/state').then(r => r.json());

    connState.textContent = state.connection_state;
    connState.className   = 'conn-badge ' + state.connection_state;
    connectBtn.textContent = state.connection_state === 'connected' ? 'Disconnect'
                           : state.connection_state === 'scanning'  ? 'Scanning…'
                           : 'Connect';
    connectBtn.disabled = state.test_mode || false;
    testModeBtn.textContent = state.test_mode ? 'Stop Test Mode' : 'Test Mode';
    testModeBtn.classList.toggle('btn-active', state.test_mode || false);
    statusMsg.textContent = state.status_message || '';

    nfHost.onTick(state.metrics || {}, Date.now() / 1000, {
      ...state,
      channel: selectedChannel,
    });
  } catch (e) {
    statusMsg.textContent = `Error: ${e.message}`;
  }
}

tick();
setInterval(tick, 200);
