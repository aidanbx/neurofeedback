'use strict';

// ── Alpha-Theta-Beta Feedback ─────────────────────────────────────────────────
// Three independent audio channels, each driven by a calibrated per-band clarity.
//   Alpha  — rewards alpha above its rolling threshold
//   Theta  — rewards theta above its rolling threshold
//   Beta   — rewards beta above its rolling threshold
// Uses the same rolling calibration + quality-gating architecture as the alpha
// feedback program. No inhibit logic — each band drives its channel independently.

(function () {

const BAND_COLORS = {
  Alpha: '#f0cc44',
  Theta: '#55bb88',
  Beta: '#e05050',
};
const GRAPH_BANDS = ['Alpha', 'Theta', 'Beta'];
const ALL_PSD_BANDS = ['Delta', 'Theta', 'Alpha', 'SMR', 'Beta', 'Hi-Beta'];
const BAND_RANGES = {
  Delta: [1, 4], Theta: [4, 8], Alpha: [8, 12], SMR: [12, 15], Beta: [15, 20], 'Hi-Beta': [20, 30],
};
const PSD_BAND_COLORS = {
  Delta: '#7777dd', Theta: '#55bb88', Alpha: '#f0cc44', SMR: '#f08030', Beta: '#e05050', 'Hi-Beta': '#cc55dd',
};

const DEFAULT_DSP_RANGE = 3.0;
const QUALITY_GATE = 55.0;
const ARTIFACT_GATE = 0.30;
const GRAPH_WINDOW_SEC = 120;
const OUTPUT_LOG_SEC = 1.0;
const DEFAULT_REALTIME_SEC = 8;
const DEFAULT_WINDOW_SEC = 8;

const C = {
  panel: '#13131e',
  grid: '#1e1e2c',
  muted: '#44445a',
  wave: '#4488ff',
};

function finiteOr(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function nfClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, finiteOr(v, lo))); }

function logAddExp(a, b) {
  a = finiteOr(a, -20);
  b = finiteOr(b, -20);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return hi + Math.log1p(Math.exp(lo - hi));
}

function _el(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el[k] = v;
  }
  for (const c of children) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

function _fmt(sec) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

function quantile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.min(s.length - 1, Math.floor((s.length - 1) * p)))];
}

function _avg(list, key) {
  if (!list.length) return 0;
  return list.reduce((sum, item) => sum + (item[key] ?? 0), 0) / list.length;
}

function fillCanvas(ctx, canvas) {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  ctx.fillStyle = C.panel;
  ctx.fillRect(0, 0, W, H);
}

