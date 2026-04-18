'use strict';

// ── NFSessions ────────────────────────────────────────────────────────────────
(function () {

const sessionsPanel     = document.getElementById('sessionsPanel');
const trainingPanel     = document.getElementById('trainingPanel');
const sessionsSelectBtn = document.getElementById('sessionsSelectBtn');
const sessionsArchiveBtn = document.getElementById('sessionsArchiveBtn');
const sessionsList      = document.getElementById('sessionsList');
const sessionsDetailView = document.getElementById('sessionsDetailView');

let _mode           = false;
let _selected       = null;
let _selectMode     = false;
let _checked        = new Set();
let _sessions       = [];
let _lastCheckedIdx = null;   // for shift-click range select

// ── SVG icons (outline, no emoji) ─────────────────────────────────────────

const SVG_NOTE = `<svg viewBox="0 0 11 13" width="11" height="13" fill="none"
  stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <rect x="1" y="1" width="9" height="11" rx="1.2"/>
  <line x1="3" y1="4"   x2="8" y2="4"/>
  <line x1="3" y1="6.5" x2="8" y2="6.5"/>
  <line x1="3" y1="9"   x2="6" y2="9"/>
</svg>`;

const SVG_NOTE_LARGE = `<svg viewBox="0 0 36 36" width="36" height="36" fill="none"
  stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
  style="opacity:0.35">
  <rect x="5" y="3" width="26" height="30" rx="3"/>
  <line x1="11" y1="11" x2="25" y2="11"/>
  <line x1="11" y1="17" x2="25" y2="17"/>
  <line x1="11" y1="23" x2="19" y2="23"/>
</svg>`;

// ── Utility ────────────────────────────────────────────────────────────────

function _el(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el[k] = v;
  }
  for (const c of children)
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

function post(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSessionDate(id) {
  const m = id.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}  ${m[4]}:${m[5]}` : id;
}

// ── Confirmation popup ─────────────────────────────────────────────────────

function _confirm(message, onConfirm) {
  const overlay = _el('div', {class: 'confirm-overlay'});
  const box = _el('div', {class: 'confirm-box'});
  const msg = _el('p', {class: 'confirm-msg'}, [message]);
  const btns = _el('div', {class: 'confirm-btns'});
  const cancelBtn = _el('button', {class: 'btn-tiny'}, ['Cancel']);
  const yesBtn = _el('button', {class: 'btn-tiny btn-destructive'}, ['Yes, proceed']);
  const close = () => document.body.removeChild(overlay);
  cancelBtn.onclick = close;
  yesBtn.onclick = () => { close(); onConfirm(); };
  btns.appendChild(cancelBtn);
  btns.appendChild(yesBtn);
  box.appendChild(msg);
  box.appendChild(btns);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

// ── Note section ───────────────────────────────────────────────────────────

async function _loadNote(sessionId, noteSection) {
  noteSection.innerHTML = '';
  noteSection.dataset.loaded = '0';
  try {
    const res = await fetch(`/api/session/note?id=${encodeURIComponent(sessionId)}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) { _renderNoteEmpty(sessionId, noteSection, ''); return; }
    const data = await res.json();
    noteSection.dataset.loaded = '1';
    if (data.exists) {
      _renderNoteView(sessionId, noteSection, data.content);
    } else {
      _renderNoteEmpty(sessionId, noteSection, data.content || '');
    }
  } catch (e) {
    _renderNoteEmpty(sessionId, noteSection, '');
  }
}

function _renderNoteEmpty(sessionId, noteSection, template) {
  noteSection.innerHTML = '';
  noteSection.dataset.template = template;

  const center = _el('div', {class: 'note-empty-center'});
  center.innerHTML = SVG_NOTE_LARGE + '<span class="note-empty-label">Add note</span>';
  center.addEventListener('click', () => _renderNoteEdit(sessionId, noteSection, template, false));
  noteSection.appendChild(center);
}

