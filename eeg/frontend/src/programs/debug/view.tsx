import { useEffect, useState } from 'react';
import { useDeviceStore } from '../../state/deviceStore';
import { api } from '../../api/client';
import { ProgramLayout } from '../ProgramLayout';
import { Panel } from '../../components/layout/Panel';
import { AudioTrackPlayer } from '../../components/audio/AudioTrackPlayer';
import { BandPowerPanel } from '../../components/graphs/BandPowerPanel';
import { RollingBandDiagnostics } from '../../components/graphs/RollingBandDiagnostics';
import { SpectralHistoryPanel } from '../../components/graphs/SpectralHistoryPanel';
import { Waveform } from '../../components/graphs/Waveform';
import { SignalPanel } from '../../components/signal/SignalPanel';
import { SessionControls } from '../../components/session/SessionControls';
import { Section } from '../../components/controls/Section';
import { ProgramParamButton, ProgramParamSlider } from '../../components/controls/Instrumented';

export default function DebugView() {
  const metrics = useDeviceStore((s) => s.metrics);
  const appState = useDeviceStore((s) => s.appState);
  const [psdFocused, setPsdFocused] = useState(false);
  const [params, setParams] = useState<Record<string, unknown>>({
    eyes_closed: false,
    debug_gain: 1,
    marker_level: 50,
    debug_mode: 'observe',
  });

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

  const main = (
    <>
      {metrics ? (
        psdFocused ? (
          <SignalPanel
            metrics={metrics}
            appState={appState}
            psdFocused={psdFocused}
            onPsdFocusToggle={() => setPsdFocused((focused) => !focused)}
          />
        ) : (
          <>
            <Panel title="EEG Waveform">
              <Waveform t={metrics.live_trace_t} y={metrics.live_trace_y} height={190} />
            </Panel>

            <Panel title="Band Power">
              <BandPowerPanel timelineHeight={240} />
            </Panel>

            <Panel title="Rolling Band Diagnostics">
              <RollingBandDiagnostics bands={['Alpha', 'Theta', 'Beta', 'SMR']} initialMode="baseline_delta" />
            </Panel>

            <SignalPanel
              metrics={metrics}
              appState={appState}
              psdFocused={psdFocused}
              onPsdFocusToggle={() => setPsdFocused((focused) => !focused)}
            />

            <Panel title="Spectral History">
              <SpectralHistoryPanel />
            </Panel>
          </>
        )
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
      mainFullWidth={psdFocused}
      main={main}
      sidebar={sidebar}
    />
  );
}
