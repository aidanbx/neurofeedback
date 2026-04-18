'use strict';

// ── NFAudioScene ─────────────────────────────────────────────────────────────
// A two-track crossfade scene (base + clear) driven by a 0–1 drive value.
// Programs create one instance per feedback channel.
//
// Usage:
//   const scene = new NFAudioScene(audioCtx, masterGain);
//   await scene.load('/static/audio/tracks/Brown Noise.mp3', '/static/audio/tracks/Rain.mp3');
//   scene.play();
//   scene.setCrossfade(0.7, 1.5);  // fade toward clear track over 1.5s
//   scene.setVolume(0.8);
//   scene.stop();

class NFAudioScene {
  constructor(audioCtx, masterGain) {
    this._ctx  = audioCtx;
    this._master = masterGain;

    // Scene gain node — controls this scene's overall volume
    this._sceneGain = audioCtx.createGain();
    this._sceneGain.gain.value = 1.0;
    this._sceneGain.connect(masterGain);

    // Per-track gain nodes for crossfade
    this._baseGain  = audioCtx.createGain();
    this._clearGain = audioCtx.createGain();
    this._baseGain.gain.value  = 1.0;
    this._clearGain.gain.value = 0.0;
    this._baseGain.connect(this._sceneGain);
    this._clearGain.connect(this._sceneGain);

    this._baseEl  = null;   // HTMLAudioElement
    this._clearEl = null;   // HTMLAudioElement
    this._baseNode  = null; // MediaElementSourceNode
    this._clearNode = null; // MediaElementSourceNode

    this._baseVol  = 1.0;  // per-track volume multipliers (0–1)
    this._clearVol = 1.0;

    this._loaded  = false;
    this._playing = false;
  }

  // Load two tracks. Pass null, '', or 'silence' for a silent slot.
  // Calling load() again swaps to new tracks (stops old playback first).
  async load(baseUrl, clearUrl) {
    this._teardownElements();

    const isSilent = url => !url || url === 'silence';
    const [baseEl, clearEl] = await Promise.all([
      isSilent(baseUrl)  ? Promise.resolve(null) : this._loadElement(baseUrl),
      isSilent(clearUrl) ? Promise.resolve(null) : this._loadElement(clearUrl),
    ]);

    this._baseEl  = baseEl;
    this._clearEl = clearEl;

    if (baseEl) {
      this._baseNode = this._ctx.createMediaElementSource(baseEl);
      this._baseNode.connect(this._baseGain);
    }
    if (clearEl) {
      this._clearNode = this._ctx.createMediaElementSource(clearEl);
      this._clearNode.connect(this._clearGain);
    }

    this._loaded = true;

    if (this._playing) {
      if (this._baseEl)  this._baseEl.play().catch(() => {});
      if (this._clearEl) this._clearEl.play().catch(() => {});
    }
  }

  play() {
    this._playing = true;
    this._ctx.resume().catch(() => {});
    if (this._baseEl)  this._baseEl.play().catch(() => {});
    if (this._clearEl) this._clearEl.play().catch(() => {});
  }

  stop() {
    this._playing = false;
    if (this._baseEl) {
      this._baseEl.pause();
      this._baseEl.currentTime = 0;
    }
    if (this._clearEl) {
      this._clearEl.pause();
      this._clearEl.currentTime = 0;
    }
  }

  // Set this scene's master volume (0–1). Ramped smoothly.
  setVolume(v, rampSec = 0.1) {
    const now = this._ctx.currentTime;
    this._sceneGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, v)),
      now,
      Math.max(0.001, rampSec / 3),
    );
  }

  // Set per-track volume multipliers (0–1). Applied on every setCrossfade call.
  setTrackVolumes(baseVol, clearVol) {
    this._baseVol  = Math.max(0, Math.min(1, baseVol));
    this._clearVol = Math.max(0, Math.min(1, clearVol));
  }

  // Set crossfade position. drive=0 → full base, drive=1 → full clear.
  // Constant-power crossfade scaled by per-track volume multipliers.
  setCrossfade(drive, rampSec = 0.5) {
    const d   = Math.max(0, Math.min(1, drive));
    const tau = Math.max(0.001, rampSec / 3);
    const now = this._ctx.currentTime;
    this._baseGain.gain.setTargetAtTime(Math.cos(d * Math.PI / 2) * this._baseVol, now, tau);
    this._clearGain.gain.setTargetAtTime(Math.sin(d * Math.PI / 2) * this._clearVol, now, tau);
  }

  destroy() {
    this.stop();
    this._teardownElements();
    this._sceneGain.disconnect();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _loadElement(url) {
    return new Promise((resolve, reject) => {
      const el = new Audio();
      el.loop        = true;
      el.crossOrigin = 'anonymous';
      el.preload     = 'auto';
      el.src         = url;
      el.addEventListener('canplay', () => resolve(el), { once: true });
      el.addEventListener('error', () => reject(new Error(`Failed to load: ${url}`)), { once: true });
      el.load();
    });
  }

  _teardownElements() {
    if (this._baseEl)  { this._baseEl.pause();  this._baseEl.src  = ''; }
    if (this._clearEl) { this._clearEl.pause(); this._clearEl.src = ''; }
    if (this._baseNode)  { try { this._baseNode.disconnect();  } catch {} }
    if (this._clearNode) { try { this._clearNode.disconnect(); } catch {} }
    this._baseEl = this._clearEl = this._baseNode = this._clearNode = null;
    this._loaded = false;
  }
}

window.NFAudioScene = NFAudioScene;