function _renderNoteView(sessionId, noteSection, content) {
  noteSection.innerHTML = '';
  const header = _el('div', {class: 'note-section-header'});
  const lbl = _el('span', {class: 'note-section-label'}, ['Note']);
  const editBtn = _el('button', {class: 'btn-tiny'}, ['Edit']);
  editBtn.onclick = () => _renderNoteEdit(sessionId, noteSection, content, true);
  header.appendChild(lbl);
  header.appendChild(editBtn);

  const body = _el('div', {class: 'note-body'});
  body.appendChild(_el('pre', {class: 'note-text'}, [content]));

  noteSection.appendChild(header);
  noteSection.appendChild(body);
}

function _renderNoteEdit(sessionId, noteSection, initialContent, isExisting = false) {
  noteSection.innerHTML = '';

  const header = _el('div', {class: 'note-section-header'});
  const lbl = _el('span', {class: 'note-section-label'}, ['Note']);
  const saveBtn = _el('button', {class: 'btn-tiny btn-save'}, ['Save']);
  const cancelBtn = _el('button', {class: 'btn-tiny'}, ['Cancel']);
  header.appendChild(lbl);
  header.appendChild(saveBtn);
  header.appendChild(cancelBtn);

  const ta = _el('textarea', {class: 'note-editor'});
  ta.value = initialContent;

  const footer = _el('div', {class: 'note-footer'});
  const delBtn = _el('button', {class: 'btn-tiny btn-destructive'}, ['Delete note']);
  if (!isExisting) delBtn.style.display = 'none';
  footer.appendChild(delBtn);

  noteSection.appendChild(header);
  noteSection.appendChild(ta);
  noteSection.appendChild(footer);

  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  cancelBtn.onclick = () => _loadNote(sessionId, noteSection);

  saveBtn.onclick = async () => {
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      await post('/api/session/note', { id: sessionId, content: ta.value });
      await _loadNote(sessionId, noteSection);
      refresh();
    } catch (e) {
      saveBtn.disabled = false; saveBtn.textContent = 'Save';
    }
  };

  delBtn.onclick = () => {
    _confirm('Delete this session note? This cannot be undone.', async () => {
      await post('/api/session/note/delete', { id: sessionId });
      await _loadNote(sessionId, noteSection);
      refresh();
    });
  };
}

// Open note editor (called when no explicit isExisting context available)
function _triggerNoteEdit(sessionId, noteSection) {
  const template = noteSection.dataset.template || '';
  const hasNote = !!noteSection.querySelector('.note-text');
  if (hasNote) {
    const pre = noteSection.querySelector('.note-text');
    _renderNoteEdit(sessionId, noteSection, pre ? pre.textContent : template, true);
  } else {
    _renderNoteEdit(sessionId, noteSection, template, false);
  }
}

// ── Session detail view ────────────────────────────────────────────────────

