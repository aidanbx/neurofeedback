import React from 'react';
import type { BandFeature } from '../../contracts';

const BAND_COLORS: Record<string, string> = {
  Delta:    '#7777dd',
  Theta:    '#55bb88',
  Alpha:    '#f0cc44',
  SMR:      '#f08030',
  Beta:     '#e05050',
  'Hi-Beta':'#cc55dd',
};

interface Props {
  bands: Record<string, BandFeature>;
  mode?: 'smoothed' | 'baseline_delta' | 'absolute';
}

export function BandBars({ bands, mode = 'smoothed' }: Props) {
  const entries = Object.entries(bands).filter(([n]) => n !== 'Delta');
  const vals    = entries.map(([, f]) => f[mode] as number);
  const minV    = Math.min(...vals);
  const maxV    = Math.max(...vals);
  const span    = maxV - minV || 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {entries.map(([name, feat]) => {
        const v    = feat[mode] as number;
        const pct  = Math.max(0, Math.min(100, ((v - minV) / span) * 100));
        const color = BAND_COLORS[name] ?? '#888';
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8em' }}>
            <span style={{ width: 48, color, fontWeight: 600 }}>{name}</span>
            <div style={{ flex: 1, background: '#1e1e2c', height: 10, borderRadius: 2 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
            </div>
            <span style={{ width: 40, textAlign: 'right', color: '#aaa' }}>{v.toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );
}
