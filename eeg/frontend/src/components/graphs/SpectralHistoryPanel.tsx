import { useEffect, useMemo, useRef, useState } from 'react';
import type { MetricsSnapshot, PSDBaselineAggregate } from '../../contracts';
import { api } from '../../api/client';
import { useDeviceStore } from '../../state/deviceStore';
import { ComponentSettings } from '../controls/ComponentSettings';
import { RangeSlider } from '../controls/RangeSlider';
import { Slider } from '../controls/Slider';
import { useCanvasSize } from './useCanvasSize';

type SpectrogramMode = 'forever_zscore' | 'session_zscore' | 'causal_zscore' | 'log_power';
type PsdScaleMode = 'log_power' | 'absolute_power';

export interface SpectralBandOverlay {
  id: string;
  label: string;
  lo_hz: number;
  hi_hz: number;
  color?: string;
  threshold?: number;
  feature?: string;
  active?: boolean;
}

interface PsdSample {
  x: number;
  freqs: number[];
  values: number[];
}

interface BinnedSample {
  x: number;
  freqs: number[];
  values: number[];
  logs: number[];
}

interface RunningStat {
  n: number;
  mean: number;
  m2: number;
}

const BANDS = [
  { name: 'Delta', lo: 0.5, hi: 4, color: '#7777dd', row: 0 },
  { name: 'Theta', lo: 4, hi: 8, color: '#55bb88', row: 1 },
  { name: 'Alpha', lo: 8, hi: 12, color: '#f0cc44', row: 0 },
  { name: 'SMR', lo: 12, hi: 15, color: '#f08030', row: 1 },
  { name: 'Beta', lo: 15, hi: 20, color: '#e05050', row: 0 },
  { name: 'Hi-Beta', lo: 20, hi: 30, color: '#cc55dd', row: 1 },
  { name: 'Gamma', lo: 30, hi: 60, color: '#6688aa', row: 0 },
];

const PAD_L = 58;
const PAD_R = 10;
const PAD_T = 12;
const PSD_PLOT_H = 260;
const AXIS_H = 18;
const RAIL_H = 34;
const SPECTRO_H = 380;
const LOG_STEP = 0.05;

const MODE_LABELS: Record<SpectrogramMode, string> = {
  forever_zscore: 'Forever z-score',
  session_zscore: 'Session z-score',
  causal_zscore: 'Causal z-score',
  log_power: 'Log power',
};

function logPower(v: number) {
  return Math.log10(Math.max(v, 1e-12));
}

function fmtPowerLog(v: number) {
  return `1e${v.toFixed(0)}`;
}

function fmtPower(v: number) {
  if (!Number.isFinite(v)) return '--';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  return v.toExponential(1);
}

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

function heatColor(t: number) {
  const x = Math.max(0, Math.min(1, t));
  const stops = [
    [18, 10, 36],
    [78, 28, 128],
    [160, 32, 96],
    [226, 58, 48],
    [255, 192, 88],
    [255, 248, 218],
  ];
  const scaled = x * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - i;
  const a = stops[i];
  const b = stops[i + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * local);
  const g = Math.round(a[1] + (b[1] - a[1]) * local);
  const blue = Math.round(a[2] + (b[2] - a[2]) * local);
  return `rgb(${r},${g},${blue})`;
}

function zColor(z: number) {
  return heatColor((Math.max(-3, Math.min(3, z)) + 3) / 6);
}

function logColor(v: number, logMin: number, logMax: number) {
  return heatColor((v - logMin) / Math.max(1e-6, logMax - logMin));
}

function runningUpdate(stat: RunningStat, value: number): RunningStat {
  const n = stat.n + 1;
  const delta = value - stat.mean;
  const mean = stat.mean + delta / n;
  const delta2 = value - mean;
  return { n, mean, m2: stat.m2 + delta * delta2 };
}

function zFromStat(value: number, stat: RunningStat | undefined) {
  if (!stat || stat.n < 2) return 0;
  const variance = stat.m2 / Math.max(1, stat.n - 1);
  return (value - stat.mean) / Math.max(Math.sqrt(variance), 1e-6);
}