function _buildDetail(s) {
  sessionsDetailView.innerHTML = '';
  _selected = s.id;
  sessionsList.querySelectorAll('.session-item')
    .forEach(el => el.classList.toggle('active', el.dataset.id === s.id));

  const wrap = _el('div', {class: 'session-detail-wrap'});

  // ── Header card ──
  const card = _el('div', {class: 'session-detail-card'});

  const row1 = _el('div', {class: 'session-detail-row1'});
  const nameEl = _el('div', {class: 'session-detail-name'}, [s.training_program || 'Session']);
  const iconActions = _el('div', {class: 'session-detail-icon-actions'});

  const starBtn = _el('button', {
    class: 'detail-star' + (s.is_favorite ? ' active' : ''),
    title: s.is_favorite ? 'Unfavorite' : 'Favorite',
  });
  starBtn.innerHTML = s.is_favorite ? '★' : '☆';
  starBtn.onclick = () => _toggleFavorite(s.id, s.is_favorite);

  iconActions.appendChild(starBtn);
  row1.appendChild(nameEl);
  row1.appendChild(iconActions);

  const metaParts = [
    formatSessionDate(s.id),
    formatDuration(s.duration_sec || 0),
    s.device || '',
  ].filter(Boolean).join('  ·  ');

  const row2 = _el('div', {class: 'session-detail-row2'});
  const metaEl = _el('div', {class: 'session-detail-meta'}, [metaParts]);
  row2.appendChild(metaEl);

  card.appendChild(row1);
  card.appendChild(row2);
  wrap.appendChild(card);

  // ── Note section ──
  const noteSection = _el('div', {class: 'session-note-section'});
  wrap.appendChild(noteSection);
  _loadNote(s.id, noteSection);

  // ── Report ──
  if (s.has_report || s.training_program) {
    const reportSec = _el('div', {class: 'session-report-section'});
    const frame = _el('iframe', {class: 'report-frame', src: `/session/${s.id}/report.html`});
    frame.addEventListener('load', function () {
      try {
        const h = this.contentWindow.document.body.scrollHeight;
        this.style.height = Math.max(h, 400) + 'px';
      } catch (e) { this.style.height = '700px'; }
    });
    reportSec.appendChild(frame);
    wrap.appendChild(reportSec);
  } else {
    wrap.appendChild(_el('div', {class: 'sessions-detail-placeholder', style: 'min-height:80px'}, ['No report for this session.']));
  }

  // ── Archive footer (bottom-right) ──
  const archFooter = _el('div', {class: 'session-archive-footer'});
  const archBtn = _el('button', {class: 'btn-tiny btn-destructive', title: 'Archive this session'}, ['Archive session']);
  archBtn.onclick = () => _archiveOne(s.id);
  archFooter.appendChild(archBtn);
  wrap.appendChild(archFooter);

  sessionsDetailView.appendChild(wrap);
}

function openSession(s) { _buildDetail(s); }

// ── Favorites / archive ────────────────────────────────────────────────────

async function _toggleFavorite(sessionId, currentlyFavorite) {
  const res = await post('/api/session/favorite', { id: sessionId, favorite: !currentlyFavorite });
  if (res.new_id) _selected = res.new_id;
  await refresh();
  const s = _sessions.find(x => x.id === _selected);
  if (s) _buildDetail(s);
}

function _archiveOne(sessionId) {
  _confirm('Archive this session? It will be removed from the main list.', async () => {
    await post('/api/session/archive', { ids: [sessionId] });
    _selected = null;
    sessionsDetailView.innerHTML = '<div class="sessions-detail-placeholder">Session archived.</div>';
    await refresh();
  });
}

async function _archiveSelected() {
  if (!_checked.size) return;
  const ids = [..._checked];
  _confirm(`Archive ${ids.length} session${ids.length > 1 ? 's' : ''}?`, async () => {
    await post('/api/session/archive', { ids });
    if (ids.includes(_selected)) {
      _selected = null;
      sessionsDetailView.innerHTML = '<div class="sessions-detail-placeholder">Sessions archived.</div>';
    }
    exitSelectMode();
    await refresh();
  });
}

// ── Select mode ────────────────────────────────────────────────────────────

function enterSelectMode() {
  _selectMode = true;
  _checked.clear();
  _lastCheckedIdx = null;
  sessionsSelectBtn.textContent = 'Cancel';
  sessionsArchiveBtn.style.display = '';
  _updateArchiveBtn();
  _rebuildList();
}

function exitSelectMode() {
  _selectMode = false;
  _checked.clear();
  _lastCheckedIdx = null;
  sessionsSelectBtn.textContent = 'Select';
  sessionsArchiveBtn.style.display = 'none';
  _rebuildList();
}

function _updateArchiveBtn() {
  sessionsArchiveBtn.textContent = `Archive (${_checked.size})`;
  sessionsArchiveBtn.disabled = _checked.size === 0;
}

// ── Session list ───────────────────────────────────────────────────────────

