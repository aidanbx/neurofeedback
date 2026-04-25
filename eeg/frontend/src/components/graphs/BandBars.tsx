import { useEffect, useRef } from 'react';
import type { BandFeature } from '../../contracts';

export const BAND_COLORS: Record<string, string> = {
  Delta:    '#7777dd',
  Theta:    '#55bb88',
  Alpha:    '#f0cc44',
  SMR:      '#f08030',
  Beta:     '#e05050',
  'Hi-Beta':'#cc55dd',
};

const SPARKLINE_W = 70;
const SPARKLINE_H = 24;
const MAX_SPARK   = 80;

export type BandMetricMode = 'relative_1_30' | 'relative_4_30' | 'baseline_delta' | 'baseline_zscore' | 'log_absolute' | 'absolute' | 'smoothed';

export const BAND_METRIC_INFO: Record<BandMetricMode, { label: string; shortLabel: string; description: string; unit: string }> = {
  relative_1_30: {
    label: 'Relative 1-30 Hz',
    shortLabel: 'relative',
    description: 'Percent of total 1-30 Hz band power, including Delta.',
    unit: '%',
  },
  relative_4_30: {
    label: 'Relative 4-30 Hz',
    shortLabel: 'relative',
    description: 'Percent of training-band power from 4-30 Hz. Bands add to about 100%.',
    unit: '%',
  },
  baseline_delta: {
    label: 'Baseline delta',
    shortLabel: 'baseline Δ',
    description: 'Natural-log band power minus that band\'s own rolling baseline. 0 means baseline.',
    unit: 'ln',
  },
  baseline_zscore: {
    label: 'Baseline z-score',
    shortLabel: 'z-score',
    description: 'Baseline delta divided by robust baseline spread. 0 means baseline.',
    unit: 'z',
  },
  log_absolute: {
    label: 'Log absolute power',
    shortLabel: 'log abs',
    description: 'Natural log of integrated band power.',
    unit: 'ln µV²',
  },
  absolute: {
    label: 'Absolute power',
    shortLabel: 'absolute',
    description: 'Integrated PSD power in the band.',
    unit: 'µV²',
  },
  smoothed: {
    label: 'Smoothed active metric',
    shortLabel: 'smoothed',
    description: 'The backend-selected metric after asymmetric smoothing.',
    unit: '',
  },
};

export const BAND_METRIC_OPTIONS = Object.entries(BAND_METRIC_INFO) as [BandMetricMode, typeof BAND_METRIC_INFO[BandMetricMode]][];

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c || values.length < 2) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    c.width = SPARKLINE_W; c.height = SPARKLINE_H;
    ctx.fillStyle = '#0d0d14'; ctx.fillRect(0, 0, SPARKLINE_W, SPARKLINE_H);
    const mn = Math.min(...values), mx = Math.max(...values), sp = mx - mn || 1;
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1;
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * SPARKLINE_W;
      const y = SPARKLINE_H - ((v - mn) / sp) * (SPARKLINE_H - 2) - 1;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [values, color]);
  return <canvas ref={ref} style={{ display: 'block', width: SPARKLINE_W, height: SPARKLINE_H }} />;
}

interface Props {
  bands: Record<string, BandFeature>;
  mode?: BandMetricMode;
  showSparklines?: boolean;
}

function valueFor(feat: BandFeature, mode: BandMetricMode): number {
  return Number(feat[mode] ?? 0);
}

function formatBandValue(v: number, mode: BandMetricMode): string {
  if (mode === 'relative_1_30' || mode === 'relative_4_30') return `${v.toFixed(1)}%`;
  if (mode === 'absolute') return v >= 10 ? v.toFixed(1) : v.toFixed(3);
  return v.toFixed(2);
}

function barPct(v: number, mode: BandMetricMode, vals: number[]): number {
  if (mode === 'relative_1_30' || mode === 'relative_4_30') return Math.max(0, Math.min(100, v));
  const maxV = Math.max(...vals.map((n) => Math.abs(n)), 1e-9);
  return Math.max(0, Math.min(100, (Math.max(v, 0) / maxV) * 100));
}

function signedScale(mode: BandMetricMode, vals: number[]): number {
  if (mode === 'baseline_delta') return Math.max(2, ...vals.map((n) => Math.abs(n)));
  if (mode === 'baseline_zscore') return Math.max(3, ...vals.map((n) => Math.abs(n)));
  if (mode === 'smoothed') return Math.max(1, ...vals.map((n) => Math.abs(n)));
  return 1;
}

function isSignedMode(mode: BandMetricMode): boolean {
  return mode === 'baseline_delta' || mode === 'baseline_zscore' || mode === 'smoothed';
}

export function BandBars({ bands, mode = 'relative_1_30', showSparklines = true }: Props) {
  const histRef = useRef<Map<string, number[]>>(new Map());

  const entries = Object.entries(bands);
  const vals    = entries.map(([, f]) => valueFor(f, mode));
  const signed = isSignedMode(mode);
  const scale = signedScale(mode, vals);

  // Update sparkline history
  entries.forEach(([name, feat]) => {
    const v = valueFor(feat, mode);
    const hist = histRef.current.get(name) ?? [];
    const next = [...hist, v].slice(-MAX_SPARK);
    histRef.current.set(name, next);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {entries.map(([name, feat]) => {
        const v     = valueFor(feat, mode);
        const pct   = barPct(v, mode, vals);
        const signedPct = Math.min(50, (Math.abs(v) / scale) * 50);
        const signedLeft = v >= 0 ? 50 : 50 - signedPct;
        const color = BAND_COLORS[name] ?? '#888';
        const hist  = histRef.current.get(name) ?? [];
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8em' }}>
            <span style={{ width: 50, color, fontWeight: 600, flexShrink: 0 }}>{name}</span>
            <div style={{ flex: 1, position: 'relative', background: '#1e1e2c', height: 10, borderRadius: 2, minWidth: 40, overflow: 'hidden' }}>
              {signed && <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#55556a' }} />}
              <div
                style={{
                  position: signed ? 'absolute' : 'static',
                  left: signed ? `${signedLeft}%` : undefined,
                  width: `${signed ? signedPct : pct}%`,
                  height: '100%',
                  background: color,
                  borderRadius: 2,
                  transition: 'width 0.25s, left 0.25s',
                }}
              />
            </div>
            <span style={{ width: 66, textAlign: 'right', color: '#aaa', flexShrink: 0 }}>{formatBandValue(v, mode)}</span>
            {showSparklines && (
              <div style={{ flexShrink: 0 }}>
                <Sparkline values={hist} color={color} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