function binSnapshot(sample: PsdSample, binHz: number): BinnedSample {
  const buckets = new Map<number, { sum: number; n: number }>();
  sample.freqs.forEach((freq, index) => {
    const value = sample.values[index];
    if (!Number.isFinite(freq) || !Number.isFinite(value)) return;
    const center = Math.round(freq / binHz) * binHz;
    const bucket = buckets.get(center) ?? { sum: 0, n: 0 };
    bucket.sum += value;
    bucket.n += 1;
    buckets.set(center, bucket);
  });
  const freqs = [...buckets.keys()].sort((a, b) => a - b);
  const values = freqs.map((freq) => {
    const bucket = buckets.get(freq)!;
    return bucket.sum / Math.max(1, bucket.n);
  });
  return { x: sample.x, freqs, values, logs: values.map(logPower) };
}

function baselineStatFor(freq: number, baseline: PSDBaselineAggregate | null): RunningStat | undefined {
  if (!baseline || !baseline.freq_bins.length) return undefined;
  const idx = Math.round((freq - baseline.freq_min_hz) / baseline.freq_bin_hz);
  const n = baseline.stats.n[idx] ?? 0;
  return {
    n,
    mean: baseline.stats.mean[idx] ?? 0,
    m2: baseline.stats.m2[idx] ?? 0,
  };
}

function drawAxes(ctx: CanvasRenderingContext2D, width: number, height: number, minFreq: number, maxFreq: number, fToX: (f: number) => number) {
  ctx.strokeStyle = '#252535';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_L, height - AXIS_H - RAIL_H);
  ctx.lineTo(width - PAD_R, height - AXIS_H - RAIL_H);
  ctx.stroke();
  ctx.fillStyle = '#55556a';
  ctx.font = '9px ui-monospace, monospace';
  [minFreq, 4, 8, 12, 15, 20, 30, 40, 60, maxFreq]
    .filter((f, index, arr) => f >= minFreq && f <= maxFreq && arr.indexOf(f) === index)
    .forEach((f) => {
      const x = fToX(f);
      const label = `${f}`;
      const tw = ctx.measureText(label).width;
      ctx.fillText(label, Math.min(width - PAD_R - tw, Math.max(PAD_L, x - tw / 2)), height - RAIL_H - 4);
    });
}

function drawBandRail(ctx: CanvasRenderingContext2D, width: number, height: number, minFreq: number, maxFreq: number, fToX: (f: number) => number) {
  const top = height - RAIL_H + 4;
  ctx.font = '9px ui-monospace, monospace';
  for (const band of BANDS) {
    if (band.hi <= minFreq || band.lo >= maxFreq) continue;
    const x0 = fToX(Math.max(band.lo, minFreq));
    const x1 = fToX(Math.min(band.hi, maxFreq));
    const y = top + band.row * 14;
    ctx.strokeStyle = band.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    const label = band.name;
    const tw = ctx.measureText(label).width;
    if (x1 - x0 > tw + 6) {
      ctx.fillStyle = band.color;
      ctx.fillText(label, x0 + Math.max(3, (x1 - x0 - tw) / 2), y - 4);
    }
  }
  ctx.fillStyle = '#55556a';
  ctx.fillText('frequency bands', 4, top + 12);
  ctx.strokeStyle = '#252535';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_L, top - 8);
  ctx.lineTo(width - PAD_R, top - 8);
  ctx.stroke();
}

