'use strict';

// ── Debug / Diagnostics Program ───────────────────────────────────────────────
// Self-contained live EEG diagnostics. Replicates the legacy "live view" as a
// proper program. No calibration needed — just Start Recording.
//
// Registers as: window.NFPrograms.debug

(function () {

const C = {
  bg: '#0d0d14', panel: '#13131e', grid: '#1e1e2c', text: '#c4c4d4',
  muted: '#44445a', wave: '#4488ff',
  eye: 'rgba(80,80,200,0.18)', posture: 'rgba(60,160,80,0.13)', clench: 'rgba(220,80,80,0.18)',
  bands: {
    Delta: '#7777dd', Theta: '#55bb88', Alpha: '#f0cc44',
    SMR: '#f08030', Beta: '#e05050', 'Hi-Beta': '#cc55dd',
  },
  good: '#44cc66', fair: '#ddaa33', poor: '#cc4444',
};

const BAND_NAMES = ['Delta', 'Theta', 'Alpha', 'SMR', 'Beta', 'Hi-Beta'];
const BAND_RANGES = { Delta:[1,4], Theta:[4,8], Alpha:[8,12], SMR:[12,15], Beta:[15,20], 'Hi-Beta':[20,30] };
const TREND_LEN = 90;
const SPEC_EMA = 0.06;

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

// ── Canvas helpers ────────────────────────────────────────────────────────────

function fillCanvas(ctx, canvas, color) {
  ctx.fillStyle = color || C.panel;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}
function drawGrid(ctx, canvas, nx = 4, ny = 4) {
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let i = 1; i < nx; i++) {
    const x = (i / nx) * canvas.width;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let i = 1; i < ny; i++) {
    const y = (i / ny) * canvas.height;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}
function drawAxisLabels(ctx, canvas, xMin, xMax, yMin, yMax, yUnit) {
  ctx.fillStyle = C.muted; ctx.font = '20px ui-monospace, monospace';
  ctx.fillText(`${xMin.toFixed(1)}s`, 6, canvas.height - 6);
  ctx.fillText(`${xMax.toFixed(1)}s`, canvas.width - 46, canvas.height - 6);
  if (yUnit) {
    ctx.fillText(`${yMax.toFixed(0)}${yUnit}`, 6, 22);
    ctx.fillText(`${yMin.toFixed(0)}`, 6, canvas.height - 22);
  }
}
function quantile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.min(s.length - 1, Math.floor((s.length - 1) * p)))];
}
function autoBounds(arr) {
  if (!arr.length) return [-200, 200];
  const lo = quantile(arr, 0.02), hi = quantile(arr, 0.98);
  const span = Math.max(20, hi - lo), mid = (lo + hi) / 2;
  return [mid - span * 0.65, mid + span * 0.65];
}
function drawSpans(ctx, canvas, events, key, color, xMin, xMax) {
  if (!events?.length) return;
  let inSpan = false, spanStart = null;
  for (const ev of events) {
    const t = Number(ev.elapsed);
    if (!inSpan && ev.state === key)  { inSpan = true; spanStart = t; }
    if ( inSpan && ev.state !== key)  { shade(ctx, canvas, spanStart, t, xMin, xMax, color); inSpan = false; }
  }
  if (inSpan) shade(ctx, canvas, spanStart, xMax, xMin, xMax, color);
}
function shade(ctx, canvas, t0, t1, xMin, xMax, color) {
  const L = ((Math.max(t0, xMin) - xMin) / Math.max(1e-9, xMax - xMin)) * canvas.width;
  const R = ((Math.min(t1, xMax) - xMin) / Math.max(1e-9, xMax - xMin)) * canvas.width;
  if (R <= L) return;
  ctx.fillStyle = color;
  ctx.fillRect(L, 0, R - L, canvas.height);
}
function heatRGB(t) {
  t = Math.max(0, Math.min(1, t));
  let r, g, b;
  if (t < 0.25) { const s = t / 0.25; r = Math.round(s * 90); g = 0; b = Math.round(s * 160); }
  else if (t < 0.5) { const s = (t - 0.25) / 0.25; r = Math.round(90 + s * 120); g = Math.round(s * 60); b = Math.round(160 + s * 40); }
  else if (t < 0.75) { const s = (t - 0.5) / 0.25; r = Math.round(210 + s * 45); g = Math.round(60 + s * 130); b = Math.round(200 - s * 180); }
  else { const s = (t - 0.75) / 0.25; r = 255; g = Math.round(190 + s * 65); b = Math.round(20 + s * 20); }
  return `rgb(${r},${g},${b})`;
}
function drawSparkline(ctx, canvas, data, color) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#1a1a28'; ctx.fillRect(0, 0, W, H);
  const max = Math.max(...data, 1);
  ctx.strokeStyle = color + 'cc'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  data.forEach((v, i) => {
    const px = (i / (data.length - 1)) * W;
    const py = H - (v / max) * H;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.stroke();
}

// ── Program class ─────────────────────────────────────────────────────────────

class DebugProgram {
  constructor(host) {
    this._host = host;

    // Filter state (owned by this program)
    this._notch60      = false;
    this._deltaExclude = false;
    this._recenter     = false;
    this._windowSec    = 4;

    // Canvas state
    this._specBounds = null;
    this._trends     = {};
    BAND_NAMES.forEach(n => { this._trends[n] = new Array(TREND_LEN).fill(0); });

    // View fetch
    this._fetchPending = false;

    this._buildDOM();
  }

  updateHost({ audioCtx, masterGain }) {
    this._host.audioCtx  = audioCtx;
    this._host.masterGain = masterGain;
  }

  startSession() {
    this._host.session.emit('session_start', {
      settings: {
        notch60: this._notch60,
        delta_exclude: this._deltaExclude,
        recenter: this._recenter,
        window_sec: this._windowSec,
      },
    });
  }

  stopSession() {
    this._host.session.emit('session_stop', {});
  }

  destroy() { this._host.container.innerHTML = ''; }

  // ── Tick ───────────────────────────────────────────────────────────────────

  onTick(metrics, _elapsed, appState) {
    if (!appState) return;
    this._syncTopbar(metrics, appState);
    this._updateDiagnostics(metrics);

    // Async view fetch (fire-and-forget; no overlapping requests)
    if (!this._fetchPending) {
      this._fetchPending = true;
      const ch = appState.channel ?? 0;
      const params = new URLSearchParams({
        mode: 'live',
        window:   String(this._windowSec),
        channel:  String(ch),
        notch60:  this._notch60  ? '1' : '0',
        recenter: this._recenter ? '1' : '0',
      });
      fetch(`/api/view?${params}`)
        .then(r => r.json())
        .then(view => {
          this._fetchPending = false;
          this._drawWaveform(view, appState.recording);
          this._drawPSD(view);
          this._drawSpectrogram(view);
          const bandData = this._deltaExclude
            ? (metrics.relative_training ?? view.relative_band_power)
            : view.relative_band_power;
          this._updateBandBars(bandData);
          const tag = [this._notch60 ? 'notch60' : null, this._recenter ? 'recenter' : null]
            .filter(Boolean).join('+') || 'raw';
          if (this._waveLabelEl) this._waveLabelEl.textContent = `Ch${ch + 1}  ${tag}`;
        })
        .catch(() => { this._fetchPending = false; });
    }
  }

  // ── Topbar sync ────────────────────────────────────────────────────────────

  _syncTopbar(metrics, appState) {
    const score = metrics.quality_score ?? null;
    const lbl   = metrics.quality_label ?? '--';
    if (score !== null) {
      const color = lbl === 'good' ? C.good : lbl === 'fair' ? C.fair : C.poor;
      this._qualScoreEl.textContent = Math.round(score);
      this._qualLabelEl.textContent = lbl;
      this._qualScoreEl.style.color  = color;
      this._qualLabelEl.style.color  = color;
      this._qualBarFill.style.width  = `${score}%`;
      this._qualBarFill.style.background = color;
    }
    const dur = appState.duration_sec || 0;
    const m = Math.floor(dur / 60), s = Math.floor(dur % 60);
    this._recDurEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    const rec = appState.recording;
    this._recDotEl.classList.toggle('active', !!rec);
    this._recordBtn.textContent = rec ? 'Stop Recording' : 'Start Recording';
    this._recordBtn.className   = rec ? 'btn-record active' : 'btn-primary';
    const ar = appState.artifact_rejection;
    this._artifactBtn.textContent = `Artifact: ${ar ? 'On' : 'Off'}`;
    this._artifactBtn.classList.toggle('active', !!ar);
  }

  // ── DOM ────────────────────────────────────────────────────────────────────

  _buildDOM() {
    const c = this._host.container;
    c.innerHTML = '';
    c.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px;overflow-y:auto;height:100%;box-sizing:border-box;';

    c.appendChild(this._buildTopbar());
    c.appendChild(this._buildControls());

    const wavePanel = _el('div', { class: 'panel', style: 'flex-shrink:0' });
    const waveTitle = _el('div', { class: 'panel-title' });
    this._waveLabelEl = _el('span', { class: 'muted' }, ['']);
    waveTitle.appendChild(document.createTextNode('EEG Waveform '));
    waveTitle.appendChild(this._waveLabelEl);
    this._waveCanvas = _el('canvas');
    this._waveCanvas.width = 2000; this._waveCanvas.height = 220;
    this._waveCtx = this._waveCanvas.getContext('2d');
    wavePanel.appendChild(waveTitle);
    wavePanel.appendChild(this._waveCanvas);
    c.appendChild(wavePanel);

    const row1 = _el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:6px;flex-shrink:0;' });
    row1.appendChild(this._buildBandBarsPanel());
    row1.appendChild(this._buildSpectrogramPanel());
    c.appendChild(row1);

    const row2 = _el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:6px;flex-shrink:0;' });
    row2.appendChild(this._buildPSDPanel());
    row2.appendChild(this._buildDiagPanel());
    c.appendChild(row2);
  }

  _buildTopbar() {
    const el = _el('div', { style: 'display:flex;align-items:center;gap:10px;padding:6px 10px;background:var(--panel);border:1px solid var(--border);border-radius:5px;flex-shrink:0;' });

    this._qualScoreEl = _el('span', { style: 'font-size:18px;font-weight:700;min-width:32px;' }, ['--']);
    this._qualLabelEl = _el('span', { style: 'font-size:11px;text-transform:uppercase;letter-spacing:0.1em;min-width:30px;' }, ['--']);
    const qualTrack = _el('div', { style: 'width:100px;height:5px;background:#1e1e2e;border-radius:3px;overflow:hidden;' });
    this._qualBarFill = _el('div', { style: 'height:100%;border-radius:3px;transition:width 0.3s,background 0.3s;' });
    qualTrack.appendChild(this._qualBarFill);

    this._recDotEl  = _el('span', { class: 'rec-dot', style: 'margin-left:auto;' });
    this._recDurEl  = _el('span', { style: 'font-size:14px;font-variant-numeric:tabular-nums;' }, ['0:00']);
    this._recordBtn = _el('button', { class: 'btn-primary' }, ['Start Recording']);
    this._recordBtn.addEventListener('click', () => this._toggleRecording());

    el.appendChild(this._qualScoreEl);
    el.appendChild(this._qualLabelEl);
    el.appendChild(qualTrack);
    el.appendChild(this._recDotEl);
    el.appendChild(this._recDurEl);
    el.appendChild(this._recordBtn);
    return el;
  }

  _buildControls() {
    const el = _el('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:6px 10px;background:var(--panel);border:1px solid var(--border);border-radius:5px;flex-shrink:0;' });

    const div = () => _el('span', { style: 'width:1px;height:18px;background:var(--border);margin:0 3px;flex-shrink:0;' });

    this._notchBtn    = _el('button', { class: 'btn-toggle' }, ['Notch 60Hz: Off']);
    this._deltaBtn    = _el('button', { class: 'btn-toggle' }, ['Bands: 1-30Hz']);
    this._recenterBtn = _el('button', { class: 'btn-toggle' }, ['Recenter: Off']);
    this._artifactBtn = _el('button', { class: 'btn-toggle' }, ['Artifact: Off']);

    this._notchBtn.addEventListener('click', () => {
      this._notch60 = !this._notch60;
      this._notchBtn.textContent = `Notch 60Hz: ${this._notch60 ? 'On' : 'Off'}`;
      this._notchBtn.classList.toggle('active', this._notch60);
    });
    this._deltaBtn.addEventListener('click', () => {
      this._deltaExclude = !this._deltaExclude;
      this._deltaBtn.textContent = this._deltaExclude ? 'Bands: 4-30Hz' : 'Bands: 1-30Hz';
      this._deltaBtn.classList.toggle('active', this._deltaExclude);
    });
    this._recenterBtn.addEventListener('click', () => {
      this._recenter = !this._recenter;
      this._recenterBtn.textContent = `Recenter: ${this._recenter ? 'On' : 'Off'}`;
      this._recenterBtn.classList.toggle('active', this._recenter);
    });
    this._artifactBtn.addEventListener('click', () => fetch('/api/artifact-toggle', { method: 'POST' }));

    // Window slider
    const winValEl = _el('span', { style: 'color:var(--muted);font-size:11px;min-width:22px;' }, ['4s']);
    const winSlider = _el('input', { type: 'range', min: '1', max: '20', step: '1', value: '4' });
    winSlider.style.cssText = 'width:70px;accent-color:var(--accent);';
    winSlider.addEventListener('input', () => {
      this._windowSec = +winSlider.value;
      winValEl.textContent = `${winSlider.value}s`;
    });
    const winRow = _el('div', { style: 'display:flex;align-items:center;gap:4px;font-size:11px;' }, [
      _el('span', { style: 'color:var(--muted);' }, ['Win']), winValEl, winSlider,
    ]);

    for (const el2 of [this._notchBtn, this._deltaBtn, this._recenterBtn, this._artifactBtn, div(), winRow]) {
      el.appendChild(el2);
    }
    return el;
  }

  _buildBandBarsPanel() {
    this._bandBarEls = {};
    const barsEl = _el('div', { style: 'display:flex;flex-direction:column;gap:5px;' });
    BAND_NAMES.forEach(name => {
      const fill  = _el('div', { class: 'bar-fill', style: `background:${C.bands[name]};width:0%` });
      const track = _el('div', { class: 'bar-track' }, [fill]);
      const pct   = _el('span', { class: 'band-pct', style: `color:${C.bands[name]}` }, ['--']);
      const spark  = _el('canvas', { class: 'band-spark' });
      spark.width = 70; spark.height = 24;
      const sparkCtx = spark.getContext('2d');
      const nameEl = _el('span', { class: 'band-name', style: `color:${C.bands[name]}` }, [name]);
      const row = _el('div', { class: 'band-row' }, [nameEl, track, pct, spark]);
      barsEl.appendChild(row);
      this._bandBarEls[name] = { fill, pct, spark, sparkCtx };
    });
    return _el('div', { class: 'panel', id: 'dbgBandsPanel' }, [
      _el('div', { class: 'panel-title' }, ['Band Power']),
      barsEl,
    ]);
  }

  _buildSpectrogramPanel() {
    this._specCanvas = _el('canvas');
    this._specCanvas.width = 900; this._specCanvas.height = 260;
    this._specCtx = this._specCanvas.getContext('2d');
    return _el('div', { class: 'panel', id: 'dbgSpecPanel' }, [
      _el('div', { class: 'panel-title' }, ['Spectrogram']),
      this._specCanvas,
    ]);
  }

  _buildPSDPanel() {
    this._psdCanvas = _el('canvas');
    this._psdCanvas.width = 900; this._psdCanvas.height = 220;
    this._psdCtx = this._psdCanvas.getContext('2d');
    return _el('div', { class: 'panel', id: 'dbgPSDPanel' }, [
      _el('div', { class: 'panel-title' }, ['Power Spectral Density']),
      this._psdCanvas,
    ]);
  }

  _buildDiagPanel() {
    this._diagEls = {};
    const diagRows = [
      ['rms',      'RMS amplitude'],
      ['p2p',      'Peak-to-peak'],
      ['lowfreq',  'Low-freq artifact'],
      ['line',     'Line noise (60Hz)'],
      ['step',     'Step artifacts'],
      ['cmr',      'Common-mode corr.'],
      ['artifact', 'Eye/blink artifacts'],
    ].map(([key, label]) => {
      const valEl = _el('span', { class: 'diag-v' }, ['--']);
      this._diagEls[key] = valEl;
      return _el('div', { class: 'diag-row' }, [
        _el('span', { class: 'diag-k' }, [label]),
        valEl,
      ]);
    });

    const diagMetrics = _el('div', { id: 'dbgDiagMetrics', style: 'display:flex;flex-direction:column;gap:4px;' }, diagRows);

    const guideItems = [
      ['β', '#e05050', 'Jaw clench → Beta & Hi-Beta spike (EMG)'],
      ['δ', '#7777dd', 'Rapid blinks → Delta spike (eye artifact)'],
      ['α', '#f0cc44', 'Eyes closed → Alpha should rise >50%'],
      ['⚡', '#666',   'Tap electrode → Step in waveform'],
      ['θ', '#55bb88', 'Breathe slow & deep → Theta may rise'],
    ].map(([sym, color, text]) => _el('div', { class: 'guide-item' }, [
      _el('span', { class: 'guide-band', style: `color:${color}` }, [sym]),
      document.createTextNode(text),
    ]));

    const diagGuide = _el('div', { id: 'dbgDiagGuide', class: 'diag-guide' }, [
      _el('div', { class: 'guide-title' }, ['Diagnostic Tests']),
      ...guideItems,
    ]);

    return _el('div', { class: 'panel', style: 'display:flex;flex-direction:column;gap:10px;' }, [
      _el('div', { class: 'panel-title' }, ['Signal Diagnostics']),
      diagMetrics, diagGuide,
    ]);
  }

  // ── Canvas drawing ─────────────────────────────────────────────────────────

  _drawWaveform(view, recording) {
    const ctx = this._waveCtx, canvas = this._waveCanvas;
    fillCanvas(ctx, canvas);
    if (!view) return;
    const trace = view.selected_trace;
    const xMin = view.window_start_sec, xMax = view.window_end_sec;
    if (!trace?.t?.length) { drawGrid(ctx, canvas); return; }

    const [yMin, yMax] = autoBounds(trace.y);
    drawGrid(ctx, canvas, 8, 4);
    const zeroY = canvas.height - ((0 - yMin) / Math.max(1e-9, yMax - yMin)) * canvas.height;
    ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(canvas.width, zeroY); ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = C.wave; ctx.lineWidth = 1.5;
    ctx.beginPath();
    const W = canvas.width, H = canvas.height, span = xMax - xMin, yspan = yMax - yMin;
    trace.t.forEach((t, i) => {
      const px = ((t - xMin) / Math.max(1e-9, span)) * W;
      const py = H - ((trace.y[i] - yMin) / Math.max(1e-9, yspan)) * H;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
    drawAxisLabels(ctx, canvas, xMin, xMax, yMin, yMax, 'µV');
  }

  _drawPSD(view) {
    const ctx = this._psdCtx, canvas = this._psdCanvas;
    fillCanvas(ctx, canvas);
    if (!view) return;
    const psd = view.display_psd, rawPsd = view.raw_psd;
    if (!psd?.freqs?.length) { drawGrid(ctx, canvas); return; }

    const xMin = 2, xMax = 62;
    const W = canvas.width, H = canvas.height;
    const toX = f => ((f - xMin) / (xMax - xMin)) * W;

    const freqs  = psd.freqs.filter(f => f >= xMin && f <= xMax);
    const values = psd.values.filter((_, i) => psd.freqs[i] >= xMin && psd.freqs[i] <= xMax);
    const rawFreqs  = (rawPsd?.freqs  || []).filter(f => f >= xMin && f <= xMax);
    const rawValues = (rawPsd?.values || []).filter((_, i) => {
      const f = rawPsd.freqs[i] || 0; return f >= xMin && f <= xMax;
    });
    const yMax = Math.max(...values, ...rawValues, 1e-9);

    drawGrid(ctx, canvas, 8, 4);
    BAND_NAMES.forEach(name => {
      const [lo, hi] = BAND_RANGES[name];
      const x0 = toX(Math.max(lo, xMin)), x1 = toX(Math.min(hi, xMax));
      if (x1 <= x0) return;
      ctx.fillStyle = C.bands[name] + '1a';
      ctx.fillRect(x0, 0, x1 - x0, H);
    });
    BAND_NAMES.forEach(name => {
      const [lo, hi] = BAND_RANGES[name];
      const mid = toX((Math.max(lo, xMin) + Math.min(hi, xMax)) / 2);
      ctx.fillStyle = C.bands[name] + '99'; ctx.font = '18px ui-monospace';
      ctx.textAlign = 'center';
      ctx.fillText(name, mid, H - 6);
      ctx.textAlign = 'left';
    });
    if (rawFreqs.length) {
      ctx.strokeStyle = 'rgba(150,150,180,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      rawFreqs.forEach((f, i) => {
        const px = toX(f), py = H - (rawValues[i] / yMax) * H;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    ctx.strokeStyle = '#aaccff'; ctx.lineWidth = 1.8;
    ctx.beginPath();
    freqs.forEach((f, i) => {
      const px = toX(f), py = H - (values[i] / yMax) * H;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
    const x60 = toX(60);
    ctx.strokeStyle = this._notch60 ? 'rgba(100,200,100,0.4)' : 'rgba(220,80,80,0.5)';
    ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x60, 0); ctx.lineTo(x60, H - 18); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = this._notch60 ? 'rgba(100,200,100,0.7)' : 'rgba(220,80,80,0.8)';
    ctx.font = '18px ui-monospace'; ctx.textAlign = 'center';
    ctx.fillText('60', x60, H - 20); ctx.textAlign = 'left';
    ctx.fillStyle = C.muted; ctx.font = '20px ui-monospace';
    ctx.fillText('2 Hz', 4, H - 6); ctx.fillText('62 Hz', W - 52, H - 6);
  }

  _drawSpectrogram(view) {
    const ctx = this._specCtx, canvas = this._specCanvas;
    fillCanvas(ctx, canvas);
    const W = canvas.width, H = canvas.height;
    if (!view) return;
    const spec = view.spectrogram;
    if (!spec?.times?.length || !spec?.power?.length) { drawGrid(ctx, canvas); return; }

    const logVals = spec.power.flat().map(v => Math.log10(Math.max(1e-12, v)));
    logVals.sort((a, b) => a - b);
    const p3  = logVals[Math.floor(logVals.length * 0.03)];
    const p97 = logVals[Math.floor(logVals.length * 0.97)];
    if (!this._specBounds) {
      this._specBounds = { min: p3, max: p97 };
    } else {
      this._specBounds.min = this._specBounds.min * (1 - SPEC_EMA) + p3  * SPEC_EMA;
      this._specBounds.max = this._specBounds.max * (1 - SPEC_EMA) + p97 * SPEC_EMA;
    }
    const logMin = this._specBounds.min;
    const logSpan = Math.max(1e-9, this._specBounds.max - this._specBounds.min);

    const xMin = spec.times[0];
    const xMax = spec.times[spec.times.length - 1] || xMin + 1;
    const yMax = spec.freqs[spec.freqs.length - 1] || 30;

    for (let row = 0; row < spec.power.length; row++) {
      for (let col = 0; col < spec.times.length; col++) {
        const v = spec.power[row][col] || 1e-12;
        const t = Math.max(0, Math.min(1, (Math.log10(Math.max(1e-12, v)) - logMin) / logSpan));
        ctx.fillStyle = heatRGB(t);
        const x0 = ((spec.times[col] - xMin) / Math.max(1e-9, xMax - xMin)) * W;
        const x1 = (((spec.times[col + 1] ?? xMax) - xMin) / Math.max(1e-9, xMax - xMin)) * W;
        const y1 = H - ((spec.freqs[row] / yMax)) * H;
        const y0 = H - (((spec.freqs[row + 1] ?? yMax) / yMax)) * H;
        ctx.fillRect(x0, Math.min(y0, y1), Math.max(1, x1 - x0), Math.max(1, Math.abs(y0 - y1)));
      }
    }
    ctx.fillStyle = C.muted; ctx.font = '20px ui-monospace'; ctx.textAlign = 'right';
    [4, 8, 12, 20, 30].forEach(hz => {
      const py = H - (hz / yMax) * H;
      ctx.fillText(`${hz}Hz`, W - 4, py + 6);
      ctx.strokeStyle = C.muted + '44'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W - 50, py); ctx.stroke();
    });
    ctx.textAlign = 'left';
    drawAxisLabels(ctx, canvas, xMin, xMax, 0, yMax);
  }

  _updateBandBars(relPower) {
    if (!relPower) return;
    BAND_NAMES.forEach(name => {
      const val = relPower[name] ?? 0;
      this._trends[name].shift();
      this._trends[name].push(val);
      const { fill, pct, sparkCtx, spark } = this._bandBarEls[name];
      fill.style.width    = `${Math.min(100, val)}%`;
      pct.textContent     = `${val.toFixed(1)}%`;
      drawSparkline(sparkCtx, spark, this._trends[name], C.bands[name]);
    });
  }

  // ── Diagnostics ────────────────────────────────────────────────────────────

  _updateDiagnostics(metrics) {
    const m = metrics || {};
    this._setDiag('rms',    m.rms_uv != null ? `${m.rms_uv.toFixed(1)} µV` : '--',
      m.rms_uv == null ? '' : m.rms_uv < 4 ? 'poor' : m.rms_uv > 250 ? 'fair' : 'good');
    this._setDiag('p2p',    m.peak_to_peak_uv != null ? `${m.peak_to_peak_uv.toFixed(0)} µV` : '--', '');
    this._setDiag('lowfreq', m.low_freq_ratio != null ? this._ratioLabel(m.low_freq_ratio) : '--', this._ratioClass(m.low_freq_ratio));
    this._setDiag('line',   m.line_ratio != null ? this._ratioLabel(m.line_ratio) : '--', this._ratioClass(m.line_ratio));
    this._setDiag('step',   m.step_fraction != null ? this._stepLabel(m.step_fraction) : '--', this._stepClass(m.step_fraction));
    this._setDiag('cmr',    m.common_corr != null ? m.common_corr.toFixed(3) : '--', this._corrClass(m.common_corr));
    const af = m.artifact_fraction;
    const afLabel = af == null ? '--' : af < 0.05 ? 'clean' : af < 0.20 ? `low (${(af*100).toFixed(0)}%)` : `high (${(af*100).toFixed(0)}%)`;
    const afClass = af == null ? '' : af < 0.05 ? 'good' : af < 0.20 ? 'fair' : 'poor';
    this._setDiag('artifact', afLabel + (m.artifact_rejection ? ' [ON]' : ' [OFF]'), afClass);
  }
  _setDiag(key, text, cls) {
    const el = this._diagEls[key];
    if (!el) return;
    el.textContent = text;
    el.className = 'diag-v ' + (cls || '');
  }
  _ratioLabel(r)  { return r < 0.3 ? 'low' : r < 0.8 ? 'moderate' : `high (${r.toFixed(2)})`; }
  _ratioClass(r)  { if (r == null) return ''; return r < 0.3 ? 'good' : r < 0.8 ? 'fair' : 'poor'; }
  _stepLabel(s)   { return s < 0.005 ? 'none' : s < 0.02 ? 'minor' : `frequent (${(s*100).toFixed(1)}%)`; }
  _stepClass(s)   { if (s == null) return ''; return s < 0.005 ? 'good' : s < 0.02 ? 'fair' : 'poor'; }
  _corrClass(c)   { if (c == null) return ''; return c < 0.3 ? 'good' : c < 0.6 ? 'fair' : 'poor'; }

  // ── Recording ──────────────────────────────────────────────────────────────

  async _toggleRecording() {
    if (this._host.session.active) {
      await this._host.session.stop();
    } else {
      await this._host.session.start();
    }
  }
}

window.NFPrograms = window.NFPrograms || {};
window.NFPrograms.debug = DebugProgram;

})();
