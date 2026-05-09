import { useEffect, useMemo, useRef, useState } from 'react';
import type { BandFeature, MetricsSnapshot } from '../../contracts';
import { useDeviceStore } from '../../state/deviceStore';
import { ComponentSettings } from '../controls/ComponentSettings';
import { Slider } from '../controls/Slider';
import { BAND_COLORS, BAND_METRIC_INFO, BAND_METRIC_OPTIONS, type BandMetricMode } from './BandBars';
import { useCanvasSize } from './useCanvasSize';

interface Sample {
  x: number;
  bands: Record<string, BandFeature>;
}

interface Bar {
  x: number;
  start: number;
  values: Record<string, number>;
  thresholds: Record<string, number | null>;
  subValues: Record<string, Record<string, number>>;
}

interface PlotRange {
  yMin: number;
  yMax: number;
  zeroLine: boolean;
}

interface Props {
  bands?: string[];
  initialMode?: BandMetricMode;
  thresholdSeries?: Array<{ band: string; color?: string; points: Array<{ x: number; value: number }> }>;
  defaultLiveWindowSec?: number;
  defaultBarWindowSec?: number;
  defaultHistoryWindowSec?: number;
  height?: number;
  title?: string;
  showLiveChart?: boolean;
  showTitle?: boolean;
  combineHiBetaForBeta?: boolean;
  pauseWhenNotRecording?: boolean;
}

function valueFor(feature: BandFeature | undefined, mode: BandMetricMode): number {
  return Number(feature?.[mode] ?? 0);
}

function logAddExp(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return hi + Math.log1p(Math.exp(lo - hi));
}

function combinedHiBetaValue(
  sampleBands: Record<string, BandFeature>,
  band: string,
  mode: BandMetricMode,
  combineHiBetaForBeta: boolean,
): number {
  if (!(combineHiBetaForBeta && (band === 'Beta' || band === 'Beta+'))) return valueFor(sampleBands[band], mode);
  const beta = sampleBands.Beta;
  const hiBeta = sampleBands['Hi-Beta'];
  if (mode === 'absolute') return Number(beta?.absolute ?? 0) + Number(hiBeta?.absolute ?? 0);
  if (mode === 'log_absolute') {
    const absolute = Number(beta?.absolute ?? 0) + Number(hiBeta?.absolute ?? 0);
    return Math.log(Math.max(absolute, 1e-12));
  }
  if (mode === 'smoothed') return logAddExp(Number(beta?.smoothed ?? -20), Number(hiBeta?.smoothed ?? -20));
  return valueFor(beta, mode);
}

