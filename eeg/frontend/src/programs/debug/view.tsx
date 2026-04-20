import { useDeviceStore } from '../../state/deviceStore';
import { ProgramLayout } from '../ProgramLayout';
import { Panel } from '../../components/layout/Panel';
import { BandBars } from '../../components/graphs/BandBars';
import { PSDPlot } from '../../components/graphs/PSDPlot';
import { Waveform } from '../../components/graphs/Waveform';
import { StatsGrid } from '../../components/session/StatsGrid';
import { SessionControls } from '../../components/session/SessionControls';
import { Section } from '../../components/controls/Section';

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

export default function DebugView() {
  const metrics = useDeviceStore((s) => s.metrics);

  const diagStats = metrics ? [
    { label: 'Quality score', value: `${metrics.quality_score.toFixed(0)}`, color: qualColor(metrics.quality_score, 70, 40) },
    { label: 'Artifact frac', value: `${(metrics.artifact_fraction * 100).toFixed(0)}%`, color: qualColor(metrics.artifact_fraction, 0.05, 0.2, true) },
    { label: 'Quality',       value: metrics.quality_label.toUpperCase(), color: `var(--${metrics.quality_label === 'good' ? 'good' : metrics.quality_label === 'fair' ? 'fair' : 'poor'})` },
  ] : [];

  const main = (
    <>
      {metrics ? (
        <>
          <Panel title="EEG Waveform">
            <Waveform t={metrics.live_trace_t} y={metrics.live_trace_y} width={700} height={160} />
          </Panel>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Panel title="Band Power">
              <BandBars bands={metrics.bands} mode="smoothed" />
            </Panel>
            <Panel title="Signal Diagnostics">
              <StatsGrid stats={diagStats} />
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {Object.entries(metrics.bands).filter(([n]) => n !== 'Delta').map(([name, feat]) => {
                  const color = feat.baseline_ready ? 'var(--good)' : 'var(--muted)';
                  return (
                    <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
                      <span>{name}</span>
                      <span>abs={feat.absolute.toFixed(3)}</span>
                      <span style={{ color }}>n={feat.baseline_n}/{feat.baseline_n_needed}</span>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          <Panel title="Power Spectral Density">
            <PSDPlot freqs={metrics.psd_freqs} values={metrics.psd_values} width={700} height={180} />
          </Panel>
        </>
      ) : (
        <div style={{ color: 'var(--muted)', padding: 24 }}>Waiting for signal…</div>
      )}
    </>
  );

  const sidebar = (
    <>
      <Section title="Connection">
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.8 }}>
          Connect a device or enable Test Mode to stream data. The debug view shows raw signal diagnostics without any program-specific processing.
        </div>
      </Section>

      {metrics && (
        <Section title="Baseline">
          {Object.entries(metrics.bands).map(([name, feat]) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
              <span style={{ color: 'var(--muted)' }}>{name}</span>
              <div style={{ flex: 1, margin: '0 8px', background: '#1e1e2c', height: 3, borderRadius: 1 }}>
                <div style={{ width: `${Math.min(100, (feat.baseline_n / (feat.baseline_n_needed || 1)) * 100)}%`, height: '100%', background: feat.baseline_ready ? 'var(--good)' : 'var(--accent)', borderRadius: 1 }} />
              </div>
              <span style={{ color: feat.baseline_ready ? 'var(--good)' : 'var(--muted)' }}>
                {feat.baseline_ready ? 'ready' : `${feat.baseline_n}/${feat.baseline_n_needed}`}
              </span>
            </div>
          ))}
        </Section>
      )}

      <SessionControls programId="debug" programTitle="Debug" />
    </>
  );

  return (
    <ProgramLayout
      title="Debug"
      mode="signal diagnostics"
      main={main}
      sidebar={sidebar}
    />
  );
}
