import { useEffect, useRef, useState } from 'react';
import { useDeviceStore } from '../../state/deviceStore';
import { useProgramStore } from '../../state/programStore';
import { api } from '../../api/client';
import { ProgramLayout } from '../ProgramLayout';
import { Panel } from '../../components/layout/Panel';
import { AudioTrackPlayer } from '../../components/audio/AudioTrackPlayer';
import { BandBars } from '../../components/graphs/BandBars';
import { PSDPlot } from '../../components/graphs/PSDPlot';
import { Waveform } from '../../components/graphs/Waveform';
import { TimelineChart } from '../../components/graphs/TimelineChart';
import { StatsGrid } from '../../components/session/StatsGrid';
import { SessionControls } from '../../components/session/SessionControls';
import { Section } from '../../components/controls/Section';
import { ProgramParamButton, ProgramParamSlider } from '../../components/controls/Instrumented';

type Pt = { x: number; y: number };

interface DebugPayload {
  eyes_closed: boolean;
  debug_gain: number;
  marker_level: number;
  debug_mode: string;
  alpha_smoothed: number;
  beta_smoothed: number;
  baseline_ready_count: number;
}

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
  const programOutput = useProgramStore((s) => s.programOutput);
  const payload = programOutput?.payload as DebugPayload | undefined;
  const [params, setParams] = useState<Record<string, unknown>>({
    eyes_closed: false,
    debug_gain: 1,
    marker_level: 50,
    debug_mode: 'observe',
  });
  const qualityHistoryRef = useRef<Pt[]>([]);
  const [qualityHistory, setQualityHistory] = useState<Pt[]>([]);

  const mergeParams = (next: Record<string, unknown>) => setParams((prev) => ({ ...prev, ...next }));
  const paramNumber = (key: string, fallback: number) => {
    const value = params[key];
    return typeof value === 'number' ? value : fallback;
  };
  const paramBool = (key: string, fallback: boolean) => {
    const value = params[key];
    return typeof value === 'boolean' ? value : fallback;
  };
  const paramString = (key: string, fallback: string) => {
    const value = params[key];
    return typeof value === 'string' ? value : fallback;
  };

  useEffect(() => {
    api.getProgramParams('debug')
      .then((res) => setParams(res.params))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!programOutput || !metrics) return;
    qualityHistoryRef.current = [
      ...qualityHistoryRef.current.slice(-300),
      { x: programOutput.elapsed, y: metrics.quality_score },
    ];
    setQualityHistory([...qualityHistoryRef.current]);
  }, [programOutput, metrics]);

  const diagStats = metrics ? [
    { label: 'Quality score', value: `${metrics.quality_score.toFixed(0)}`, color: qualColor(metrics.quality_score, 70, 40) },
    { label: 'Artifact frac', value: `${(metrics.artifact_fraction * 100).toFixed(0)}%`, color: qualColor(metrics.artifact_fraction, 0.05, 0.2, true) },
    { label: 'Quality',       value: metrics.quality_label.toUpperCase(), color: `var(--${metrics.quality_label === 'good' ? 'good' : metrics.quality_label === 'fair' ? 'fair' : 'poor'})` },
    { label: 'Eyes',          value: paramBool('eyes_closed', false) ? 'closed' : 'open', color: paramBool('eyes_closed', false) ? 'var(--fair)' : 'var(--good)' },
    { label: 'Debug mode',    value: paramString('debug_mode', 'observe') },
    { label: 'Ready bands',   value: `${payload?.baseline_ready_count ?? 0}` },
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

          <Panel title="Quality Timeline">
            <TimelineChart
              series={[{ label: 'Quality', color: '#88aaff', points: qualityHistory, threshold: 55 }]}
              width={700}
              height={160}
              windowSec={120}
              yMin={0}
              yMax={100}
            />
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
          Connect a device or enable Test Mode to stream data. This program is a real manifest-backed plugin that exercises reusable charts and tracked program settings.
        </div>
      </Section>

      <Section title="Instrumented Buttons">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <ProgramParamButton
            programId="debug"
            paramKey="eyes_closed"
            value={true}
            onResolved={mergeParams}
            className={`btn${paramBool('eyes_closed', false) ? ' active' : ''}`}
          >
            Eyes Closed
          </ProgramParamButton>
          <ProgramParamButton
            programId="debug"
            paramKey="eyes_closed"
            value={false}
            onResolved={mergeParams}
            className={`btn${!paramBool('eyes_closed', false) ? ' active' : ''}`}
          >
            Eyes Open
          </ProgramParamButton>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          {(['observe', 'calibrate', 'stress'] as const).map((mode) => (
            <ProgramParamButton
              key={mode}
              programId="debug"
              paramKey="debug_mode"
              value={mode}
              onResolved={mergeParams}
              className={`btn${paramString('debug_mode', 'observe') === mode ? ' active' : ''}`}
            >
              {mode}
            </ProgramParamButton>
          ))}
        </div>
      </Section>

      <Section title="Instrumented Sliders">
        <ProgramParamSlider
          label="Debug gain"
          min={0}
          max={2}
          step={0.05}
          value={paramNumber('debug_gain', 1)}
          onResolved={mergeParams}
          programId="debug"
          paramKey="debug_gain"
          format={(v) => `${v.toFixed(2)}x`}
        />
        <ProgramParamSlider
          label="Marker level"
          min={0}
          max={100}
          step={1}
          value={paramNumber('marker_level', 50)}
          onResolved={mergeParams}
          programId="debug"
          paramKey="marker_level"
          format={(v) => `${v}%`}
        />
      </Section>

      <Section title="Audio Test">
        <AudioTrackPlayer
          programId="debug"
          eventPrefix="debug_audio"
        />
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

      <SessionControls
        programId="debug"
        programTitle="Debug"
        startLabel="Start Recording"
        stopLabel="Stop Recording"
      />
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
