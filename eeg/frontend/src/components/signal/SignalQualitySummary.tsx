import { useEffect, useRef, useState } from 'react';
import type { MetricsSnapshot } from '../../contracts';
import { useDeviceStore } from '../../state/deviceStore';
import { TimelineChart } from '../graphs/TimelineChart';

type Pt = { x: number; y: number };

function qualColor(v: number, good: number, fair: number, invert = false) {
  if (invert) {
    if (v <= good) return 'var(--good)';
    if (v <= fair) return 'var(--fair)';
    return 'var(--poor)';
  }
  if (v >= good) return 'var(--good)';
  if (v >= fair) return 'var(--fair)';
  return 'var(--poor)';
}

interface Props {
  metrics: MetricsSnapshot;
  showTimeline?: boolean;
}

export function SignalQualitySummary({ metrics, showTimeline = true }: Props) {
  const metricsBatch = useDeviceStore((s) => s.metricsBatch);
  const qualityHistoryRef = useRef<Pt[]>([]);
  const qualityXRef = useRef(0);
  const [qualityHistory, setQualityHistory] = useState<Pt[]>([]);

  useEffect(() => {
    if (metricsBatch.length === 0) return;
    for (const snap of metricsBatch) {
      const x = snap.elapsed_sec > qualityXRef.current ? snap.elapsed_sec : qualityXRef.current + 0.25;
      qualityXRef.current = x;
      qualityHistoryRef.current = [...qualityHistoryRef.current.slice(-300), { x, y: snap.quality_score }];
    }
    setQualityHistory([...qualityHistoryRef.current]);
  }, [metricsBatch]);

  const commonModeCorr = metrics.common_mode_corr ?? 0;
  const slowWaveRatio = metrics.slow_wave_ratio ?? 0;
  const lineNoiseRatio = metrics.line_noise_ratio ?? 0;
  const stats = [
    { label: 'Quality', value: `${metrics.quality_score.toFixed(0)} ${metrics.quality_label}`, color: qualColor(metrics.quality_score, 70, 40) },
    { label: 'Common corr', value: `${(commonModeCorr * 100).toFixed(0)}%`, color: qualColor(commonModeCorr, 0.25, 0.55, true) },
    { label: 'Slow waves', value: `${(slowWaveRatio * 100).toFixed(0)}%`, color: qualColor(slowWaveRatio, 0.25, 0.55, true) },
    { label: '60Hz noise', value: `${(lineNoiseRatio * 100).toFixed(0)}%`, color: qualColor(lineNoiseRatio, 0.08, 0.25, true) },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {stats.map((stat) => (
          <div
            key={stat.label}
            style={{
              flex: '1 1 118px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              padding: '5px 7px',
              minWidth: 0,
            }}
          >
            <div style={{ color: 'var(--muted)', fontSize: 9, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
              {stat.label}
            </div>
            <div style={{ color: stat.color, fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>
      {showTimeline && (
        <TimelineChart
          series={[{ label: 'Quality', color: '#88aaff', points: qualityHistory, threshold: 55 }]}
          height={86}
          windowSec={120}
          yMin={0}
          yMax={100}
        />
      )}
    </div>
  );
}