function rangeFor(mode: BandMetricMode, values: number[]) {
  if (mode === 'relative_1_30' || mode === 'relative_4_30') return { yMin: 0, yMax: 100, zeroLine: false };
  if (values.length === 0) return { yMin: -1, yMax: 1, zeroLine: true };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (mode === 'baseline_delta') {
    const maxAbs = Math.max(2, Math.abs(lo), Math.abs(hi));
    return { yMin: -maxAbs * 1.1, yMax: maxAbs * 1.1, zeroLine: true };
  }
  if (mode === 'baseline_zscore') {
    const maxAbs = Math.max(3, Math.abs(lo), Math.abs(hi));
    return { yMin: -maxAbs * 1.1, yMax: maxAbs * 1.1, zeroLine: true };
  }
  if (mode === 'smoothed') {
    const maxAbs = Math.max(1, Math.abs(lo), Math.abs(hi));
    return { yMin: -maxAbs * 1.1, yMax: maxAbs * 1.1, zeroLine: true };
  }
  if (lo >= 0) {
    const pad = Math.max(hi * 0.12, 0.1);
    return { yMin: 0, yMax: hi + pad, zeroLine: false };
  }
  if (hi <= 0) {
    const pad = Math.max(Math.abs(lo) * 0.12, 0.1);
    return { yMin: lo - pad, yMax: 0, zeroLine: false };
  }
  const pad = Math.max((hi - lo) * 0.15, 0.1);
  return { yMin: lo - pad, yMax: hi + pad, zeroLine: false };
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stabilizedRange(prev: PlotRange | null, next: PlotRange): PlotRange {
  if (!prev || prev.zeroLine !== next.zeroLine) return next;
  return {
    yMin: Math.min(prev.yMin, next.yMin),
    yMax: Math.max(prev.yMax, next.yMax),
    zeroLine: next.zeroLine,
  };
}

function thresholdAt(points: Array<{ x: number; value: number }> | undefined, x: number): number | null {
  if (!points || points.length === 0) return null;
  let best: { x: number; value: number } | null = null;
  for (const point of points) {
    if (point.x <= x && (!best || point.x > best.x)) best = point;
  }
  return best ? best.value : points[0].value;
}

function averageThreshold(points: Array<{ x: number; value: number }> | undefined, start: number, end: number): number | null {
  if (!points || points.length === 0) return null;
  const values = points
    .filter((point) => point.x > start && point.x <= end)
    .map((point) => point.value)
    .filter(Number.isFinite);
  if (values.length > 0) return average(values);
  return thresholdAt(points, end);
}

const BETA_PLUS_SUB_COLORS: Record<'Beta' | 'Hi-Beta', string> = {
  Beta: '#34d6ff',
  'Hi-Beta': '#ffea3d',
};

export function RollingBandDiagnostics({
  bands = ['Alpha', 'Theta', 'Beta'],
  initialMode = 'baseline_delta',
  thresholdSeries = [],
  defaultLiveWindowSec = 8,
  defaultBarWindowSec = 8,
  defaultHistoryWindowSec = 120,
  height = 320,
  title = 'Band Metric Diagnostics',
  showLiveChart = true,
  showTitle = true,
  combineHiBetaForBeta = false,
  pauseWhenNotRecording = false,
}: Props) {
  const metricsBatch = useDeviceStore((state) => state.metricsBatch);
  const appState = useDeviceStore((state) => state.appState);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<Sample[]>([]);
  const lastXRef = useRef(0);
  const rangeRef = useRef<PlotRange | null>(null);
  const rangeKeyRef = useRef('');
  const bandKeys = useMemo(() => bands, [bands.join('|')]);
  const [mode, setMode] = useState<BandMetricMode>(initialMode);
  const [liveWindowSec, setLiveWindowSec] = useState(defaultLiveWindowSec);
  const [barWindowSec, setBarWindowSec] = useState(defaultBarWindowSec);
  const [historyWindowSec, setHistoryWindowSec] = useState(defaultHistoryWindowSec);
  const [manualYMin, setManualYMin] = useState<number | null>(null);
  const [manualYMax, setManualYMax] = useState<number | null>(null);
  const [, forceRender] = useState(0);
  const size = useCanvasSize(800, height);
  const width = size.width;
  const recording = appState?.recording ?? false;
  const rangeKey = `${mode}|${bandKeys.join('|')}|${combineHiBetaForBeta}`;

  useEffect(() => {
    if (rangeKeyRef.current !== rangeKey) {
      rangeRef.current = null;
      rangeKeyRef.current = rangeKey;
    }
  }, [rangeKey]);

  useEffect(() => {
    if (pauseWhenNotRecording && !recording) {
      if (historyRef.current.length > 0 || lastXRef.current !== 0) {
        historyRef.current = [];
        lastXRef.current = 0;
        rangeRef.current = null;
        forceRender((count) => count + 1);
      }
      return;
    }
    if (metricsBatch.length === 0) return;
    let updated = false;
    for (const snap of metricsBatch) {
      if (snap.elapsed_sec + 1 < lastXRef.current) {
        historyRef.current = [];
        lastXRef.current = 0;
      }
      const x = snap.elapsed_sec > lastXRef.current ? snap.elapsed_sec : lastXRef.current + 0.25;
      lastXRef.current = x;
      historyRef.current = [
        ...historyRef.current.slice(-2400),
        {
          x,
          bands: bandKeys.reduce<Record<string, BandFeature>>((acc, band) => {
            if (snap.bands[band]) acc[band] = snap.bands[band];
            if (combineHiBetaForBeta && (band === 'Beta' || band === 'Beta+')) {
              if (snap.bands.Beta) acc.Beta = snap.bands.Beta;
              if (snap.bands['Hi-Beta']) acc['Hi-Beta'] = snap.bands['Hi-Beta'];
            }
            return acc;
          }, {}),
        },
      ];
      updated = true;
    }
    if (updated) forceRender((count) => count + 1);
  }, [bandKeys, metricsBatch, pauseWhenNotRecording, recording]);

  const samples = historyRef.current;
  const derived = useMemo(() => {
    if (samples.length === 0) {
      return {
        liveSamples: [] as Sample[],
        bars: [] as Bar[],
        range: rangeFor(mode, []),
        latest: 0,
      };
    }

    const latest = samples[samples.length - 1].x;
    const liveSamples = samples.filter((sample) => sample.x >= latest - liveWindowSec);
    const barStart = Math.max(0, latest - historyWindowSec);
    const thresholdByBand = new Map(thresholdSeries.map((series) => [series.band, series]));
    const bars: Bar[] = [];
    const firstEnd = Math.max(barStart + barWindowSec, Math.ceil(barStart / barWindowSec) * barWindowSec);
    for (let end = firstEnd; end <= latest + 0.001; end += barWindowSec) {
      const start = end - barWindowSec;
      const windowSamples = samples.filter((sample) => sample.x > start && sample.x <= end);
      if (windowSamples.length === 0) continue;
      bars.push({
        x: end,
        start,
        values: bandKeys.reduce<Record<string, number>>((acc, band) => {
          acc[band] = average(windowSamples.map((sample) => combinedHiBetaValue(sample.bands, band, mode, combineHiBetaForBeta)));
          return acc;
        }, {}),
        thresholds: bandKeys.reduce<Record<string, number | null>>((acc, band) => {
          acc[band] = averageThreshold(thresholdByBand.get(band)?.points, start, end);
          return acc;
        }, {}),
        subValues: bandKeys.reduce<Record<string, Record<string, number>>>((acc, band) => {
          if (combineHiBetaForBeta && (band === 'Beta' || band === 'Beta+')) {
            acc[band] = {
              Beta: average(windowSamples.map((sample) => valueFor(sample.bands.Beta, mode))),
              'Hi-Beta': average(windowSamples.map((sample) => valueFor(sample.bands['Hi-Beta'], mode))),
            };
          }
          return acc;
        }, {}),
      });
    }

    const liveValues = liveSamples.flatMap((sample) => bandKeys.map((band) => combinedHiBetaValue(sample.bands, band, mode, combineHiBetaForBeta)));
    const barValues = bars.flatMap((bar) => bandKeys.map((band) => bar.values[band] ?? 0));
    const thresholdValues = bars.flatMap((bar) => bandKeys
      .map((band) => bar.thresholds[band])
      .filter((value): value is number => value !== null && Number.isFinite(value)));
    const values = showLiveChart ? [...liveValues, ...barValues, ...thresholdValues] : [...barValues, ...thresholdValues];
    return {
      liveSamples,
      bars,
      range: rangeFor(mode, values),
      latest,
    };
  }, [bandKeys, barWindowSec, combineHiBetaForBeta, historyWindowSec, liveWindowSec, mode, samples, showLiveChart, thresholdSeries]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, width, height);

    const PAD = { top: showLiveChart ? 38 : 52, right: 18, bottom: 30, left: 56 };
    const plotW = Math.max(1, width - PAD.left - PAD.right);
    const availableH = Math.max(1, height - PAD.top - PAD.bottom);
    const gap = showLiveChart ? 24 : 0;
    const topH = showLiveChart ? Math.max(88, Math.floor((availableH - gap) * 0.44)) : 0;
    const bottomTop = showLiveChart ? PAD.top + topH + gap : PAD.top;
    const bottomH = Math.max(1, height - bottomTop - PAD.bottom);
    rangeRef.current = stabilizedRange(rangeRef.current, derived.range);
    const stableRange = rangeRef.current;
    const yMin = manualYMin ?? stableRange.yMin;
    const yMax = Math.max(yMin + 0.1, manualYMax ?? stableRange.yMax);
    const zeroLine = stableRange.zeroLine && yMin < 0 && yMax > 0;
    const ySpan = Math.max(1e-6, yMax - yMin);
    const liveXMin = Math.max(0, derived.latest - liveWindowSec);
    const liveXMax = Math.max(liveXMin + 1, derived.latest);
    const liveX = (value: number) => PAD.left + ((value - liveXMin) / Math.max(1e-6, liveXMax - liveXMin)) * plotW;
    const y = (top: number, blockHeight: number, value: number) =>
      top + blockHeight - ((value - yMin) / ySpan) * blockHeight;

    const drawBlock = (top: number, blockHeight: number, blockTitle: string) => {
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.textAlign = 'left';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(blockTitle, PAD.left, top - (showLiveChart ? 8 : 12));
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.34)';
      ctx.textAlign = 'right';
      ctx.font = '10px ui-monospace, monospace';
      for (let i = 0; i <= 4; i++) {
        const gy = top + (blockHeight * i) / 4;
        ctx.beginPath();
        ctx.moveTo(PAD.left, gy);
        ctx.lineTo(PAD.left + plotW, gy);
        ctx.stroke();
        const value = yMax - ((gy - top) / blockHeight) * (yMax - yMin);
        ctx.fillText(`${value >= 0 ? '+' : ''}${value.toFixed(1)}`, PAD.left - 5, gy + 3);
      }
      if (zeroLine) {
        const zeroY = y(top, blockHeight, 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(PAD.left, zeroY);
        ctx.lineTo(PAD.left + plotW, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    if (showTitle) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.textAlign = 'left';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(`${title} · ${BAND_METRIC_INFO[mode].shortLabel}`, PAD.left, 16);
    }

    if (showLiveChart) {
      drawBlock(PAD.top, topH, `Live (${liveWindowSec}s)`);
      if (derived.liveSamples.length === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.24)';
        ctx.textAlign = 'center';
        ctx.font = '13px ui-monospace, monospace';
        ctx.fillText('Waiting for live metrics…', width / 2, PAD.top + topH / 2);
      } else {
        bandKeys.forEach((band) => {
          ctx.strokeStyle = BAND_COLORS[band] ?? '#bbbbbb';
          ctx.lineWidth = 2;
          ctx.beginPath();
          derived.liveSamples.forEach((sample, index) => {
            const px = liveX(sample.x);
            const py = y(PAD.top, topH, combinedHiBetaValue(sample.bands, band, mode, combineHiBetaForBeta));
            if (index === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.stroke();
        });

        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.textAlign = 'center';
        ctx.font = '9px ui-monospace, monospace';
        for (let i = 0; i <= 4; i++) {
          const tick = liveXMin + ((liveXMax - liveXMin) * i) / 4;
          ctx.fillText(fmtTime(tick), liveX(tick), PAD.top + topH + 12);
        }
      }
    }

    drawBlock(bottomTop, bottomH, `Window Averages (${barWindowSec}s bars)`);
    if (derived.bars.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.24)';
      ctx.textAlign = 'center';
      ctx.font = '13px ui-monospace, monospace';
      ctx.fillText(`Waiting for ${barWindowSec}s window…`, width / 2, bottomTop + bottomH / 2);
    } else {
      const maxSlots = Math.max(1, Math.floor(historyWindowSec / barWindowSec));
      const visibleBars = derived.bars.slice(-maxSlots);
      const cellW = plotW / maxSlots;
      const gapW = Math.min(6, cellW * 0.08);
      const barW = Math.max(5, (Math.max(cellW - gapW * 2, 8) / bandKeys.length) - 2);
      const floorY = bottomTop + bottomH;
      visibleBars.forEach((bar, index) => {
        const slotIndex = maxSlots - visibleBars.length + index;
        const startX = PAD.left + slotIndex * cellW + gapW;
        bandKeys.forEach((band, bandIndex) => {
          const raw = bar.values[band] ?? 0;
          const barTop = y(bottomTop, bottomH, raw);
          const rectTop = Math.min(barTop, floorY);
          const rectH = Math.max(2, Math.abs(floorY - barTop));
          const x = startX + bandIndex * (barW + 2);
          ctx.fillStyle = BAND_COLORS[band] ?? '#bbbbbb';
          ctx.globalAlpha = 0.84;
          ctx.fillRect(x, rectTop, barW, rectH);
          ctx.globalAlpha = 1;
          if (combineHiBetaForBeta && (band === 'Beta' || band === 'Beta+')) {
            const sub = bar.subValues[band];
            if (sub) {
              const subBarW = Math.max(2, (barW - 3) / 2);
              (['Beta', 'Hi-Beta'] as const).forEach((subBand, subIndex) => {
                const subRaw = sub[subBand] ?? 0;
                const subTop = y(bottomTop, bottomH, subRaw);
                const subRectTop = Math.min(subTop, floorY);
                const subRectH = Math.max(2, Math.abs(floorY - subTop));
                ctx.fillStyle = BETA_PLUS_SUB_COLORS[subBand];
                ctx.globalAlpha = 1;
                ctx.fillRect(x + 1 + subIndex * (subBarW + 1), subRectTop, subBarW, subRectH);
              });
              ctx.globalAlpha = 1;
              ctx.strokeStyle = 'rgba(255,255,255,0.72)';
              ctx.lineWidth = 1;
              ctx.strokeRect(x + 0.5, Math.min(rectTop, floorY) + 0.5, barW - 1, Math.max(2, rectH - 1));
            }
          }
          const threshold = bar.thresholds[band];
          if (threshold !== null && Number.isFinite(threshold)) {
            const thresholdY = y(bottomTop, bottomH, threshold);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 2, thresholdY);
            ctx.lineTo(x + barW + 2, thresholdY);
            ctx.stroke();
          }
        });
      });

      const every = Math.max(1, Math.ceil(derived.bars.length / 6));
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.textAlign = 'center';
      ctx.font = '9px ui-monospace, monospace';
      visibleBars.forEach((bar, index) => {
        const sourceIndex = derived.bars.length - visibleBars.length + index;
        if (sourceIndex % every !== 0 && sourceIndex !== derived.bars.length - 1) return;
        const slotIndex = maxSlots - visibleBars.length + index;
        ctx.fillText(fmtTime(bar.x), PAD.left + slotIndex * cellW + cellW * 0.5, height - 8);
      });
    }

    let legendX = PAD.left + 6;
    const legendY = showLiveChart ? 22 : 14;
    ctx.textAlign = 'left';
    ctx.font = '10px ui-monospace, monospace';
    bandKeys.forEach((band) => {
      const color = BAND_COLORS[band] ?? '#bbbbbb';
      ctx.fillStyle = color;
      ctx.fillRect(legendX, legendY, 12, 2);
      ctx.fillStyle = color;
      ctx.fillText(band, legendX + 16, legendY + 4);
      legendX += ctx.measureText(band).width + 28;
    });
  }, [bandKeys, barWindowSec, combineHiBetaForBeta, derived, height, historyWindowSec, liveWindowSec, manualYMax, manualYMin, mode, showLiveChart, showTitle, thresholdSeries, title, width]);

  const settings = (
    <>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em' }}>Diagnostics Settings</div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.85em' }}>
        <span style={{ color: 'var(--muted)' }}>Measure</span>
        <select value={mode} onChange={(event) => setMode(event.target.value as BandMetricMode)}>
          {BAND_METRIC_OPTIONS.map(([key, info]) => (
            <option key={key} value={key}>{info.label}</option>
          ))}
        </select>
      </label>
      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
        {BAND_METRIC_INFO[mode].description}
      </div>
      {combineHiBetaForBeta && (
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          Beta here is combined Beta + Hi-Beta so it matches the threshold calculation.
        </div>
      )}
      {showLiveChart && (
        <Slider
          label="Live window"
          min={4}
          max={30}
          step={1}
          value={liveWindowSec}
          onChange={setLiveWindowSec}
          format={(value) => `${value}s`}
        />
      )}
      <Slider
        label="Bar window"
        min={2}
        max={30}
        step={1}
        value={barWindowSec}
        onChange={setBarWindowSec}
        format={(value) => `${value}s`}
      />
      <Slider
        label="History span"
        min={30}
        max={300}
        step={10}
        value={historyWindowSec}
        onChange={setHistoryWindowSec}
        format={(value) => value < 60 ? `${value}s` : `${(value / 60).toFixed(1)}m`}
      />
      <Slider
        label="Y min"
        min={-8}
        max={8}
        step={0.1}
        value={manualYMin ?? rangeRef.current?.yMin ?? -1}
        onChange={setManualYMin}
        format={(value) => value.toFixed(1)}
      />
      <Slider
        label="Y max"
        min={-8}
        max={8}
        step={0.1}
        value={manualYMax ?? rangeRef.current?.yMax ?? 1}
        onChange={setManualYMax}
        format={(value) => value.toFixed(1)}
      />
      <button
        type="button"
        onClick={() => { setManualYMin(null); setManualYMax(null); }}
        style={{
          alignSelf: 'flex-start',
          border: '1px solid var(--border)',
          background: 'transparent',
          color: 'var(--muted)',
          borderRadius: 4,
          padding: '4px 7px',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        Auto Y
      </button>
    </>
  );

  return (
    <ComponentSettings settings={settings}>
      <div ref={size.wrapRef} style={{ width: '100%', height }}>
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      </div>
    </ComponentSettings>
  );
}
