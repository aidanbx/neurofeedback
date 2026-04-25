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

interface Props {
  bands?: string[];
  initialMode?: BandMetricMode;
  defaultLiveWindowSec?: number;
  defaultBarWindowSec?: number;
  defaultHistoryWindowSec?: number;
  height?: number;
  title?: string;
  showLiveChart?: boolean;
  showTitle?: boolean;
}

function valueFor(feature: BandFeature | undefined, mode: BandMetricMode): number {
  return Number(feature?.[mode] ?? 0);
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

export function RollingBandDiagnostics({
  bands = ['Alpha', 'Theta', 'Beta'],
  initialMode = 'baseline_delta',
  defaultLiveWindowSec = 8,
  defaultBarWindowSec = 8,
  defaultHistoryWindowSec = 120,
  height = 320,
  title = 'Band Metric Diagnostics',
  showLiveChart = true,
  showTitle = true,
}: Props) {
  const metricsBatch = useDeviceStore((state) => state.metricsBatch);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<Sample[]>([]);
  const lastXRef = useRef(0);
  const bandKeys = useMemo(() => bands, [bands.join('|')]);
  const [mode, setMode] = useState<BandMetricMode>(initialMode);
  const [liveWindowSec, setLiveWindowSec] = useState(defaultLiveWindowSec);
  const [barWindowSec, setBarWindowSec] = useState(defaultBarWindowSec);
  const [historyWindowSec, setHistoryWindowSec] = useState(defaultHistoryWindowSec);
  const [, forceRender] = useState(0);
  const size = useCanvasSize(800, height);
  const width = size.width;

  useEffect(() => {
    if (metricsBatch.length === 0) return;
    let updated = false;
    for (const snap of metricsBatch) {
      const x = snap.elapsed_sec > lastXRef.current ? snap.elapsed_sec : lastXRef.current + 0.25;
      lastXRef.current = x;
      historyRef.current = [
        ...historyRef.current.slice(-2400),
        {
          x,
          bands: bandKeys.reduce<Record<string, BandFeature>>((acc, band) => {
            if (snap.bands[band]) acc[band] = snap.bands[band];
            return acc;
          }, {}),
        },
      ];
      updated = true;
    }
    if (updated) forceRender((count) => count + 1);
  }, [bandKeys, metricsBatch]);

  const samples = historyRef.current;
  const derived = useMemo(() => {
    if (samples.length === 0) {
      return {
        liveSamples: [] as Sample[],
        bars: [] as Array<{ x: number; values: Record<string, number> }>,
        range: rangeFor(mode, []),
        latest: 0,
      };
    }

    const latest = samples[samples.length - 1].x;
    const liveSamples = samples.filter((sample) => sample.x >= latest - liveWindowSec);
    const barStart = Math.max(0, latest - historyWindowSec);
    const bars: Array<{ x: number; values: Record<string, number> }> = [];
    const firstEnd = Math.max(barStart + barWindowSec, Math.ceil(barStart / barWindowSec) * barWindowSec);
    for (let end = firstEnd; end <= latest + 0.001; end += barWindowSec) {
      const windowSamples = samples.filter((sample) => sample.x > end - barWindowSec && sample.x <= end);
      if (windowSamples.length === 0) continue;
      bars.push({
        x: end,
        values: bandKeys.reduce<Record<string, number>>((acc, band) => {
          acc[band] = average(windowSamples.map((sample) => valueFor(sample.bands[band], mode)));
          return acc;
        }, {}),
      });
    }

    const values = [
      ...liveSamples.flatMap((sample) => bandKeys.map((band) => valueFor(sample.bands[band], mode))),
      ...bars.flatMap((bar) => bandKeys.map((band) => bar.values[band] ?? 0)),
    ];
    return {
      liveSamples,
      bars,
      range: rangeFor(mode, values),
      latest,
    };
  }, [bandKeys, barWindowSec, historyWindowSec, liveWindowSec, mode, samples]);

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

    const PAD = { top: 38, right: 18, bottom: 30, left: 56 };
    const plotW = Math.max(1, width - PAD.left - PAD.right);
    const availableH = Math.max(1, height - PAD.top - PAD.bottom);
    const gap = showLiveChart ? 24 : 0;
    const topH = showLiveChart ? Math.max(88, Math.floor((availableH - gap) * 0.44)) : 0;
    const bottomTop = showLiveChart ? PAD.top + topH + gap : PAD.top;
    const bottomH = Math.max(1, height - bottomTop - PAD.bottom);
    const { yMin, yMax, zeroLine } = derived.range;
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
      ctx.fillText(blockTitle, PAD.left, top - 8);
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
      if (zeroLine && yMin < 0 && yMax > 0) {
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
            const py = y(PAD.top, topH, valueFor(sample.bands[band], mode));
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
      const cellW = plotW / Math.max(derived.bars.length, 1);
      const gapW = Math.min(6, cellW * 0.08);
      const barW = Math.max(5, (Math.max(cellW - gapW * 2, 8) / bandKeys.length) - 2);
      const zeroY = y(bottomTop, bottomH, 0);
      derived.bars.forEach((bar, index) => {
        const startX = PAD.left + index * cellW + gapW;
        bandKeys.forEach((band, bandIndex) => {
          const raw = bar.values[band] ?? 0;
          const barTop = y(bottomTop, bottomH, raw);
          const rectTop = Math.min(barTop, zeroY);
          const rectH = Math.max(2, Math.abs(zeroY - barTop));
          ctx.fillStyle = BAND_COLORS[band] ?? '#bbbbbb';
          ctx.globalAlpha = 0.84;
          ctx.fillRect(startX + bandIndex * (barW + 2), rectTop, barW, rectH);
          ctx.globalAlpha = 1;
        });
      });

      const every = Math.max(1, Math.ceil(derived.bars.length / 6));
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.textAlign = 'center';
      ctx.font = '9px ui-monospace, monospace';
      derived.bars.forEach((bar, index) => {
        if (index % every !== 0 && index !== derived.bars.length - 1) return;
        ctx.fillText(fmtTime(bar.x), PAD.left + index * cellW + cellW * 0.5, height - 8);
      });
    }

    let legendX = PAD.left + 6;
    ctx.textAlign = 'left';
    ctx.font = '10px ui-monospace, monospace';
    bandKeys.forEach((band) => {
      const color = BAND_COLORS[band] ?? '#bbbbbb';
      ctx.fillStyle = color;
      ctx.fillRect(legendX, 22, 12, 2);
      ctx.fillStyle = color;
      ctx.fillText(band, legendX + 16, 26);
      legendX += ctx.measureText(band).width + 28;
    });
  }, [bandKeys, derived, height, liveWindowSec, mode, showLiveChart, showTitle, title, width]);

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
