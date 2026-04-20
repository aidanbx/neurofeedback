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
  mode?: 'smoothed' | 'baseline_delta' | 'absolute';
}

export function BandBars({ bands, mode = 'smoothed' }: Props) {
  const histRef = useRef<Map<string, number[]>>(new Map());

  const entries = Object.entries(bands).filter(([n]) => n !== 'Delta');
  const vals    = entries.map(([, f]) => f[mode] as number);
  const minV    = Math.min(...vals);
  const maxV    = Math.max(...vals);
  const span    = maxV - minV || 1;

  // Update sparkline history
  entries.forEach(([name, feat]) => {
    const v = feat[mode] as number;
    const hist = histRef.current.get(name) ?? [];
    const next = [...hist, v].slice(-MAX_SPARK);
    histRef.current.set(name, next);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {entries.map(([name, feat]) => {
        const v     = feat[mode] as number;
        const pct   = Math.max(0, Math.min(100, ((v - minV) / span) * 100));
        const color = BAND_COLORS[name] ?? '#888';
        const hist  = histRef.current.get(name) ?? [];
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8em' }}>
            <span style={{ width: 50, color, fontWeight: 600, flexShrink: 0 }}>{name}</span>
            <div style={{ flex: 1, background: '#1e1e2c', height: 10, borderRadius: 2, minWidth: 40 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.25s' }} />
            </div>
            <span style={{ width: 44, textAlign: 'right', color: '#aaa', flexShrink: 0 }}>{v.toFixed(2)}</span>
            <div style={{ flexShrink: 0 }}>
              <Sparkline values={hist} color={color} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