export function SpectralHistoryPanel({
  bandOverlays = [],
  defaultShowBandOverlays = true,
}: {
  bandOverlays?: SpectralBandOverlay[];
  defaultShowBandOverlays?: boolean;
}) {
  const metricsBatch = useDeviceStore((state) => state.metricsBatch);
  const latestMetrics = useDeviceStore((state) => state.metrics);
  const recording = useDeviceStore((state) => state.appState?.recording ?? false);
  const historyRef = useRef<PsdSample[]>([]);
  const lastXRef = useRef(0);
  const prevRecordingRef = useRef(false);
  const psdCanvasRef = useRef<HTMLCanvasElement>(null);
  const specCanvasRef = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(900, PSD_PLOT_H + AXIS_H + RAIL_H + SPECTRO_H + 22);
  const width = size.width;

  const [minFreq, setMinFreq] = useState(0);
  const [maxFreq, setMaxFreq] = useState(70);
  const [binHz, setBinHz] = useState(0.5);
  const [mode, setMode] = useState<SpectrogramMode>('forever_zscore');
  const [psdScaleMode, setPsdScaleMode] = useState<PsdScaleMode>('log_power');
  const [logMin, setLogMin] = useState(-5);
  const [logMax, setLogMax] = useState(2);
  const [spectrogramLogMin, setSpectrogramLogMin] = useState(-5);
  const [spectrogramLogMax, setSpectrogramLogMax] = useState(2);
  const [absMin, setAbsMin] = useState(0);
  const [absMax, setAbsMax] = useState(20);
  const [spectrogramWindowSec, setSpectrogramWindowSec] = useState(60);
  const [cursorHz, setCursorHz] = useState(10);
  const [showBandOverlays, setShowBandOverlays] = useState(defaultShowBandOverlays);
  const [baseline, setBaseline] = useState<PSDBaselineAggregate | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    const load = () => api.getPsdBaseline().then(setBaseline).catch(() => setBaseline(null));
    load();
    window.addEventListener('sessions:changed', load);
    return () => window.removeEventListener('sessions:changed', load);
  }, []);

  useEffect(() => {
    if (metricsBatch.length === 0) return;
    if (recording && !prevRecordingRef.current) {
      historyRef.current = [];
      lastXRef.current = 0;
    }
    prevRecordingRef.current = recording;
    let changed = false;
    for (const snap of metricsBatch) {
      if (!snap.psd_freqs.length || !snap.psd_values.length) continue;
      if (recording && snap.elapsed_sec + 1 < lastXRef.current) {
        historyRef.current = [];
        lastXRef.current = 0;
      }
      const x = recording && snap.elapsed_sec > lastXRef.current ? snap.elapsed_sec : lastXRef.current + 0.25;
      lastXRef.current = x;
      historyRef.current = [
        ...historyRef.current.slice(-7200),
        { x, freqs: snap.psd_freqs, values: snap.psd_values },
      ];
      changed = true;
    }
    if (changed) forceRender((count) => count + 1);
  }, [metricsBatch, recording]);

  const binned = useMemo(() => historyRef.current.map((sample) => binSnapshot(sample, binHz)), [binHz, historyRef.current.length]);
  const latest = useMemo(() => {
    if (!latestMetrics?.psd_freqs.length) return binned[binned.length - 1] ?? null;
    return binSnapshot({ x: latestMetrics.elapsed_sec, freqs: latestMetrics.psd_freqs, values: latestMetrics.psd_values }, binHz);
  }, [latestMetrics, binHz, binned]);

  const visibleFreqs = useMemo(() => {
    const out: number[] = [];
    for (let f = minFreq; f <= maxFreq + 1e-6; f += binHz) out.push(Number(f.toFixed(6)));
    return out;
  }, [minFreq, maxFreq, binHz]);

  useEffect(() => {
    const canvas = psdCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const height = PSD_PLOT_H + AXIS_H + RAIL_H;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#13131e';
    ctx.fillRect(0, 0, width, height);

    const plotH = PSD_PLOT_H - PAD_T;
    const plotW = width - PAD_L - PAD_R;
    const fSpan = maxFreq - minFreq || 1;
    const fToX = (f: number) => PAD_L + ((f - minFreq) / fSpan) * plotW;
    const isLogScale = psdScaleMode === 'log_power';
    const rangeMin = isLogScale ? Math.min(logMin, logMax - LOG_STEP) : Math.min(absMin, absMax - 1e-9);
    const rangeMax = isLogScale ? Math.max(logMax, logMin + LOG_STEP) : Math.max(absMax, absMin + 1e-9);
    const valueForY = (sample: BinnedSample, index: number) => isLogScale ? sample.logs[index] : sample.values[index];
    const yToY = (value: number) => PAD_T + (1 - (Math.max(rangeMin, Math.min(rangeMax, value)) - rangeMin) / (rangeMax - rangeMin)) * plotH;
    const powerBins = isLogScale
      ? Math.max(8, Math.round((rangeMax - rangeMin) / LOG_STEP))
      : 80;
    const matrix = visibleFreqs.map(() => Array(powerBins).fill(0));

    binned.forEach((sample) => {
      sample.freqs.forEach((freq, index) => {
        if (freq < minFreq || freq > maxFreq) return;
        const fi = Math.round((freq - minFreq) / binHz);
        const pi = Math.max(0, Math.min(powerBins - 1, Math.floor(((valueForY(sample, index) - rangeMin) / (rangeMax - rangeMin)) * powerBins)));
        if (matrix[fi]) matrix[fi][pi] += 1;
      });
    });
    const countScale = Math.max(4, Math.sqrt(Math.max(1, binned.length)) * 2.2);
    const cellW = Math.max(1, plotW / Math.max(1, visibleFreqs.length));
    const cellH = Math.max(1, plotH / powerBins);
    matrix.forEach((col, fi) => {
      col.forEach((count, pi) => {
        if (count <= 0) return;
        ctx.fillStyle = heatColor(Math.min(1, Math.sqrt(count / countScale)));
        const x = PAD_L + fi * cellW;
        const y = PAD_T + (powerBins - 1 - pi) * cellH;
        ctx.fillRect(x, y, Math.ceil(cellW), Math.ceil(cellH));
      });
    });

    ctx.strokeStyle = '#252535';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = PAD_T + (i / 4) * plotH;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(width - PAD_R, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#55556a';
    ctx.font = '9px ui-monospace, monospace';
    [rangeMax, rangeMax - (rangeMax - rangeMin) / 3, rangeMax - 2 * (rangeMax - rangeMin) / 3, rangeMin].forEach((v) => {
      const y = yToY(v);
      ctx.fillText(isLogScale ? fmtPowerLog(v) : fmtPower(v), 4, Math.max(PAD_T + 8, Math.min(PAD_T + plotH, y)));
    });
    ctx.save();
    ctx.translate(10, PAD_T + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('PSD power', -24, 0);
    ctx.restore();

    if (latest) {
      ctx.beginPath();
      ctx.strokeStyle = '#eaf3ff';
      ctx.lineWidth = 1.2;
      let started = false;
      latest.freqs.forEach((freq, index) => {
        if (freq < minFreq || freq > maxFreq) return;
        const x = fToX(freq);
        const y = yToY(valueForY(latest, index));
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      latest.freqs.forEach((freq, index) => {
        if (freq < minFreq || freq > maxFreq) return;
        ctx.fillStyle = '#eaf3ff';
        ctx.beginPath();
        ctx.arc(fToX(freq), yToY(valueForY(latest, index)), 2.2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    const cursorX = fToX(Math.max(minFreq, Math.min(maxFreq, cursorHz)));
    ctx.strokeStyle = '#ffffffaa';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(cursorX, PAD_T);
    ctx.lineTo(cursorX, PAD_T + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#eaf3ff';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${cursorHz.toFixed(1)} Hz`, Math.max(PAD_L + 24, Math.min(width - PAD_R - 24, cursorX)), PAD_T + 12);

    if (showBandOverlays && bandOverlays.length > 0) {
      bandOverlays.forEach((band, index) => {
        if (band.hi_hz <= minFreq || band.lo_hz >= maxFreq) return;
        const color = band.color ?? BANDS[index % BANDS.length]?.color ?? '#ffffff';
        const x0 = fToX(Math.max(minFreq, band.lo_hz));
        const x1 = fToX(Math.min(maxFreq, band.hi_hz));
        ctx.fillStyle = `${color}1f`;
        ctx.fillRect(x0, PAD_T, Math.max(2, x1 - x0), plotH);
        ctx.strokeStyle = band.active ? color : `${color}aa`;
        ctx.lineWidth = band.active ? 2 : 1;
        ctx.strokeRect(x0, PAD_T, Math.max(2, x1 - x0), plotH);
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText(`${band.label} ${band.lo_hz}-${band.hi_hz}Hz`, x0 + 4, PAD_T + 26 + (index % 3) * 13);
        if (Number.isFinite(band.threshold)) {
          const threshold = Number(band.threshold);
          const thresholdValue = isLogScale && band.feature !== 'absolute_power'
            ? threshold / Math.LN10
            : threshold;
          if (thresholdValue >= rangeMin && thresholdValue <= rangeMax) {
            const ty = yToY(thresholdValue);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 3]);
            ctx.beginPath();
            ctx.moveTo(x0, ty);
            ctx.lineTo(x1, ty);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      });
    }

    drawAxes(ctx, width, height, minFreq, maxFreq, fToX);
    drawBandRail(ctx, width, height, minFreq, maxFreq, fToX);
    ctx.fillStyle = '#858595';
    ctx.fillText(`${binned.length} PSD snapshots`, PAD_L + 4, 12);
  }, [binned, latest, visibleFreqs, minFreq, maxFreq, binHz, width, psdScaleMode, logMin, logMax, absMin, absMax, cursorHz, showBandOverlays, bandOverlays]);

  useEffect(() => {
    const canvas = psdCanvasRef.current;
    if (!canvas) return;
    const height = PSD_PLOT_H + AXIS_H + RAIL_H;
    const plotW = width - PAD_L - PAD_R;
    const fSpan = maxFreq - minFreq || 1;
    const xToFreq = (x: number) => minFreq + ((x - PAD_L) / Math.max(1, plotW)) * fSpan;
    let dragging = false;

    const setFromEvent = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(PAD_L, Math.min(width - PAD_R, event.clientX - rect.left));
      setCursorHz(Number(Math.max(minFreq, Math.min(maxFreq, xToFreq(x))).toFixed(1)));
    };

    const onPointerDown = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const y = event.clientY - rect.top;
      if (y < 0 || y > height - RAIL_H) return;
      dragging = true;
      canvas.setPointerCapture(event.pointerId);
      setFromEvent(event);
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      setFromEvent(event);
      event.preventDefault();
    };
    const stopDrag = (event: PointerEvent) => {
      dragging = false;
      try { canvas.releasePointerCapture(event.pointerId); } catch {}
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', stopDrag);
      canvas.removeEventListener('pointercancel', stopDrag);
    };
  }, [maxFreq, minFreq, width]);

  useEffect(() => {
    const canvas = specCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = SPECTRO_H * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${SPECTRO_H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#13131e';
    ctx.fillRect(0, 0, width, SPECTRO_H);

    const plotW = width - PAD_L - PAD_R;
    const plotH = SPECTRO_H - PAD_T - AXIS_H;
    const fSpan = maxFreq - minFreq || 1;
    const fToX = (f: number) => PAD_L + ((f - minFreq) / fSpan) * plotW;
    const latestX = binned[binned.length - 1]?.x ?? 0;
    const windowStart = Math.max(0, latestX - spectrogramWindowSec);
    const visibleStart = binned.findIndex((sample) => sample.x >= windowStart);
    const causalCutoff = visibleStart < 0 ? binned.length : visibleStart;
    const visible = visibleStart < 0 ? [] : binned.slice(visibleStart);
    const sessionStats = new Map<number, RunningStat>();
    binned.forEach((sample) => {
      sample.freqs.forEach((freq, index) => {
        if (freq < minFreq || freq > maxFreq) return;
        sessionStats.set(freq, runningUpdate(sessionStats.get(freq) ?? { n: 0, mean: 0, m2: 0 }, sample.logs[index]));
      });
    });
    const causalStats = new Map<number, RunningStat>();
    binned.slice(0, causalCutoff).forEach((sample) => {
      sample.freqs.forEach((freq, index) => {
        if (freq < minFreq || freq > maxFreq) return;
        causalStats.set(freq, runningUpdate(causalStats.get(freq) ?? { n: 0, mean: 0, m2: 0 }, sample.logs[index]));
      });
    });
    const inferredStep = visible.length > 1 ? Math.max(0.05, (visible[visible.length - 1].x - visible[0].x) / (visible.length - 1)) : 0.25;
    const rowH = Math.max(1, (inferredStep / spectrogramWindowSec) * plotH);
    const cellW = Math.max(1, plotW / Math.max(1, visibleFreqs.length));

    const rows = visible.map((sample) => {
      const cells = sample.freqs.map((freq, index) => {
        if (freq < minFreq || freq > maxFreq) return;
        const log = sample.logs[index];
        const causalBefore = causalStats.get(freq);
        let value = log;
        if (mode === 'forever_zscore') {
          value = zFromStat(log, baselineStatFor(freq, baseline)) || zFromStat(log, causalBefore);
        } else if (mode === 'session_zscore') {
          value = zFromStat(log, sessionStats.get(freq));
        } else if (mode === 'causal_zscore') {
          value = zFromStat(log, causalBefore);
        }
        causalStats.set(freq, runningUpdate(causalBefore ?? { n: 0, mean: 0, m2: 0 }, log));
        return { freq, color: mode === 'log_power' ? logColor(value, spectrogramLogMin, spectrogramLogMax) : zColor(value) };
      }).filter((cell): cell is { freq: number; color: string } => Boolean(cell));
      return { x: sample.x, cells };
    });

    rows.slice().reverse().forEach((row) => {
      const y = PAD_T + ((latestX - row.x) / spectrogramWindowSec) * plotH;
      row.cells.forEach((cell) => {
        ctx.fillStyle = cell.color;
        ctx.fillRect(fToX(cell.freq) - cellW / 2, y, Math.ceil(cellW), Math.ceil(rowH));
      });
    });

    ctx.fillStyle = '#55556a';
    ctx.font = '9px ui-monospace, monospace';
    if (visible.length > 0) {
      ctx.fillText(fmtTime(latestX), 4, PAD_T + 8);
      ctx.fillText(fmtTime(Math.max(0, latestX - spectrogramWindowSec)), 4, PAD_T + plotH - 2);
    }
    ctx.fillText('now', PAD_L + 4, PAD_T + 10);
    ctx.fillText('past', PAD_L + 4, PAD_T + plotH - 4);
    drawAxes(ctx, width, SPECTRO_H + RAIL_H, minFreq, maxFreq, fToX);
    ctx.fillStyle = '#858595';
    const fallback = mode === 'forever_zscore' && (!baseline || baseline.stats.n.every((n) => n < 2));
    ctx.fillText(`${MODE_LABELS[mode]}${fallback ? ' (using causal fallback)' : ''}`, PAD_L + 4, 12);
  }, [binned, visibleFreqs, minFreq, maxFreq, binHz, width, mode, baseline, spectrogramLogMin, spectrogramLogMax, spectrogramWindowSec]);

  const settings = (
    <>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em' }}>Spectral History</div>
      <RangeSlider
        label="Frequency range"
        min={0}
        max={70}
        step={1}
        valueMin={minFreq}
        valueMax={maxFreq}
        onChangeMin={setMinFreq}
        onChangeMax={setMaxFreq}
        format={(v) => `${v} Hz`}
      />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.85em' }}>
        <span style={{ color: 'var(--muted)' }}>Display bin width</span>
        <select value={binHz} onChange={(event) => setBinHz(Number(event.target.value))}>
          {[0.5, 1, 2, 4].map((value) => (
            <option key={value} value={value}>{value} Hz</option>
          ))}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.85em' }}>
        <span style={{ color: 'var(--muted)' }}>Spectrogram mode</span>
        <select value={mode} onChange={(event) => setMode(event.target.value as SpectrogramMode)}>
          {Object.entries(MODE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.85em' }}>
        <span style={{ color: 'var(--muted)' }}>PSD scale</span>
        <select value={psdScaleMode} onChange={(event) => setPsdScaleMode(event.target.value as PsdScaleMode)}>
          <option value="log_power">Log power</option>
          <option value="absolute_power">Absolute power</option>
        </select>
      </label>
      <Slider
        label="Frequency cursor"
        min={minFreq}
        max={maxFreq}
        step={0.1}
        value={Math.max(minFreq, Math.min(maxFreq, cursorHz))}
        onChange={setCursorHz}
        format={(v) => `${v.toFixed(1)} Hz`}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85em', cursor: 'pointer' }}>
        <input type="checkbox" checked={showBandOverlays} onChange={(event) => setShowBandOverlays(event.target.checked)} />
        <span style={{ color: 'var(--muted)' }}>Show selected bands</span>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.85em' }}>
          <span style={{ color: 'var(--muted)' }}>{psdScaleMode === 'log_power' ? 'Log Y low' : 'Abs Y low'}</span>
          <input
            type="number"
            value={psdScaleMode === 'log_power' ? logMin : absMin}
            min={psdScaleMode === 'log_power' ? -12 : 0}
            max={psdScaleMode === 'log_power' ? logMax - 0.5 : absMax - 0.001}
            step={psdScaleMode === 'log_power' ? 0.5 : 0.1}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (psdScaleMode === 'log_power') setLogMin(value);
              else setAbsMin(value);
            }}
            style={{ background: '#1a1a28', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3, padding: '4px 6px', fontFamily: 'inherit', fontSize: 12, minWidth: 0 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.85em' }}>
          <span style={{ color: 'var(--muted)' }}>{psdScaleMode === 'log_power' ? 'Log Y high' : 'Abs Y high'}</span>
          <input
            type="number"
            value={psdScaleMode === 'log_power' ? logMax : absMax}
            min={psdScaleMode === 'log_power' ? logMin + 0.5 : absMin + 0.001}
            max={psdScaleMode === 'log_power' ? 6 : 10000}
            step={psdScaleMode === 'log_power' ? 0.5 : 0.1}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (psdScaleMode === 'log_power') setLogMax(value);
              else setAbsMax(value);
            }}
            style={{ background: '#1a1a28', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3, padding: '4px 6px', fontFamily: 'inherit', fontSize: 12, minWidth: 0 }}
          />
        </label>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.85em' }}>
        <span style={{ color: 'var(--muted)' }}>Spectrogram window</span>
        <select value={spectrogramWindowSec} onChange={(event) => setSpectrogramWindowSec(Number(event.target.value))}>
          {[4, 10, 30, 60, 120, 300].map((value) => (
            <option key={value} value={value}>{value < 60 ? `${value}s` : `${value / 60}m`}</option>
          ))}
        </select>
      </label>
      {mode === 'log_power' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.85em' }}>
            <span style={{ color: 'var(--muted)' }}>Spec color low</span>
            <input
              type="number"
              value={spectrogramLogMin}
              min={-12}
              max={spectrogramLogMax - 0.5}
              step={0.5}
              onChange={(event) => setSpectrogramLogMin(Number(event.target.value))}
              style={{ background: '#1a1a28', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3, padding: '4px 6px', fontFamily: 'inherit', fontSize: 12, minWidth: 0 }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.85em' }}>
            <span style={{ color: 'var(--muted)' }}>Spec color high</span>
            <input
              type="number"
              value={spectrogramLogMax}
              min={spectrogramLogMin + 0.5}
              max={6}
              step={0.5}
              onChange={(event) => setSpectrogramLogMax(Number(event.target.value))}
              style={{ background: '#1a1a28', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3, padding: '4px 6px', fontFamily: 'inherit', fontSize: 12, minWidth: 0 }}
            />
          </label>
        </div>
      )}
    </>
  );

  return (
    <ComponentSettings settings={settings}>
      <div ref={size.wrapRef} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <canvas ref={psdCanvasRef} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} />
        <canvas ref={specCanvasRef} style={{ display: 'block', width: '100%' }} />
      </div>
    </ComponentSettings>
  );
}
