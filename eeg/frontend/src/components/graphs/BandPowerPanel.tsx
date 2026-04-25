import { useEffect, useRef, useState } from 'react';
import type { MetricsSnapshot } from '../../contracts';
import { useDeviceStore } from '../../state/deviceStore';
import { BandBars, BAND_COLORS, BAND_METRIC_INFO, BAND_METRIC_OPTIONS, type BandMetricMode } from './BandBars';
import { TimelineChart, type Series } from './TimelineChart';
import { ComponentSettings } from '../controls/ComponentSettings';
import { Slider } from '../controls/Slider';

type Pt = { x: number; y: number };

interface Props {
  initialMode?: BandMetricMode;
  timelineHeight?: number;
}

const DISPLAY_BANDS = ['Delta', 'Theta', 'Alpha', 'SMR', 'Beta', 'Hi-Beta'];

function valueFor(snap: MetricsSnapshot, name: string, mode: BandMetricMode): number {
  return Number(snap.bands[name]?.[mode] ?? 0);
}

function rangeFor(mode: BandMetricMode, points: Pt[]) {
  if (mode === 'relative_1_30' || mode === 'relative_4_30') return { yMin: 0, yMax: 100, zeroLine: false };
  if (points.length === 0) return { yMin: 0, yMax: 1, zeroLine: false };
  const values = points.map((p) => p.y);
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

export function BandPowerPanel({ initialMode = 'relative_1_30', timelineHeight = 220 }: Props) {
  const metricsBatch = useDeviceStore((s) => s.metricsBatch);
  const metrics      = useDeviceStore((s) => s.metrics);

  const [mode, setMode]           = useState<BandMetricMode>(initialMode);
  const [showSparklines, setShowSparklines] = useState(true);
  const [windowSec, setWindowSec] = useState(120);
  const [smoothing, setSmoothing] = useState(0.4);

  const historyRef = useRef<Record<string, Pt[]>>({});
  const lastXRef   = useRef(0);
  const [, forceRender] = useState(0);

  useEffect(() => {
    historyRef.current = {};
    lastXRef.current = 0;
    forceRender((n) => n + 1);
  }, [mode]);

  useEffect(() => {
    if (metricsBatch.length === 0) return;
    let updated = false;
    for (const snap of metricsBatch) {
      const x = snap.elapsed_sec > lastXRef.current ? snap.elapsed_sec : lastXRef.current + 0.25;
      lastXRef.current = x;
      DISPLAY_BANDS.forEach((name) => {
        if (!snap.bands[name]) return;
        const hist = historyRef.current[name] ?? [];
        const prev = hist[hist.length - 1];
        if (prev && Math.abs(prev.x - x) < 0.001) return;
        historyRef.current[name] = [...hist.slice(-600), { x, y: valueFor(snap, name, mode) }];
      });
      updated = true;
    }
    if (updated) forceRender((n) => n + 1);
  }, [metricsBatch, mode]);

  const series: Series[] = DISPLAY_BANDS
    .map((name) => ({
      label: name,
      color: BAND_COLORS[name] ?? '#888',
      points: historyRef.current[name] ?? [],
    }))
    .filter((s) => s.points.length > 0);

  const allPoints = series.flatMap((s) => s.points);
  const range = rangeFor(mode, allPoints);
  const info = BAND_METRIC_INFO[mode];

  const barsSettings = (
    <>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em' }}>Band Bars Settings</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85em', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showSparklines}
          onChange={(e) => setShowSparklines(e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <span style={{ color: 'var(--muted)' }}>Show sparklines</span>
      </label>
    </>
  );

  const timelineSettings = (
    <>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em' }}>Timeline Settings</div>
      <Slider
        label="Window"
        min={10} max={600} step={10}
        value={windowSec}
        onChange={setWindowSec}
        format={(v) => v < 60 ? `${v}s` : `${(v / 60).toFixed(1)}m`}
      />
      <Slider
        label="Smoothing"
        min={0} max={0.95} step={0.05}
        value={smoothing}
        onChange={setSmoothing}
        format={(v) => v === 0 ? 'off' : v.toFixed(2)}
      />
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 220px) 1fr', gap: 8, alignItems: 'start' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>Measure</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as BandMetricMode)}>
            {BAND_METRIC_OPTIONS.map(([key, item]) => (
              <option key={key} value={key}>{item.label}</option>
            ))}
          </select>
        </label>
        <div style={{ color: 'var(--muted)', fontSize: 11, lineHeight: 1.5 }}>
          {info.description} {info.unit && <span>Unit: {info.unit}.</span>}
        </div>
      </div>

      {metrics && (
        <ComponentSettings settings={barsSettings}>
          <BandBars bands={metrics.bands} mode={mode} showSparklines={showSparklines} />
        </ComponentSettings>
      )}

      <ComponentSettings settings={timelineSettings}>
        <TimelineChart
          series={series}
          height={timelineHeight}
          windowSec={windowSec}
          yMin={range.yMin}
          yMax={range.yMax}
          zeroLine={range.zeroLine}
          smoothingFactor={smoothing}
        />
      </ComponentSettings>
    </div>
  );
}
