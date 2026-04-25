import { useEffect, useRef, useState } from 'react';
import type { AppState, MetricsSnapshot } from '../../contracts';
import { useDeviceStore } from '../../state/deviceStore';
import { Panel } from '../layout/Panel';
import { PSDPlot } from '../graphs/PSDPlot';
import { TimelineChart } from '../graphs/TimelineChart';
import { StatsGrid } from '../session/StatsGrid';
import { SignalControls } from './SignalControls';

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
  appState: AppState | null;
}

export function SignalPanel({ metrics, appState }: Props) {
  const metricsBatch    = useDeviceStore((s) => s.metricsBatch);
  const qualityHistoryRef = useRef<Pt[]>([]);
  const qualityXRef       = useRef(0);
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
  const diagStats = [
    { label: 'Quality score', value: `${metrics.quality_score.toFixed(0)}`, color: qualColor(metrics.quality_score, 70, 40) },
    { label: 'Artifact frac', value: `${(metrics.artifact_fraction * 100).toFixed(0)}%`, color: qualColor(metrics.artifact_fraction, 0.05, 0.2, true) },
    { label: 'Common corr', value: `${(commonModeCorr * 100).toFixed(0)}%`, color: qualColor(commonModeCorr, 0.25, 0.55, true) },
    { label: 'Slow waves', value: `${(slowWaveRatio * 100).toFixed(0)}%`, color: qualColor(slowWaveRatio, 0.25, 0.55, true) },
    { label: '60Hz noise', value: `${(lineNoiseRatio * 100).toFixed(0)}%`, color: qualColor(lineNoiseRatio, 0.08, 0.25, true) },
    { label: 'Notch', value: appState?.notch_60hz ? 'on' : 'off', color: appState?.notch_60hz ? 'var(--fair)' : 'var(--good)' },
  ];

  return (
    <Panel title="Signal">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SignalControls appState={appState} />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 0.8fr) minmax(0, 1.2fr)', gap: 10 }}>
          <div>
            <StatsGrid stats={diagStats} />
            <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 11, lineHeight: 1.6 }}>
              60Hz noise is calculated from the raw unnotched diagnostic PSD. The grey PSD trace is raw before notch; the blue trace is the currently processed signal.
            </div>
          </div>
          <PSDPlot
            freqs={metrics.psd_freqs}
            values={metrics.psd_values}
            referenceFreqs={metrics.raw_psd_freqs}
            referenceValues={metrics.raw_psd_values}
            referenceLabel="raw before notch"
            height={220}
            maxFreq={70}
          />
        </div>
        <TimelineChart
          series={[{ label: 'Quality', color: '#88aaff', points: qualityHistory, threshold: 55 }]}
          height={170}
          windowSec={120}
          yMin={0}
          yMax={100}
        />
      </div>
    </Panel>
  );
}