function _buildItem(s, idx) {
  const el = _el('div', {class: 'session-item' + (s.id === _selected ? ' active' : '')});
  el.dataset.id = s.id;

  const statusClass = s.analysis_status.startsWith('error') ? 'error'
                    : s.analysis_status === 'done'    ? 'done'
                    : s.analysis_status === 'running' ? 'running' : 'not_run';
  const statusText  = s.analysis_status.startsWith('error') ? 'err'
                    : s.analysis_status === 'done'    ? 'done'
                    : s.analysis_status === 'running' ? 'running…' : '—';

  // Left icons column
  const iconsCol = _el('div', {class: 'session-item-icons'});

  const starBtn = _el('button', {
    class: 'session-star' + (s.is_favorite ? ' active' : ''),
    title: s.is_favorite ? 'Unfavorite' : 'Favorite',
  });
  starBtn.innerHTML = s.is_favorite ? '★' : '☆';
  starBtn.addEventListener('click', e => { e.stopPropagation(); _toggleFavorite(s.id, s.is_favorite); });
  iconsCol.appendChild(starBtn);

  if (s.has_note) {
    const noteInd = _el('span', {class: 'session-note-ind', title: 'Has note'});
    noteInd.innerHTML = SVG_NOTE;
    iconsCol.appendChild(noteInd);
  }

  if (_selectMode) {
    const cb = _el('input', {type: 'checkbox', class: 'session-checkbox'});
    cb.checked = _checked.has(s.id);
    cb.addEventListener('click', e => {
      e.stopPropagation();
      if (e.shiftKey && _lastCheckedIdx !== null) {
        const lo = Math.min(idx, _lastCheckedIdx);
        const hi = Math.max(idx, _lastCheckedIdx);
        for (let i = lo; i <= hi; i++) _checked.add(_sessions[i].id);
        cb.checked = true;
        _rebuildList();
      } else {
        if (cb.checked) _checked.add(s.id); else _checked.delete(s.id);
      }
      _lastCheckedIdx = idx;
      _updateArchiveBtn();
    });
    iconsCol.appendChild(cb);
  }

  const info = _el('div', {class: 'session-item-info'});
  info.innerHTML = `
    <div class="session-item-name">${s.training_program || 'Session'}</div>
    <div class="session-item-date">${formatSessionDate(s.id)}</div>
    <div class="session-item-bottom">
      <span class="session-item-dur">${formatDuration(s.duration_sec || 0)}</span>
      <span class="session-status status-${statusClass}">${statusText}</span>
    </div>
  `;
  info.addEventListener('click', () => openSession(s));

  el.appendChild(iconsCol);
  el.appendChild(info);
  return el;
}

function _rebuildList() {
  sessionsList.innerHTML = '';
  _sessions.forEach((s, i) => sessionsList.appendChild(_buildItem(s, i)));
}

// ── Refresh ────────────────────────────────────────────────────────────────

async function refresh() {
  try {
    _sessions = await fetch('/api/sessions').then(r => r.json());
    _rebuildList();
    if (_selected) {
      sessionsList.querySelectorAll('.session-item')
        .forEach(el => el.classList.toggle('active', el.dataset.id === _selected));
    } else {
      const newest = _sessions.find(s => s.has_report || s.training_program) || _sessions[0];
      if (newest) openSession(newest);
    }
  } catch (e) {
    sessionsList.innerHTML = `<div style="color:var(--poor);font-size:11px;padding:8px">Error: ${e.message}</div>`;
  }
}

// ── Panel show / hide ──────────────────────────────────────────────────────

function show() {
  _mode = true;
  sessionsPanel.style.display = 'flex';
  trainingPanel.style.display = 'none';
  document.getElementById('historyBtn')?.classList.add('active');
  refresh();
}

function hide() {
  _mode = false;
  sessionsPanel.style.display = 'none';
  trainingPanel.style.display = '';
  document.getElementById('historyBtn')?.classList.remove('active');
}

function toggle() { _mode ? hide() : show(); }

// ── Wiring ─────────────────────────────────────────────────────────────────

sessionsSelectBtn?.addEventListener('click', () => _selectMode ? exitSelectMode() : enterSelectMode());
sessionsArchiveBtn?.addEventListener('click', _archiveSelected);

setInterval(refresh, 3000);
refresh();

window.NFSessions = { toggle, show, hide, refresh };

})();
