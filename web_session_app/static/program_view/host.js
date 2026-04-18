'use strict';

// ── NFHost ────────────────────────────────────────────────────────────────────
// Thin host shell. Programs own all their DOM, audio, and lifecycle buttons.
// The host provides only the program container div.
//
// Host interface given to each program:
//   { container, audioCtx, masterGain,
//     session: { start(), stop(), log(obj), active },
//     onCalibrated(), onCalibrationProgress() }
//
// Programs call host.session.start() / stop() themselves when ready.

class NFHost {
  constructor(mainEl) {
    this._mainEl = mainEl;
    this._program = null;
    this._programId = null;
    this._programs = [];
    this._sessionActive = false;

    this.audioCtx = null;
    this.masterGain = null;

    this._loadedScripts = {};
    this._panel = null;
    this._container = null;
    this._statusEl = null;
    this._noteLogEl = null;
    this._noteInputEl = null;
    this._lastTickElapsed = 0;

    this._buildDOM();
    this._loadPrograms();
  }

  // ── Public API (for app.js panel) ─────────────────────────────────────────

  get programs()  { return this._programs; }
  get programId() { return this._programId; }
  async selectProgram(id) { await this._selectProgram(id); }

  // ── DOM ───────────────────────────────────────────────────────────────────

  _buildDOM() {
    const panel = document.getElementById('trainingPanel');
    panel.className = '';
    this._panel = panel;

    const container = this._el('div', {
      id: 'nfProgramContainer',
      style: 'flex:1;min-height:0;display:flex;flex-direction:column;',
    });

    panel.appendChild(container);
    this._container = container;
    // Status element lives in the slide panel (#programsContent)
    this._statusEl = document.getElementById('nfHostStatus');

    // Host-level note UI (always available during a session)
    const noteLog = this._el('div', {
      id: 'nfHostNoteLog',
      style: 'max-height:80px;overflow-y:auto;font-size:11px;color:var(--muted);padding:2px 0;',
    });
    const noteInput = this._el('input', {
      type: 'text',
      id: 'nfHostNoteInput',
      placeholder: 'Note… (Enter)',
      style: 'width:100%;box-sizing:border-box;background:var(--input-bg,#1a1a2e);border:1px solid var(--border,#2a2a3e);color:var(--fg,#c4c4d4);font-size:11px;padding:3px 6px;border-radius:3px;',
    });
    noteInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sessionAddNote(noteInput.value);
        noteInput.value = '';
      }
    });
    const noteSection = this._el('div', {
      id: 'nfHostNoteSection',
      style: 'display:none;padding:6px 8px;border-top:1px solid var(--border,#2a2a3e);',
    }, [
      this._el('div', { style: 'font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:4px;' }, ['Session Notes']),
      noteLog,
      noteInput,
    ]);
    panel.appendChild(noteSection);
    this._noteLogEl   = noteLog;
    this._noteInputEl = noteInput;
    this._noteSectionEl = noteSection;
  }

  _el(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else el[k] = v;
    });
    children.forEach(c => el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return el;
  }

  // ── Program loading ───────────────────────────────────────────────────────

  async _loadPrograms() {
    try {
      const res = await fetch('/api/programs');
      this._programs = await res.json();
    } catch {
      this._programs = [];
    }

    if (!this._programs.length) {
      this._setStatus('uncalibrated', 'No programs');
      return;
    }

    // Prefer "debug" if present, otherwise first JS program
    const preferred = this._programs.find(p => p.id === 'debug')
      ?? this._programs.find(p => p._has_program_js)
      ?? this._programs[0];
    if (preferred) {
      await this._selectProgram(preferred.id);
    }
  }

  async _selectProgram(id) {
    if (this._sessionActive) await this._stopSession();
    if (this._program) {
      try { this._program.destroy(); } catch {}
      this._program = null;
    }
    this._programId = id;
    this._container.innerHTML = '';
    this._setStatus('loading', 'Loading…');

    const prog = this._programs.find(p => p.id === id);
    if (!prog?._has_program_js) {
      this._container.innerHTML = `<div style="padding:20px;color:var(--muted);font-size:12px;">
        Program "${id}" is a legacy JSON config and has not been migrated to a JS program yet.</div>`;
      this._setStatus('uncalibrated', 'Legacy program');
      return;
    }

    try {
      await this._loadScript(`/programs/${id}/program.js`);
    } catch (e) {
      this._container.innerHTML = `<div style="padding:20px;color:var(--poor);">Failed to load: ${e.message}</div>`;
      this._setStatus('uncalibrated', 'Load error');
      return;
    }

    const Cls = window.NFPrograms?.[id];
    if (!Cls) {
      this._container.innerHTML = `<div style="padding:20px;color:var(--poor);">Class not found: window.NFPrograms.${id}</div>`;
      this._setStatus('uncalibrated', 'Class missing');
      return;
    }

    try {
      this._program = new Cls(this._makeHostInterface());
    } catch (e) {
      console.error('Program constructor error:', e);
      this._setStatus('uncalibrated', 'Init error');
      return;
    }
    this._setStatus('ready', 'Ready');
  }

  _makeHostInterface() {
    const that = this;
    return {
      container:  this._container,
      audioCtx:   this.audioCtx,
      masterGain: this.masterGain,
      session: {
        start:     (metadata)      => that._startSession(metadata),
        stop:      (summary)       => that._stopSession(summary),
        emit:      (type, payload) => that._sessionEmit(type, payload),
        addNote:   (text)          => that._sessionAddNote(text),
        logOutput: (row)           => that._sessionLogOutput(row),
        // backward-compat alias
        log:       (obj)           => that._sessionEmit(obj.type ?? 'event', obj),
        get active() { return that._sessionActive; },
      },
      setStatus: (cls, text) => that._setStatus(cls, text),
    };
  }

  _loadScript(src) {
    if (this._loadedScripts[src]) return this._loadedScripts[src];
    const p = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) existing.remove();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load: ${src}`));
      document.head.appendChild(s);
    });
    this._loadedScripts[src] = p;
    return p;
  }

  // ── Audio context ────────────────────────────────────────────────────────

  _ensureAudioCtx() {
    if (this.audioCtx) { this.audioCtx.resume(); return; }
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.audioCtx.createGain();
    this.masterGain.gain.value = 0.8;
    this.masterGain.connect(this.audioCtx.destination);
    if (this._program?.updateHost) {
      this._program.updateHost({ audioCtx: this.audioCtx, masterGain: this.masterGain });
    }
  }

  // ── Session lifecycle ────────────────────────────────────────────────────

  async _startSession(metadata) {
    if (!this._program || this._sessionActive) return;
    this._ensureAudioCtx();
    await fetch('/api/training/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program_id: this._programId,
        program: this._programs.find(p => p.id === this._programId) ?? { id: this._programId },
        metadata: metadata ?? {},
      }),
    });
    this._sessionActive = true;
    if (this._noteSectionEl) this._noteSectionEl.style.display = '';
    if (this._noteLogEl) this._noteLogEl.innerHTML = '';
    this._setStatus('running', 'Recording');
    this._program.startSession();
  }

  async _stopSession(summary) {
    if (!this._program) return;
    if (this._sessionActive) {
      this._program.stopSession();
      this._sessionActive = false;
    }
    await fetch('/api/training/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(summary ?? {}),
    });
    if (this._noteSectionEl) this._noteSectionEl.style.display = 'none';
    this._setStatus('ready', 'Ready');
  }

  async _sessionEmit(type, payload) {
    if (!this._sessionActive) return;
    try {
      await fetch('/api/session/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, ...payload }),
      });
    } catch {}
  }

  async _sessionAddNote(text) {
    text = (text || '').trim();
    if (!text || !this._sessionActive) return;
    await this._sessionEmit('note', { text });
    // Update host note log if visible
    if (this._noteLogEl) {
      const elapsed = this._lastTickElapsed ?? 0;
      const ts = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;
      const entry = document.createElement('div');
      entry.style.cssText = 'font-size:11px;color:var(--muted);padding:2px 0;';
      entry.textContent = `[${ts}] ${text}`;
      this._noteLogEl.appendChild(entry);
      this._noteLogEl.scrollTop = this._noteLogEl.scrollHeight;
    }
  }

  async _sessionLogOutput(row) {
    if (!this._sessionActive) return;
    try {
      await fetch('/api/session/output-trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      });
    } catch {}
  }

  // ── Tick (called from app.js) ─────────────────────────────────────────────

  onTick(metrics, elapsed, appState) {
    this._lastTickElapsed = elapsed;
    if (this._program) {
      this._program.onTick(metrics, elapsed, appState);
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  _setStatus(cls, text) {
    if (!this._statusEl) return;
    this._statusEl.className  = `nf-status ${cls}`;
    this._statusEl.textContent = text;
  }

  // ── Show / hide ───────────────────────────────────────────────────────────

  async show() {
    this._mainEl.classList.add('training-mode');
    if (!this._programs.length) await this._loadPrograms();
  }

  hide() {
    if (this._sessionActive) this._stopSession();
    this._mainEl.classList.remove('training-mode');
  }
}
