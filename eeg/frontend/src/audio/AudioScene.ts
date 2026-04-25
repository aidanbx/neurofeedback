import { resolveAudioUrl } from './resolveAudioUrl';

/**
 * Two-track crossfade scene (base + clear) driven by a 0–1 drive value.
 * Direct TypeScript port of NFAudioScene from engine.js.
 */
export class AudioScene {
  private ctx: AudioContext;
  private sceneGain: GainNode;
  private baseGain: GainNode;
  private clearGain: GainNode;

  private baseEl: HTMLAudioElement | null = null;
  private clearEl: HTMLAudioElement | null = null;
  private baseNode: MediaElementAudioSourceNode | null = null;
  private clearNode: MediaElementAudioSourceNode | null = null;

  private baseVol  = 1.0;
  private clearVol = 1.0;
  private loaded   = false;
  private playing  = false;

  constructor(ctx: AudioContext, masterGain: GainNode) {
    this.ctx = ctx;

    this.sceneGain = ctx.createGain();
    this.sceneGain.gain.value = 1.0;
    this.sceneGain.connect(masterGain);

    this.baseGain  = ctx.createGain();
    this.clearGain = ctx.createGain();
    this.baseGain.gain.value  = 1.0;
    this.clearGain.gain.value = 0.0;
    this.baseGain.connect(this.sceneGain);
    this.clearGain.connect(this.sceneGain);
  }

  async load(baseUrl: string | null, clearUrl: string | null): Promise<void> {
    this.teardown();
    const isSilent = (u: string | null) => !u || u === 'silence';
    const [baseEl, clearEl] = await Promise.all([
      isSilent(baseUrl)  ? Promise.resolve(null) : this.loadElement(baseUrl!),
      isSilent(clearUrl) ? Promise.resolve(null) : this.loadElement(clearUrl!),
    ]);
    this.baseEl  = baseEl;
    this.clearEl = clearEl;
    if (baseEl) {
      this.baseNode = this.ctx.createMediaElementSource(baseEl);
      this.baseNode.connect(this.baseGain);
    }
    if (clearEl) {
      this.clearNode = this.ctx.createMediaElementSource(clearEl);
      this.clearNode.connect(this.clearGain);
    }
    this.loaded = true;
    if (this.playing) {
      this.baseEl?.play().catch(() => {});
      this.clearEl?.play().catch(() => {});
    }
  }

  play(): void {
    this.playing = true;
    this.ctx.resume().catch(() => {});
    this.baseEl?.play().catch(() => {});
    this.clearEl?.play().catch(() => {});
  }

  stop(): void {
    this.playing = false;
    if (this.baseEl)  { this.baseEl.pause();  this.baseEl.currentTime  = 0; }
    if (this.clearEl) { this.clearEl.pause(); this.clearEl.currentTime = 0; }
  }

  setVolume(v: number, rampSec = 0.1): void {
    const now = this.ctx.currentTime;
    this.sceneGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, v)), now, Math.max(0.001, rampSec / 3),
    );
  }

  setTrackVolumes(baseVol: number, clearVol: number): void {
    this.baseVol  = Math.max(0, Math.min(1, baseVol));
    this.clearVol = Math.max(0, Math.min(1, clearVol));
  }

  setCrossfade(drive: number, rampSec = 0.5): void {
    const d   = Math.max(0, Math.min(1, drive));
    const tau = Math.max(0.001, rampSec / 3);
    const now = this.ctx.currentTime;
    this.baseGain.gain.setTargetAtTime(Math.cos(d * Math.PI / 2) * this.baseVol,  now, tau);
    this.clearGain.gain.setTargetAtTime(Math.sin(d * Math.PI / 2) * this.clearVol, now, tau);
  }

  destroy(): void {
    this.stop();
    this.teardown();
    this.sceneGain.disconnect();
  }

  private loadElement(url: string): Promise<HTMLAudioElement> {
    return new Promise((resolve, reject) => {
      const el = new Audio();
      const resolvedUrl = resolveAudioUrl(url);
      el.loop        = true;
      el.crossOrigin = 'anonymous';
      el.preload     = 'auto';
      el.src         = resolvedUrl;
      el.addEventListener('canplay', () => resolve(el), { once: true });
      el.addEventListener('error',   () => reject(new Error(`Failed to load: ${resolvedUrl}`)), { once: true });
      el.load();
    });
  }

  private teardown(): void {
    if (this.baseEl)  { this.baseEl.pause();  this.baseEl.src  = ''; }
    if (this.clearEl) { this.clearEl.pause(); this.clearEl.src = ''; }
    try { this.baseNode?.disconnect();  } catch {}
    try { this.clearNode?.disconnect(); } catch {}
    this.baseEl = this.clearEl = null;
    this.baseNode = this.clearNode = null;
    this.loaded = false;
  }
}