function drawGrid(ctx, canvas, nx = 4, ny = 4) {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  for (let i = 1; i < nx; i++) {
    const x = (i / nx) * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let i = 1; i < ny; i++) {
    const y = (i / ny) * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
}

function drawAxisLabels(ctx, canvas, xMin, xMax, yMin, yMax, yUnit) {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  ctx.fillStyle = C.muted;
  ctx.font = '10px ui-monospace,monospace';
  ctx.fillText(`${xMin.toFixed(1)}s`, 6, H - 4);
  ctx.fillText(`${xMax.toFixed(1)}s`, W - 38, H - 4);
  if (yUnit) {
    ctx.fillText(`${yMax.toFixed(0)}${yUnit}`, 6, 12);
    ctx.fillText(`${yMin.toFixed(0)}`, 6, H - 14);
  }
}

function autoBounds(arr) {
  if (!arr.length) return [-200, 200];
  const lo = quantile(arr, 0.02);
  const hi = quantile(arr, 0.98);
  const span = Math.max(20, hi - lo);
  const mid = (lo + hi) / 2;
  return [mid - span * 0.65, mid + span * 0.65];
}

// ── Program ───────────────────────────────────────────────────────────────────

class AlphaThetaBetaProgram {
  constructor(host) {
    this._host = host;
    this._alphaScene = null;
    this._thetaScene = null;
    this._betaScene = null;
    this._tracks = [];

    // Per-channel volumes
    this._alphaMasterVolume = 0.7;
    this._alphaBaseVol = 0.18;
    this._alphaClearVol = 1.0;
    this._thetaMasterVolume = 0.7;
    this._thetaBaseVol = 0.18;
    this._thetaClearVol = 1.0;
    this._betaMasterVolume = 0.7;
    this._betaBaseVol = 0.18;
    this._betaClearVol = 1.0;

    // Track URLs
    this._alphaBaseUrl = ''; this._alphaClearUrl = '';
    this._thetaBaseUrl = ''; this._thetaClearUrl = '';
    this._betaBaseUrl = ''; this._betaClearUrl = '';

    // Feedback parameters
    this._responseTime = 1.2;
    this._alphaRewardTargetPct = 65;
    this._thetaRewardTargetPct = 65;
    this._betaRewardTargetPct = 65;
    this._clarityAtThreshold = 0.75;
    this._calibrationWindowSec = 180;
    this._realtimeWindowSec = DEFAULT_REALTIME_SEC;
    this._windowSec = DEFAULT_WINDOW_SEC;

    // Session state
    this._sessionActive = false;
    this._previewActive = false;
    this._lastElapsed = 0;
    this._lastLogElapsed = 0;
    this._fetchPending = false;
    this._notch60 = true;
    this._sceneLoadToken = 0;

    this._latestTF = {};
    this._latestMetrics = {};
    this._history = [];
    this._samples = [];
    this._bandHistory = [];
    this._calibration = { Alpha: [], Theta: [], Beta: [] };
    this._latestState = this._defaultState();

    this._buildDOM();
    this._loadAudioTracks();
    this._ensureBaselineMetricMode();
  }

  _defaultState() {
    return {
      mode: 'warm_start',
      alphaValue: 0, thetaValue: 0, betaValue: 0,
      alphaDisplayValue: 50, thetaDisplayValue: 50, betaDisplayValue: 50,
      alphaNorm: 50, thetaNorm: 50, betaNorm: 50,
      alphaThreshold: 100 - this._alphaRewardTargetPct,
      thetaThreshold: 100 - this._thetaRewardTargetPct,
      betaThreshold: 100 - this._betaRewardTargetPct,
      alphaClarity: 0, thetaClarity: 0, betaClarity: 0,
      alphaSamples: 0, thetaSamples: 0, betaSamples: 0,
    };
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────

  updateHost({ audioCtx, masterGain }) {
    this._host.audioCtx = audioCtx;
    this._host.masterGain = masterGain;
  }

  startSession() {
    this._sessionActive = true;
    this._history = []; this._samples = []; this._bandHistory = [];
    this._calibration = { Alpha: [], Theta: [], Beta: [] };
    this._latestState = this._defaultState();
    this._lastLogElapsed = 0;
    this._ensureBaselineMetricMode();

    const loadToken = ++this._sceneLoadToken;
    const applySceneDefaults = (s, i) => {
      if (!this._sessionActive || loadToken !== this._sceneLoadToken || !s) return;
      const vols = [
        [this._alphaMasterVolume, this._alphaBaseVol, this._alphaClearVol],
        [this._thetaMasterVolume, this._thetaBaseVol, this._thetaClearVol],
        [this._betaMasterVolume,  this._betaBaseVol,  this._betaClearVol],
      ];
      s.setVolume(vols[i][0]);
      s.setTrackVolumes(vols[i][1], vols[i][2]);
      s.play();
      this._applyAudioState(this._latestState);
    };
    this._loadScenes(applySceneDefaults).then(() => {
      if (!this._sessionActive || loadToken !== this._sceneLoadToken) return;
      this._applyAudioState(this._latestState);
    }).catch(err => {
      if (this._statusLine) this._statusLine.textContent = `Audio load blocked: ${err.message}`;
    });

    this._host.session.emit('session_start', { settings: this._sessionSettings() });
    this._syncStats();
    this._drawGraph(true);
    this._drawDetailGraph(true);
  }

  stopSession() {
    this._sessionActive = false;
    this._sceneLoadToken++;
    [this._alphaScene, this._thetaScene, this._betaScene].forEach(s => {
      if (s) { s.setCrossfade(0, 0.2); s.stop(); }
    });
    this._stopPreview();
    this._host.session.emit('session_stop', {});
    this._syncStats();
    this._drawGraph(true);
    this._drawDetailGraph(true);
    if (this._startBtn) {
      this._startBtn.textContent = 'Start Training';
      this._startBtn.className = 'btn-primary';
    }
  }

  destroy() {
    this.stopSession();
    [this._alphaScene, this._thetaScene, this._betaScene].forEach(s => s?.destroy());
    this._host.container.innerHTML = '';
  }

  async _toggleSession() {
    if (this._host.session.active) {
      await this._host.session.stop();
      if (this._startBtn) { this._startBtn.textContent = 'Start Training'; this._startBtn.className = 'btn-primary'; }
    } else {
      await this._host.session.start();
      if (this._startBtn) { this._startBtn.textContent = 'Stop Training'; this._startBtn.className = 'btn-record active'; }
    }
  }

  // ── onTick ─────────────────────────────────────────────────────────────────

  onTick(metrics, elapsed, appState) {
    this._lastElapsed = elapsed;
    this._latestTF = metrics.training_features ?? {};
    this._latestMetrics = metrics ?? {};

    if (!this._fetchPending) {
      this._fetchPending = true;
      const params = new URLSearchParams({ channel: appState?.channel ?? 0, window: 6, notch60: this._notch60 ? '1' : '0' });
      fetch(`/api/view?${params}`).then(r => r.json()).then(view => {
        this._fetchPending = false;
        this._drawPSD(view);
        this._drawWaveform(view);
      }).catch(() => { this._fetchPending = false; });
    }

    if (!this._sessionActive) {
      this._updateStatus(false);
      return;
    }

    this._ingestCalibrationSample(elapsed);
    this._latestState = this._computeFeedbackState();
    this._applyAudioState(this._latestState);
    this._history.push({ elapsed, ...this._latestState });
    while (this._history.length > 1 && this._history[0].elapsed < elapsed - GRAPH_WINDOW_SEC) this._history.shift();

    this._samples.push({
      elapsed,
      Alpha: this._latestState.alphaValue,
      Theta: this._latestState.thetaValue,
      Beta: this._latestState.betaValue,
    });
    while (this._samples.length > 1 && this._samples[0].elapsed < elapsed - Math.max(this._realtimeWindowSec, this._windowSec, GRAPH_WINDOW_SEC)) this._samples.shift();

    if (!this._bandHistory.length || elapsed - this._bandHistory.at(-1).elapsed >= this._windowSec) {
      this._bandHistory.push({ elapsed, ...this._computeWindowAverageForSec(this._windowSec) });
      while (this._bandHistory.length > 1 && this._bandHistory[0].elapsed < elapsed - GRAPH_WINDOW_SEC) this._bandHistory.shift();
    }

    if ((elapsed - this._lastLogElapsed) >= OUTPUT_LOG_SEC) {
      this._lastLogElapsed = elapsed;
      this._logOutput(elapsed, this._latestState);
    }

    this._updateStatus(true);
    this._syncStats();
    this._drawGraph();
    this._drawDetailGraph();
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────

  _buildDOM() {
    const c = this._host.container;
    c.innerHTML = '';

    const canvas = _el('canvas', { style: 'display:block;width:100%;height:280px;flex:none;' });
    const detailCanvas = _el('canvas', { style: 'display:block;width:100%;height:320px;flex:none;' });
    const psdCanvas = _el('canvas', { style: 'flex:1;min-width:0;height:100%;display:block;' });
    const waveCanvas = _el('canvas', { style: 'flex:1;min-width:0;height:100%;display:block;' });
    const head = _el('div', { class: 'nf-viz-head' }, [
      _el('div', { class: 'nf-viz-title' }, ['Alpha · Theta · Beta']),
    ]);
    const debugRow = _el('div', { style: 'display:flex;gap:4px;height:110px;flex:none;padding:0 2px 2px;' }, [
      _el('div', { style: 'flex:1;min-width:0;position:relative;' }, [psdCanvas,
        _el('span', { style: 'position:absolute;top:2px;left:4px;font-size:9px;color:#44445a;pointer-events:none' }, ['PSD  2–62 Hz']),
      ]),
      _el('div', { style: 'flex:1;min-width:0;position:relative;' }, [waveCanvas,
        _el('span', { style: 'position:absolute;top:2px;left:4px;font-size:9px;color:#44445a;pointer-events:none' }, ['EEG waveform']),
      ]),
    ]);
    const detailWrap = _el('div', { style: 'display:flex;flex-direction:column;gap:8px;padding:8px 2px 2px;' }, [
      _el('div', { style: 'font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;padding:0 2px;' }, ['Band Metric Diagnostics']),
      detailCanvas,
      debugRow,
    ]);
    const trainMain = _el('div', {
      class: 'program-main',
      style: 'position:relative;display:flex;flex-direction:column;overflow-y:auto;',
    }, [canvas, head, detailWrap]);

    const mkSlider = (label, min, max, step, value, onInput, fmt = v => String(v)) => {
      const valEl = _el('span', { class: 'nf-control-value' }, [fmt(value)]);
      const slider = _el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
      slider.addEventListener('input', () => {
        const n = Number(slider.value);
        valEl.textContent = fmt(n);
        onInput(n);
      });
      return _el('div', { class: 'nf-control' }, [
        _el('div', { class: 'nf-control-head' }, [_el('span', {}, [label]), valEl]),
        slider,
      ]);
    };

    const mkSel = () => _el('select', { class: 'nf-scene-select' });

    // Per-channel track selects
    this._alphaBaseTrackSel = mkSel(); this._alphaClearTrackSel = mkSel();
    this._thetaBaseTrackSel = mkSel(); this._thetaClearTrackSel = mkSel();
    this._betaBaseTrackSel = mkSel();  this._betaClearTrackSel = mkSel();

    const mkAudioSec = (label, baseSel, clearSel, masterInit, baseVolInit, clearVolInit, masterCb, baseVolCb, clearVolCb) =>
      _el('div', { class: 'nf-section' }, [
        _el('div', { class: 'nf-section-title' }, [label]),
        _el('div', { class: 'nf-control' }, [_el('div', { class: 'nf-control-head' }, [_el('span', {}, ['Base track'])]), baseSel]),
        _el('div', { class: 'nf-control' }, [_el('div', { class: 'nf-control-head' }, [_el('span', {}, ['Clear track'])]), clearSel]),
        mkSlider('Base vol', 0, 100, 1, Math.round(baseVolInit * 100), v => { baseVolCb(v / 100); this._emitSetting(label.toLowerCase() + '_base_vol', v / 100); }, v => `${v}%`),
        mkSlider('Clear vol', 0, 100, 1, Math.round(clearVolInit * 100), v => { clearVolCb(v / 100); this._emitSetting(label.toLowerCase() + '_clear_vol', v / 100); }, v => `${v}%`),
        mkSlider('Master vol', 0, 100, 1, Math.round(masterInit * 100), v => { masterCb(v / 100); this._emitSetting(label.toLowerCase() + '_master_vol', v / 100); }, v => `${v}%`),
      ]);

    const alphaSec = mkAudioSec('Alpha',
      this._alphaBaseTrackSel, this._alphaClearTrackSel,
      this._alphaMasterVolume, this._alphaBaseVol, this._alphaClearVol,
      v => { this._alphaMasterVolume = v; if (this._alphaScene) this._alphaScene.setVolume(v); },
      v => { this._alphaBaseVol = v; this._applyAudioState(this._latestState); },
      v => { this._alphaClearVol = v; this._applyAudioState(this._latestState); });

    const thetaSec = mkAudioSec('Theta',
      this._thetaBaseTrackSel, this._thetaClearTrackSel,
      this._thetaMasterVolume, this._thetaBaseVol, this._thetaClearVol,
      v => { this._thetaMasterVolume = v; if (this._thetaScene) this._thetaScene.setVolume(v); },
      v => { this._thetaBaseVol = v; this._applyAudioState(this._latestState); },
      v => { this._thetaClearVol = v; this._applyAudioState(this._latestState); });

    const betaAudioSec = mkAudioSec('Beta',
      this._betaBaseTrackSel, this._betaClearTrackSel,
      this._betaMasterVolume, this._betaBaseVol, this._betaClearVol,
      v => { this._betaMasterVolume = v; if (this._betaScene) this._betaScene.setVolume(v); },
      v => { this._betaBaseVol = v; this._applyAudioState(this._latestState); },
      v => { this._betaClearVol = v; this._applyAudioState(this._latestState); });

    const threshSec = _el('div', { class: 'nf-section' }, [
      _el('div', { class: 'nf-section-title' }, ['Thresholds']),
      mkSlider('Alpha reward rate', 40, 85, 1, this._alphaRewardTargetPct, v => {
        this._alphaRewardTargetPct = v; this._emitSetting('alpha_reward_target_pct', v); this._refreshDerivedState();
      }, v => `${v}%`),
      mkSlider('Theta reward rate', 40, 85, 1, this._thetaRewardTargetPct, v => {
        this._thetaRewardTargetPct = v; this._emitSetting('theta_reward_target_pct', v); this._refreshDerivedState();
      }, v => `${v}%`),
      mkSlider('Beta reward rate', 40, 85, 1, this._betaRewardTargetPct, v => {
        this._betaRewardTargetPct = v; this._emitSetting('beta_reward_target_pct', v); this._refreshDerivedState();
      }, v => `${v}%`),
      mkSlider('Clarity at threshold', 10, 100, 1, Math.round(this._clarityAtThreshold * 100), v => {
        this._clarityAtThreshold = v / 100; this._emitSetting('clarity_at_threshold_pct', v); this._refreshDerivedState();
      }, v => `${v}%`),
    ]);

    const settingsSec = _el('div', { class: 'nf-section' }, [
      _el('div', { class: 'nf-section-title' }, ['Settings']),
      mkSlider('Response speed', 2, 40, 1, Math.round(this._responseTime * 10), v => {
        this._responseTime = v / 10; this._applyAudioState(this._latestState); this._emitSetting('response_time', this._responseTime);
      }, v => `${(v / 10).toFixed(1)} s`),
      mkSlider('Rolling baseline', 30, 600, 10, this._calibrationWindowSec, v => {
        this._calibrationWindowSec = v; this._pruneCalibration(this._lastElapsed); this._emitSetting('calibration_window_sec', v); this._refreshDerivedState();
      }, v => `${v}s`),
      mkSlider('Live window', 2, 30, 1, this._realtimeWindowSec, v => {
        this._realtimeWindowSec = v; this._drawDetailGraph(); this._emitSetting('realtime_window_sec', v);
      }, v => `${v}s`),
      mkSlider('Bar window', 2, 30, 1, this._windowSec, v => {
        this._windowSec = v; this._bandHistory = []; this._drawDetailGraph(true); this._emitSetting('window_sec', v);
      }, v => `${v}s`),
    ]);

    const mkStat = label => {
      const v = _el('div', { class: 'nf-stat-v' }, ['-']);
      return { card: _el('div', { class: 'nf-stat' }, [_el('div', { class: 'nf-stat-k' }, [label]), v]), v };
    };
    const timeStat = mkStat('Session Time');
    const modeStat = mkStat('Mode');
    const alphaStat = mkStat('Alpha');
    const thetaStat = mkStat('Theta');
    const betaStat = mkStat('Beta+hβ');
    const alphaClarityStat = mkStat('α Clarity');
    const thetaClarityStat = mkStat('θ Clarity');
    const betaClarityStat = mkStat('β Clarity');
    const samplesStat = mkStat('Samples');
    this._stats = { timeStat, modeStat, alphaStat, thetaStat, betaStat, alphaClarityStat, thetaClarityStat, betaClarityStat, samplesStat };

    const statsSec = _el('div', { class: 'nf-section' }, [
      _el('div', { class: 'nf-section-title' }, ['Session']),
      _el('div', { class: 'nf-stats-grid nf-stats-grid-wide' }, [
        timeStat.card, modeStat.card, alphaStat.card, thetaStat.card,
        betaStat.card, alphaClarityStat.card, thetaClarityStat.card, betaClarityStat.card,
        samplesStat.card,
      ]),
    ]);

    this._statusLine = _el('div', { style: 'font-size:10px;color:var(--muted);margin-top:6px;line-height:1.4' }, ['warming up']);
    const previewBtn = _el('button', { class: 'btn-toggle' }, ['Preview']);
    const previewStatus = _el('span', { style: 'font-size:10px;color:var(--muted)' }, ['']);
    const startBtn = _el('button', { class: 'btn-primary', style: 'width:100%;margin-top:4px' }, ['Start Training']);
    const lifecycleSec = _el('div', { class: 'nf-section' }, [
      this._statusLine,
      _el('div', { style: 'display:flex;align-items:center;gap:6px;margin:10px 0 8px' }, [previewBtn, previewStatus]),
      startBtn,
    ]);

    previewBtn.addEventListener('click', () => this._previewActive ? this._stopPreview() : this._startPreview());
    startBtn.addEventListener('click', () => this._toggleSession());
    this._previewBtn = previewBtn;
    this._previewStatus = previewStatus;
    this._startBtn = startBtn;

    for (const [which, sel] of [
      ['alphaBase', this._alphaBaseTrackSel], ['alphaClear', this._alphaClearTrackSel],
      ['thetaBase', this._thetaBaseTrackSel], ['thetaClear', this._thetaClearTrackSel],
      ['betaBase',  this._betaBaseTrackSel],  ['betaClear',  this._betaClearTrackSel],
    ]) {
      sel.addEventListener('change', () => this._onTrackChanged(which));
    }

    const sidebar = _el('div', { class: 'program-sidebar' }, [alphaSec, thetaSec, betaAudioSec, threshSec, settingsSec, statsSec, lifecycleSec]);
    c.appendChild(_el('div', { class: 'program-body' }, [trainMain, sidebar]));

    this._canvas = canvas;
    this._detailCanvas = detailCanvas;
    this._psdCanvas = psdCanvas;
    this._waveCanvas = waveCanvas;
    this._psdCtx = null;
    this._waveCtx = null;

    this._drawGraph(true);
    this._drawDetailGraph(true);
  }

  // ── Audio tracks ───────────────────────────────────────────────────────────

  async _loadAudioTracks() {
    try {
      const r = await fetch('/api/audio-tracks');
      this._tracks = await r.json();
    } catch {
      this._tracks = [];
    }
    this._populateTrackSelects();
  }

  _populateTrackSelects() {
    const sels = [
      this._alphaBaseTrackSel, this._alphaClearTrackSel,
      this._thetaBaseTrackSel, this._thetaClearTrackSel,
      this._betaBaseTrackSel,  this._betaClearTrackSel,
    ];
    sels.forEach(sel => {
      sel.innerHTML = '';
      sel.appendChild(_el('option', { value: 'silence' }, ['- Silence -']));
    });
    this._tracks.forEach(t => {
      const lbl = `${t.name}${t.category ? ` (${t.category})` : ''}`;
      sels.forEach(sel => sel.appendChild(_el('option', { value: t.url }, [lbl])));
    });
    const pick = pred => this._tracks.find(pred)?.url || '';
    const brown = pick(t => /brown|noise/i.test(t.name)) || this._tracks[0]?.url || 'silence';
    const creek = pick(t => /creek|forest|rain/i.test(t.name)) || this._tracks.find(t => t.url !== brown)?.url || brown;
    const alphaWave = pick(t => /alpha/i.test(t.name)) || creek;
    const cello = pick(t => /cello|suite|classical/i.test(t.name)) || creek;

    this._alphaBaseUrl = brown; this._alphaClearUrl = creek;
    this._thetaBaseUrl = brown; this._thetaClearUrl = alphaWave;
    this._betaBaseUrl  = brown; this._betaClearUrl  = cello;

    this._alphaBaseTrackSel.value = this._alphaBaseUrl;  this._alphaClearTrackSel.value = this._alphaClearUrl;
    this._thetaBaseTrackSel.value = this._thetaBaseUrl;  this._thetaClearTrackSel.value = this._thetaClearUrl;
    this._betaBaseTrackSel.value  = this._betaBaseUrl;   this._betaClearTrackSel.value  = this._betaClearUrl;
  }

  _trackName(url) {
    return this._tracks.find(t => t.url === url)?.name || (url === 'silence' ? 'Silence' : '');
  }

  _onTrackChanged(which) {
    const urlMap = {
      alphaBase: '_alphaBaseUrl', alphaClear: '_alphaClearUrl',
      thetaBase: '_thetaBaseUrl', thetaClear: '_thetaClearUrl',
      betaBase:  '_betaBaseUrl',  betaClear:  '_betaClearUrl',
    };
    const selMap = {
      alphaBase: '_alphaBaseTrackSel', alphaClear: '_alphaClearTrackSel',
      thetaBase: '_thetaBaseTrackSel', thetaClear: '_thetaClearTrackSel',
      betaBase:  '_betaBaseTrackSel',  betaClear:  '_betaClearTrackSel',
    };
    this[urlMap[which]] = this[selMap[which]].value;
    this._emitSetting(which + '_track', this._trackName(this[urlMap[which]]));
    if (this._sessionActive || this._previewActive) {
      const loadToken = ++this._sceneLoadToken;
      this._loadScenes().then(() => {
        if (loadToken !== this._sceneLoadToken) return;
        [this._alphaScene, this._thetaScene, this._betaScene].forEach(s => s?.play());
        this._applyAudioState(this._latestState);
      }).catch(err => {
        if (this._statusLine) this._statusLine.textContent = `Audio load blocked: ${err.message}`;
      });
    }
  }

  // ── Audio scenes ───────────────────────────────────────────────────────────

  _ensureAudio() {
    if (!this._host.audioCtx) {
      this._host.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this._host.masterGain = this._host.audioCtx.createGain();
      this._host.masterGain.gain.value = 1.0;
      this._host.masterGain.connect(this._host.audioCtx.destination);
    }
    if (!this._alphaScene) this._alphaScene = new NFAudioScene(this._host.audioCtx, this._host.masterGain);
    if (!this._thetaScene) this._thetaScene = new NFAudioScene(this._host.audioCtx, this._host.masterGain);
    if (!this._betaScene)  this._betaScene  = new NFAudioScene(this._host.audioCtx, this._host.masterGain);
  }

  async _loadScenes(onSceneReady = null) {
    this._ensureAudio();
    const scenes = [
      [this._alphaScene, this._alphaBaseUrl, this._alphaClearUrl],
      [this._thetaScene, this._thetaBaseUrl, this._thetaClearUrl],
      [this._betaScene,  this._betaBaseUrl,  this._betaClearUrl],
    ];
    for (let i = 0; i < scenes.length; i++) {
      const [scene, baseUrl, clearUrl] = scenes[i];
      await scene.load(baseUrl, clearUrl);
      if (onSceneReady) onSceneReady(scene, i);
    }
  }

  _startPreview() {
    const loadToken = ++this._sceneLoadToken;
    this._loadScenes().then(() => {
      if (loadToken !== this._sceneLoadToken) return;
      this._previewActive = true;
      [
        [this._alphaScene, this._alphaMasterVolume],
        [this._thetaScene, this._thetaMasterVolume],
        [this._betaScene,  this._betaMasterVolume],
      ].forEach(([s, vol]) => {
        if (!s) return;
        s.setVolume(vol); s.play(); s.setCrossfade(0.55, 0.5);
      });
      this._previewBtn.textContent = 'Stop';
      this._previewStatus.textContent = 'playing';
      this._previewStatus.style.color = 'var(--good)';
    }).catch(err => {
      this._previewStatus.textContent = `blocked: ${err.message}`;
      this._previewStatus.style.color = 'var(--poor)';
    });
  }

  _stopPreview() {
    this._previewActive = false;
    this._sceneLoadToken++;
    if (!this._sessionActive) {
      [this._alphaScene, this._thetaScene, this._betaScene].forEach(s => {
        if (s) { s.setCrossfade(0, 0.2); s.stop(); }
      });
    }
    if (this._previewBtn) this._previewBtn.textContent = 'Preview';
    if (this._previewStatus) this._previewStatus.textContent = '';
  }

  // ── DSP / Calibration ──────────────────────────────────────────────────────

  _ensureBaselineMetricMode() {
    fetch('/api/training/params', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric_mode: 'baseline_delta' }),
    }).catch(() => {});
  }

  _normalizeDelta(v) {
    const r = DEFAULT_DSP_RANGE;
    return nfClamp((finiteOr(v) + r) / (2 * r) * 100, 0, 100);
  }

  _combinedBetaValue(source = 'smoothed') {
    const beta = this._latestTF.Beta ?? {};
    const hi = this._latestTF['Hi-Beta'] ?? {};
    if (source === 'absolute') return (beta.absolute ?? 0) + (hi.absolute ?? 0);
    if (source === 'log_absolute') return Math.log(Math.max(this._combinedBetaValue('absolute'), 1e-12));
    if (source === 'baseline_delta') return logAddExp(beta.baseline_delta ?? -20, hi.baseline_delta ?? -20);
    return logAddExp(beta.smoothed ?? -20, hi.smoothed ?? -20);
  }

  _sampleCounts() {
    return {
      alpha: this._calibration.Alpha.length,
      theta: this._calibration.Theta.length,
      beta:  this._calibration.Beta.length,
    };
  }

  _minCalibrationSamples() {
    return Math.max(20, Math.round(Math.min(this._calibrationWindowSec, 30) / 0.5));
  }

  _ingestCalibrationSample(elapsed) {
    const tf = this._latestTF;
    const quality = Number(this._latestMetrics.quality_score ?? 0);
    const artifact = Number(this._latestMetrics.artifact_fraction ?? 1);
    if (!tf.Alpha?.baseline_ready || !tf.Theta?.baseline_ready || !tf.Beta?.baseline_ready || !tf['Hi-Beta']?.baseline_ready) return;
    if (quality < QUALITY_GATE || artifact >= ARTIFACT_GATE) return;
    this._calibration.Alpha.push({ elapsed, value: finiteOr(tf.Alpha.smoothed) });
    this._calibration.Theta.push({ elapsed, value: finiteOr(tf.Theta.smoothed) });
    this._calibration.Beta.push({ elapsed, value: finiteOr(this._combinedBetaValue('smoothed')) });
    this._pruneCalibration(elapsed);
  }

  _pruneCalibration(elapsed) {
    Object.values(this._calibration).forEach(list => {
      while (list.length > 1 && list[0].elapsed < elapsed - this._calibrationWindowSec) list.shift();
    });
  }

  _thresholdFromTarget(values, targetPct) {
    const finiteValues = values.map(v => finiteOr(v, NaN)).filter(Number.isFinite);
    if (!finiteValues.length) return 0;
    return quantile(finiteValues, 1 - targetPct / 100);
  }

  _clarityFromRange(value, threshold, low, high) {
    value = finiteOr(value);
    threshold = finiteOr(threshold);
    low = finiteOr(low);
    high = finiteOr(high, threshold);
    const thresholdClarity = nfClamp(this._clarityAtThreshold, 0.05, 0.95);
    if (value <= threshold) {
      const span = Math.max(1e-6, threshold - low);
      return thresholdClarity * nfClamp((value - low) / span, 0, 1);
    }
    const span = Math.max(1e-6, high - threshold);
    return thresholdClarity + (1 - thresholdClarity) * nfClamp((value - threshold) / span, 0, 1);
  }

  _computeFeedbackState() {
    const alphaValue = finiteOr(this._latestTF.Alpha?.smoothed);
    const thetaValue = finiteOr(this._latestTF.Theta?.smoothed);
    const betaValue = finiteOr(this._combinedBetaValue('smoothed'));
    const alphaNorm = this._normalizeDelta(alphaValue);
    const thetaNorm = this._normalizeDelta(thetaValue);
    const betaNorm = this._normalizeDelta(betaValue);
    const counts = this._sampleCounts();
    const enough = counts.alpha >= this._minCalibrationSamples()
                && counts.theta >= this._minCalibrationSamples()
                && counts.beta  >= this._minCalibrationSamples();

    if (!enough) {
      const alphaThreshold = 100 - this._alphaRewardTargetPct;
      const thetaThreshold = 100 - this._thetaRewardTargetPct;
      const betaThreshold  = 100 - this._betaRewardTargetPct;
      const alphaClarity = this._clarityFromRange(alphaNorm, alphaThreshold, 0, 100);
      const thetaClarity = this._clarityFromRange(thetaNorm, thetaThreshold, 0, 100);
      const betaClarity  = this._clarityFromRange(betaNorm,  betaThreshold,  0, 100);
      return {
        mode: 'warm_start',
        alphaValue, thetaValue, betaValue,
        alphaDisplayValue: alphaNorm, thetaDisplayValue: thetaNorm, betaDisplayValue: betaNorm,
        alphaNorm, thetaNorm, betaNorm,
        alphaThreshold, thetaThreshold, betaThreshold,
        alphaClarity, thetaClarity, betaClarity,
        alphaSamples: counts.alpha, thetaSamples: counts.theta, betaSamples: counts.beta,
      };
    }

    const alphaVals = this._calibration.Alpha.map(x => x.value);
    const thetaVals = this._calibration.Theta.map(x => x.value);
    const betaVals  = this._calibration.Beta.map(x => x.value);

    const alphaThreshold = this._thresholdFromTarget(alphaVals, this._alphaRewardTargetPct);
    const thetaThreshold = this._thresholdFromTarget(thetaVals, this._thetaRewardTargetPct);
    const betaThreshold  = this._thresholdFromTarget(betaVals,  this._betaRewardTargetPct);

    const alphaLow  = quantile(alphaVals, 0.1); const alphaHigh = quantile(alphaVals, 0.9);
    const thetaLow  = quantile(thetaVals, 0.1); const thetaHigh = quantile(thetaVals, 0.9);
    const betaLow   = quantile(betaVals,  0.1); const betaHigh  = quantile(betaVals,  0.9);

    const alphaClarity = this._clarityFromRange(alphaValue, alphaThreshold, alphaLow, alphaHigh);
    const thetaClarity = this._clarityFromRange(thetaValue, thetaThreshold, thetaLow, thetaHigh);
    const betaClarity  = this._clarityFromRange(betaValue,  betaThreshold,  betaLow,  betaHigh);

    return {
      mode: 'rolling',
      alphaValue, thetaValue, betaValue,
      alphaDisplayValue: alphaValue, thetaDisplayValue: thetaValue, betaDisplayValue: betaValue,
      alphaNorm, thetaNorm, betaNorm,
      alphaThreshold, thetaThreshold, betaThreshold,
      alphaClarity, thetaClarity, betaClarity,
      alphaSamples: counts.alpha, thetaSamples: counts.theta, betaSamples: counts.beta,
    };
  }

  _applyAudioState(state) {
    if (this._alphaScene) {
      this._alphaScene.setVolume(this._alphaMasterVolume);
      this._alphaScene.setTrackVolumes(this._alphaBaseVol, this._alphaClearVol);
      this._alphaScene.setCrossfade(nfClamp(finiteOr(state.alphaClarity), 0, 1), this._responseTime);
    }
    if (this._thetaScene) {
      this._thetaScene.setVolume(this._thetaMasterVolume);
      this._thetaScene.setTrackVolumes(this._thetaBaseVol, this._thetaClearVol);
      this._thetaScene.setCrossfade(nfClamp(finiteOr(state.thetaClarity), 0, 1), this._responseTime);
    }
    if (this._betaScene) {
      this._betaScene.setVolume(this._betaMasterVolume);
      this._betaScene.setTrackVolumes(this._betaBaseVol, this._betaClearVol);
      this._betaScene.setCrossfade(nfClamp(finiteOr(state.betaClarity), 0, 1), this._responseTime);
    }
  }

  _computeWindowAverageForSec(sec) {
    if (!this._samples.length) return { Alpha: 0, Theta: 0, Beta: 0 };
    const latest = this._samples.at(-1)?.elapsed ?? 0;
    const ws = this._samples.filter(s => s.elapsed >= latest - sec);
    if (!ws.length) return { Alpha: 0, Theta: 0, Beta: 0 };
    return {
      Alpha: _avg(ws, 'Alpha'),
      Theta: _avg(ws, 'Theta'),
      Beta:  _avg(ws, 'Beta'),
    };
  }

  _refreshDerivedState() {
    this._latestState = this._computeFeedbackState();
    this._applyAudioState(this._latestState);
    this._syncStats();
    this._drawGraph();
    this._drawDetailGraph();
    this._updateStatus(this._sessionActive);
  }

  // ── Session helpers ────────────────────────────────────────────────────────

  _sessionSettings() {
    return {
      alpha_reward_target_pct: this._alphaRewardTargetPct,
      theta_reward_target_pct: this._thetaRewardTargetPct,
      beta_reward_target_pct:  this._betaRewardTargetPct,
      clarity_at_threshold_pct: Math.round(this._clarityAtThreshold * 100),
      calibration_window_sec: this._calibrationWindowSec,
      response_time: this._responseTime,
      realtime_window_sec: this._realtimeWindowSec,
      window_sec: this._windowSec,
      alpha_master_vol: this._alphaMasterVolume,
      theta_master_vol: this._thetaMasterVolume,
      beta_master_vol:  this._betaMasterVolume,
      alpha_base_track:  this._trackName(this._alphaBaseUrl),
      alpha_clear_track: this._trackName(this._alphaClearUrl),
      theta_base_track:  this._trackName(this._thetaBaseUrl),
      theta_clear_track: this._trackName(this._thetaClearUrl),
      beta_base_track:   this._trackName(this._betaBaseUrl),
      beta_clear_track:  this._trackName(this._betaClearUrl),
      metric_mode: 'baseline_delta',
    };
  }

  _emitSetting(key, value) {
    this._host.session.emit('setting_change', { key, value });
  }

  _logOutput(elapsed, state) {
    this._host.session.logOutput({
      elapsed: +elapsed.toFixed(3),
      metric_mode: 'baseline_delta',
      calibration_mode: state.mode,
      alpha_reward_target_pct: this._alphaRewardTargetPct,
      theta_reward_target_pct: this._thetaRewardTargetPct,
      beta_reward_target_pct:  this._betaRewardTargetPct,
      calibration_window_sec: this._calibrationWindowSec,
      alpha_value: +state.alphaValue.toFixed(4),
      theta_value: +state.thetaValue.toFixed(4),
      beta_value:  +state.betaValue.toFixed(4),
      alpha_threshold: +state.alphaThreshold.toFixed(4),
      theta_threshold: +state.thetaThreshold.toFixed(4),
      beta_threshold:  +state.betaThreshold.toFixed(4),
      alpha_norm_pct: +state.alphaNorm.toFixed(2),
      theta_norm_pct: +state.thetaNorm.toFixed(2),
      beta_norm_pct:  +state.betaNorm.toFixed(2),
      alpha_clarity: +state.alphaClarity.toFixed(4),
      theta_clarity: +state.thetaClarity.toFixed(4),
      beta_clarity:  +state.betaClarity.toFixed(4),
      alpha_samples: state.alphaSamples,
      theta_samples: state.thetaSamples,
      beta_samples:  state.betaSamples,
      alpha_base_track:  this._trackName(this._alphaBaseUrl),
      alpha_clear_track: this._trackName(this._alphaClearUrl),
      theta_base_track:  this._trackName(this._thetaBaseUrl),
      theta_clear_track: this._trackName(this._thetaClearUrl),
      beta_base_track:   this._trackName(this._betaBaseUrl),
      beta_clear_track:  this._trackName(this._betaClearUrl),
    });
  }

  _updateStatus(active) {
    if (!this._statusLine) return;
    const s = this._latestState;
    const counts = this._sampleCounts();
    if (!active) {
      this._statusLine.textContent = 'Ready. Three independent channels: alpha, theta, and beta each drive their own audio crossfade.';
      return;
    }
    if (s.mode === 'warm_start') {
      this._statusLine.textContent = `Warm start. Building rolling baseline from clean samples — alpha ${counts.alpha}, theta ${counts.theta}, beta ${counts.beta}.`;
    } else {
      this._statusLine.textContent = `Rolling mode. α thresh ${s.alphaThreshold.toFixed(2)}, θ thresh ${s.thetaThreshold.toFixed(2)}, β thresh ${s.betaThreshold.toFixed(2)}.`;
    }
  }

  _syncStats() {
    const s = this._latestState;
    this._stats.timeStat.v.textContent = _fmt(this._lastElapsed);
    this._stats.modeStat.v.textContent = s.mode === 'rolling' ? 'rolling' : 'warm';
    this._stats.alphaStat.v.textContent = `${s.alphaDisplayValue.toFixed(2)} / ${s.alphaThreshold.toFixed(2)}`;
    this._stats.thetaStat.v.textContent = `${s.thetaDisplayValue.toFixed(2)} / ${s.thetaThreshold.toFixed(2)}`;
    this._stats.betaStat.v.textContent  = `${s.betaDisplayValue.toFixed(2)} / ${s.betaThreshold.toFixed(2)}`;
    this._stats.alphaClarityStat.v.textContent = `${Math.round((s.alphaClarity ?? 0) * 100)}%`;
    this._stats.thetaClarityStat.v.textContent = `${Math.round((s.thetaClarity ?? 0) * 100)}%`;
    this._stats.betaClarityStat.v.textContent  = `${Math.round((s.betaClarity  ?? 0) * 100)}%`;
    this._stats.samplesStat.v.textContent = `${s.alphaSamples}`;
  }

  // ── Main graph (120s history) ──────────────────────────────────────────────

  _drawGraph(idle = false) {
    const canvas = this._canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 900;
    const H = canvas.clientHeight || 280;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, W, H);

    const PAD = { top: 42, right: 20, bottom: 34, left: 58 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const hist = this._history;
    const latest = hist.at(-1)?.elapsed ?? this._lastElapsed;
    const xMin = Math.max(0, latest - GRAPH_WINDOW_SEC);
    const xMax = Math.max(xMin + 10, latest);
    const tx = t => PAD.left + ((t - xMin) / Math.max(1e-6, xMax - xMin)) * plotW;

    const vals = [];
    hist.forEach(pt => vals.push(
      pt.alphaDisplayValue, pt.thetaDisplayValue, pt.betaDisplayValue,
      pt.alphaThreshold, pt.thetaThreshold, pt.betaThreshold
    ));
    if (!vals.length) vals.push(-1, 1);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = Math.max(1.5, hi - lo);
    const yMin = lo - span * 0.15;
    const yMax = hi + span * 0.15;
    const ty = v => PAD.top + plotH - ((v - yMin) / Math.max(1e-6, yMax - yMin)) * plotH;

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '11px ui-monospace,monospace';
    ctx.fillText('Live baseline-adjusted features and rolling thresholds', PAD.left, 20);

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (plotH * i) / 4;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
      const v = yMax - ((y - PAD.top) / plotH) * (yMax - yMin);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '10px ui-monospace,monospace';
      ctx.textAlign = 'right';
      ctx.fillText(v.toFixed(1), PAD.left - 6, y + 3);
    }

    if (!hist.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.font = '13px ui-monospace,monospace';
      ctx.textAlign = 'center';
      ctx.fillText(idle ? 'Start training to see three-band clarity feedback.' : 'Waiting for signal...', W / 2, H / 2);
      return;
    }

    const drawSeries = (valueKey, threshKey, label, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      hist.forEach((pt, i) => {
        const x = tx(pt.elapsed); const y = ty(pt[valueKey]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      hist.forEach((pt, i) => {
        const x = tx(pt.elapsed); const y = ty(pt[threshKey]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = color;
      ctx.font = '10px ui-monospace,monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, PAD.left + 8, PAD.top + 14 + GRAPH_BANDS.indexOf(label) * 14);
    };

    drawSeries('alphaDisplayValue', 'alphaThreshold', 'Alpha', BAND_COLORS.Alpha);
    drawSeries('thetaDisplayValue', 'thetaThreshold', 'Theta', BAND_COLORS.Theta);
    drawSeries('betaDisplayValue',  'betaThreshold',  'Beta',  BAND_COLORS.Beta);

    // Per-band clarity lines (lighter)
    const CLARITY_KEYS = [
      ['alphaClarity', BAND_COLORS.Alpha + '88'],
      ['thetaClarity', BAND_COLORS.Theta + '88'],
      ['betaClarity',  BAND_COLORS.Beta  + '88'],
    ];
    CLARITY_KEYS.forEach(([key, color], ci) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      hist.forEach((pt, i) => {
        const x = tx(pt.elapsed);
        const y = PAD.top + plotH - (pt[key] ?? 0) * plotH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      if (ci === 0) {
        ctx.fillStyle = color;
        ctx.fillText('Clarity (α θ β)', PAD.left + 90, PAD.top + 14);
      }
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px ui-monospace,monospace';
    for (let i = 0; i <= 4; i++) {
      const t = xMin + ((xMax - xMin) * i) / 4;
      ctx.fillText(_fmt(t), tx(t), H - 10);
    }
  }

  // ── Detail graph (live + bars) ─────────────────────────────────────────────

  _drawDetailGraph(idle = false) {
    const canvas = this._detailCanvas;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 900;
    const H = canvas.clientHeight || 320;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, W, H);

    const PAD = { top: 40, right: 18, bottom: 36, left: 60 };
    const plotW = W - PAD.left - PAD.right;
    const avail = H - PAD.top - PAD.bottom;
    const GAP = 22;
    const topH = Math.max(90, Math.floor((avail - GAP) * 0.44));
    const botTop = PAD.top + topH + GAP;
    const botH = H - botTop - PAD.bottom;
    const yMin = -3;
    const yMax = 3;
    const yRange = yMax - yMin;
    const valToNorm = v => (v - yMin) / yRange;

    const drawGridBlock = (top, height, title) => {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.textAlign = 'left';
      ctx.font = '11px ui-monospace,monospace';
      ctx.fillText(title, PAD.left, top - 7);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.textAlign = 'right';
      ctx.font = '10px ui-monospace,monospace';
      for (let i = 0; i < 5; i++) {
        const ratio = i / 4;
        const v = yMin + yRange * ratio;
        const y = top + height - ratio * height;
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
        ctx.fillText((v > 0 ? '+' : '') + v.toFixed(1), PAD.left - 4, y + 3);
      }
      const zeroY = top + height - valToNorm(0) * height;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(PAD.left, zeroY); ctx.lineTo(PAD.left + plotW, zeroY); ctx.stroke();
      ctx.setLineDash([]);
    };

    drawGridBlock(PAD.top, topH, `Live (${this._realtimeWindowSec}s)`);
    const latest = this._samples.at(-1)?.elapsed ?? 0;
    const live = this._samples.filter(s => s.elapsed >= latest - this._realtimeWindowSec);
    const lMin = live[0]?.elapsed ?? Math.max(0, latest - this._realtimeWindowSec);
    const lRange = Math.max((live.at(-1)?.elapsed ?? latest) - lMin, this._realtimeWindowSec, 1);
    const lTx = t => PAD.left + ((t - lMin) / lRange) * plotW;
    const lTy = v => PAD.top + topH - valToNorm(v) * topH;

    if (!live.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.font = '13px ui-monospace,monospace';
      ctx.textAlign = 'center';
      ctx.fillText(idle ? 'Start training to see live band metrics.' : 'Waiting for signal…', W / 2, PAD.top + topH / 2);
    } else {
      GRAPH_BANDS.forEach(name => {
        ctx.strokeStyle = BAND_COLORS[name];
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        live.forEach((pt, i) => {
          const x = lTx(pt.elapsed);
          const y = lTy(pt[name] ?? 0);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '9px ui-monospace,monospace';
      for (let i = 0; i <= 4; i++) {
        const t = lMin + (lRange * i) / 4;
        ctx.fillText(_fmt(t), lTx(t), PAD.top + topH + 12);
      }
    }

    drawGridBlock(botTop, botH, `Window Averages (${this._windowSec}s bars)`);
    if (!this._bandHistory.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.font = '13px ui-monospace,monospace';
      ctx.textAlign = 'center';
      ctx.fillText(idle ? 'Start training to build band windows.' : `Waiting for ${this._windowSec}s window…`, W / 2, botTop + botH / 2);
      return;
    }

    const pts = this._bandHistory;
    const clW = plotW / Math.max(pts.length, 1);
    const barGap = Math.min(6, clW * 0.08);
    const barW = Math.max(5, (Math.max(clW - barGap * 2, 8) / GRAPH_BANDS.length) - 2);
    const bZero = botTop + botH - valToNorm(0) * botH;
    pts.forEach((pt, idx) => {
      const cx = PAD.left + idx * clW + barGap;
      GRAPH_BANDS.forEach((name, bi) => {
        const raw = pt[name] ?? 0;
        const topY = botTop + botH - valToNorm(raw) * botH;
        const rectTop = Math.min(topY, bZero);
        const rectH = Math.max(2, Math.abs(bZero - topY));
        ctx.fillStyle = BAND_COLORS[name];
        ctx.globalAlpha = 0.82;
        ctx.fillRect(cx + bi * (barW + 2), rectTop, barW, rectH);
        ctx.globalAlpha = 1;
      });
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px ui-monospace,monospace';
    const every = Math.max(1, Math.ceil(pts.length / 6));
    pts.forEach((pt, idx) => {
      if (idx % every !== 0 && idx !== pts.length - 1) return;
      ctx.fillText(_fmt(pt.elapsed), PAD.left + idx * clW + clW * 0.5, H - 10);
    });
  }

  // ── PSD / Waveform ────────────────────────────────────────────────────────

  _initCtx(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || canvas.parentElement?.clientWidth || 300;
    const H = canvas.clientHeight || canvas.parentElement?.clientHeight || 110;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  _drawPSD(view) {
    if (!this._psdCanvas) return;
    if (!this._psdCtx) this._psdCtx = this._initCtx(this._psdCanvas);
    const ctx = this._psdCtx;
    const canvas = this._psdCanvas;
    fillCanvas(ctx, canvas);
    if (!view) return;
    const psd = view.display_psd;
    const rawPsd = view.raw_psd;
    if (!psd?.freqs?.length) { drawGrid(ctx, canvas); return; }
    const xMin = 2; const xMax = 62; const W = canvas.clientWidth; const H = canvas.clientHeight;
    const toX = f => ((f - xMin) / (xMax - xMin)) * W;
    const freqs = psd.freqs.filter(f => f >= xMin && f <= xMax);
    const values = psd.values.filter((_, i) => psd.freqs[i] >= xMin && psd.freqs[i] <= xMax);
    const rawFreqs = (rawPsd?.freqs || []).filter(f => f >= xMin && f <= xMax);
    const rawValues = (rawPsd?.values || []).filter((_, i) => (rawPsd.freqs[i] || 0) >= xMin && (rawPsd.freqs[i] || 0) <= xMax);
    const maxY = Math.max(...values, ...rawValues, 1e-9);
    drawGrid(ctx, canvas, 8, 4);
    ALL_PSD_BANDS.forEach(name => {
      const [lo, hi] = BAND_RANGES[name];
      const x0 = toX(Math.max(lo, xMin));
      const x1 = toX(Math.min(hi, xMax));
      if (x1 <= x0) return;
      ctx.fillStyle = PSD_BAND_COLORS[name] + '1a';
      ctx.fillRect(x0, 0, x1 - x0, H);
    });
    ALL_PSD_BANDS.forEach(name => {
      const [lo, hi] = BAND_RANGES[name];
      const mid = toX((Math.max(lo, xMin) + Math.min(hi, xMax)) / 2);
      ctx.fillStyle = PSD_BAND_COLORS[name] + '99';
      ctx.font = '10px ui-monospace';
      ctx.textAlign = 'center';
      ctx.fillText(name, mid, H - 4);
      ctx.textAlign = 'left';
    });
    if (rawFreqs.length) {
      ctx.strokeStyle = 'rgba(150,150,180,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      rawFreqs.forEach((f, i) => {
        const px = toX(f); const py = H - (rawValues[i] / maxY) * H;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    ctx.strokeStyle = '#aaccff';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    freqs.forEach((f, i) => {
      const px = toX(f); const py = H - (values[i] / maxY) * H;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
    const x60 = toX(60);
    ctx.strokeStyle = 'rgba(220,80,80,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x60, 0); ctx.lineTo(x60, H - 14); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(220,80,80,0.8)';
    ctx.font = '10px ui-monospace';
    ctx.textAlign = 'center';
    ctx.fillText('60', x60, H - 16);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.muted;
    ctx.fillText('2Hz', 4, H - 4);
    ctx.fillText('62Hz', W - 28, H - 4);
  }

  _drawWaveform(view) {
    if (!this._waveCanvas) return;
    if (!this._waveCtx) this._waveCtx = this._initCtx(this._waveCanvas);
    const ctx = this._waveCtx;
    const canvas = this._waveCanvas;
    fillCanvas(ctx, canvas);
    if (!view) return;
    const trace = view.selected_trace;
    const xMin = view.window_start_sec;
    const xMax = view.window_end_sec;
    if (!trace?.t?.length) { drawGrid(ctx, canvas); return; }
    const [yMin, yMax] = autoBounds(trace.y);
    drawGrid(ctx, canvas, 8, 4);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const zeroY = H - ((0 - yMin) / Math.max(1e-9, yMax - yMin)) * H;
    ctx.strokeStyle = C.muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(W, zeroY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = C.wave;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const span = xMax - xMin;
    const yspan = yMax - yMin;
    trace.t.forEach((t, i) => {
      const px = ((t - xMin) / Math.max(1e-9, span)) * W;
      const py = H - ((trace.y[i] - yMin) / Math.max(1e-9, yspan)) * H;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
    drawAxisLabels(ctx, canvas, xMin, xMax, yMin, yMax, 'µV');
  }
}

window.NFPrograms = window.NFPrograms || {};
window.NFPrograms.alpha_theta_beta = AlphaThetaBetaProgram;

})();
