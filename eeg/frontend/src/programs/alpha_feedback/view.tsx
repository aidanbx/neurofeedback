import { useEffect, useRef, useState } from 'react';
import { useProgramStore } from '../../state/programStore';
import { useDeviceStore } from '../../state/deviceStore';
import { useAudioScene } from '../../audio/useAudioScene';
import { ProgramLayout } from '../ProgramLayout';
import { Section } from '../../components/controls/Section';
import { Slider } from '../../components/controls/Slider';
import { TrackPicker } from '../../components/controls/TrackPicker';
import { SessionControls } from '../../components/session/SessionControls';
import { StatsGrid } from '../../components/session/StatsGrid';
import { BandBars } from '../../components/graphs/BandBars';
import { TimelineChart } from '../../components/graphs/TimelineChart';
import { PSDPlot } from '../../components/graphs/PSDPlot';
import { Waveform } from '../../components/graphs/Waveform';
import { Panel } from '../../components/layout/Panel';

interface AlphaPayload {
  mode: string;
  drives: { clarity: number };
  reward_active: boolean;
  inhibit_active: boolean;
  alpha_value: number;
  theta_value: number;
  beta_value: number;
  alpha_samples: number;
  theta_samples: number;
  beta_samples: number;
}

type Pt = { x: number; y: number };

export default function AlphaFeedbackView() {
  const programOutput = useProgramStore((s) => s.programOutput);
  const metrics       = useDeviceStore((s) => s.metrics);
  const scene         = useAudioScene();

  const [masterVol,    setMasterVol]    = useState(0.8);
  const [baseVol,      setBaseVol]      = useState(0.9);
  const [clearVol,     setClearVol]     = useState(0.9);
  const [baseUrl,      setBaseUrl]      = useState('silence');
  const [clearUrl,     setClearUrl]     = useState('silence');
  const [responseTime, setResponseTime] = useState(1.2);
  const [rewardTarget, setRewardTarget] = useState(65);
  const [thetaInhibit, setThetaInhibit] = useState(15);
  const [betaInhibit,  setBetaInhibit]  = useState(15);

  const histRef = useRef<Pt[]>([]);
  const [history, setHistory] = useState<Pt[]>([]);

  const payload = programOutput?.payload as AlphaPayload | undefined;
  const mode    = payload?.mode ?? '—';
  const calibrating  = mode === 'calibrating';
  const calibPct = payload
    ? Math.min(payload.alpha_samples / 60, 1) * 100
    : 0;
  const clarity = payload?.drives?.clarity ?? 0;

  // Drive audio
  useEffect(() => {
    if (!payload) return;
    scene.setVolume(masterVol);
    scene.setCrossfade(clarity, responseTime);
  }, [payload, masterVol, responseTime, clarity, scene]);

  // History
  useEffect(() => {
    if (!payload || !programOutput) return;
    const pt: Pt = { x: programOutput.elapsed, y: clarity };
    histRef.current = [...histRef.current.slice(-300), pt];
    setHistory([...histRef.current]);
  }, [payload, programOutput, clarity]);

  const handleLoad = async () => {
    await scene.load(baseUrl === 'silence' ? null : baseUrl, clearUrl === 'silence' ? null : clearUrl);
    scene.play();
  };

  const stats = payload ? [
    { label: 'Mode',    value: mode,                           color: mode === 'rolling' ? 'var(--good)' : 'var(--fair)' },
    { label: 'Clarity', value: `${(clarity * 100).toFixed(0)}%`, color: clarity > 0.5 ? 'var(--good)' : 'var(--text)' },
    { label: 'Alpha',   value: `${payload.alpha_value.toFixed(3)} (${payload.alpha_samples})` },
    { label: 'Theta',   value: `${payload.theta_value.toFixed(3)} (${payload.theta_samples})` },
    { label: 'Beta',    value: `${payload.beta_value.toFixed(3)} (${payload.beta_samples})` },
    { label: 'State',   value: payload.inhibit_active ? 'INHIBIT' : payload.reward_active ? 'reward' : 'neutral',
      color: payload.inhibit_active ? 'var(--poor)' : payload.reward_active ? 'var(--good)' : 'var(--muted)' },
  ] : [];

  const main = (
    <>
      {metrics && (
        <>
          <Panel title="EEG Waveform">
            <Waveform t={metrics.live_trace_t} y={metrics.live_trace_y} width={700} height={120} />
          </Panel>

          <Panel title="Band Power">
            <BandBars bands={metrics.bands} mode="smoothed" />
          </Panel>
        </>
      )}

      <Panel title="Clarity History (2 min)">
        <TimelineChart
          series={[{ label: 'Clarity', color: '#f0cc44', points: history, threshold: 0.5 }]}
          width={700} height={180}
          windowSec={120} yMin={0} yMax={1}
        />
      </Panel>

      {metrics && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Panel title="PSD">
            <PSDPlot freqs={metrics.psd_freqs} values={metrics.psd_values} width={320} height={120} />
          </Panel>
          <Panel title="Live Waveform (zoom)">
            <Waveform t={metrics.live_trace_t} y={metrics.live_trace_y} width={320} height={120} color="#55bb88" />
          </Panel>
        </div>
      )}
    </>
  );

  const sidebar = (
    <>
      <Section title="Audio">
        <TrackPicker label="Base track"  value={baseUrl}  onChange={setBaseUrl}  />
        <TrackPicker label="Clear track" value={clearUrl} onChange={setClearUrl} />
        <button className="btn btn-accent btn-full" onClick={handleLoad}>Load &amp; Preview</button>
        <Slider label="Base vol"      min={0} max={100} step={1} value={Math.round(baseVol  * 100)} onChange={(v) => setBaseVol(v  / 100)} format={(v) => `${v}%`} />
        <Slider label="Clear vol"     min={0} max={100} step={1} value={Math.round(clearVol * 100)} onChange={(v) => setClearVol(v / 100)} format={(v) => `${v}%`} />
        <Slider label="Master volume" min={0} max={100} step={1} value={Math.round(masterVol * 100)} onChange={(v) => { setMasterVol(v / 100); scene.setVolume(v / 100); }} format={(v) => `${v}%`} />
        <Slider label="Response time" min={2} max={40} step={1} value={Math.round(responseTime * 10)} onChange={(v) => setResponseTime(v / 10)} format={(v) => `${(v / 10).toFixed(1)}s`} />
      </Section>

      <Section title="Thresholds">
        <Slider label="Reward rate"    min={40} max={85} step={1} value={rewardTarget}  onChange={setRewardTarget}  format={(v) => `${v}%`} />
        <Slider label="Theta inhibit"  min={5}  max={35} step={1} value={thetaInhibit}  onChange={setThetaInhibit}  format={(v) => `${v}%`} />
        <Slider label="Beta inhibit"   min={5}  max={35} step={1} value={betaInhibit}   onChange={setBetaInhibit}   format={(v) => `${v}%`} />
      </Section>

      {stats.length > 0 && (
        <Section title="Stats">
          <StatsGrid stats={stats} />
        </Section>
      )}

      <SessionControls programId="alpha_feedback" programTitle="Alpha Feedback" />
    </>
  );

  return (
    <ProgramLayout
      title="Alpha Feedback"
      mode={mode}
      statusText={programOutput?.status_text}
      calibrating={calibrating}
      calibrationPct={calibPct}
      main={main}
      sidebar={sidebar}
    />
  );
}
