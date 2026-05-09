import { useEffect, useRef, useState } from 'react';
import { useProgramStore } from '../../state/programStore';
import { useDeviceStore } from '../../state/deviceStore';
import { api } from '../../api/client';
import { useAudioScene } from '../../audio/useAudioScene';
import { ProgramLayout } from '../ProgramLayout';
import { Section } from '../../components/controls/Section';
import { LoggedSlider, ProgramParamSlider } from '../../components/controls/Instrumented';
import { SessionControls } from '../../components/session/SessionControls';
import { StatsGrid } from '../../components/session/StatsGrid';
import { PSDPlot } from '../../components/graphs/PSDPlot';
import { NeurofeedbackCharts } from '../../components/graphs/NeurofeedbackCharts';
import { Waveform } from '../../components/graphs/Waveform';
import { Panel } from '../../components/layout/Panel';
import { AudioTrackPlayer } from '../../components/audio/AudioTrackPlayer';

const BROWN_NOISE_URL = '/audio/tracks/Brown%20Noise.mp3';
const ALPHA_WAVES_URL = '/audio/tracks/Alpha%20Waves.mp3';

interface AlphaPayload {
  mode: string;
  drives: { clarity: number };
  thresholds: { alpha: number; theta: number; beta: number };
  reward_active: boolean;
  inhibit_active: boolean;
  theta_inhibit: boolean;
  beta_inhibit: boolean;
  alpha_low: boolean;
  alpha_value: number;
  theta_value: number;
  beta_value: number;
  alpha_samples: number;
  theta_samples: number;
  beta_samples: number;
}

type AlphaHistoryPoint = {
  x: number;
  alphaValue: number;
  thetaValue: number;
  betaValue: number;
  alphaThreshold: number;
  thetaThreshold: number;
  betaThreshold: number;
  clarity: number;
  rewardActive: boolean;
  inhibitActive: boolean;
  thetaInhibit: boolean;
  betaInhibit: boolean;
  alphaLow: boolean;
};

export default function AlphaFeedbackView() {
  const programOutput = useProgramStore((s) => s.programOutput);
  const metrics       = useDeviceStore((s) => s.metrics);
  const scene         = useAudioScene();

  const [masterVol,    setMasterVol]    = useState(0.8);
  const [baseVol,      setBaseVol]      = useState(0.15);
  const [clearVol,     setClearVol]     = useState(0.9);
  const [baseUrl,      setBaseUrl]      = useState(BROWN_NOISE_URL);
  const [clearUrl,     setClearUrl]     = useState(ALPHA_WAVES_URL);
  const [audioFadeTime, setAudioFadeTime] = useState(1.2);
  const [chartWindowSec, setChartWindowSec] = useState(30);
  const [showThresholds, setShowThresholds] = useState(true);
  const [params, setParams] = useState<Record<string, unknown>>({
    threshold_window_sec: 180,
    clarity_at_threshold: 0.5,
    reward_target_pct: 65,
    theta_inhibit_pct: 15,
    beta_inhibit_pct: 15,
  });

  const feedbackHistRef = useRef<AlphaHistoryPoint[]>([]);
  const [feedbackHistory, setFeedbackHistory] = useState<AlphaHistoryPoint[]>([]);

  const payload = programOutput?.payload as AlphaPayload | undefined;
  const mode    = payload?.mode ?? '—';
  const clarity = payload?.drives?.clarity ?? 0;
  const mergeParams = (next: Record<string, unknown>) => setParams((prev) => ({ ...prev, ...next }));
  const paramNumber = (key: string, fallback: number) => {
    const value = params[key];
    return typeof value === 'number' ? value : fallback;
  };

  useEffect(() => {
    api.getProgramParams('alpha_feedback')
      .then((res) => setParams(res.params))
      .catch(() => {});
  }, []);

  useEffect(() => () => scene.destroy(), [scene]);

  const loadScene = async () => {
    await scene.load(baseUrl === 'silence' ? null : baseUrl, clearUrl === 'silence' ? null : clearUrl);
  };

  // Drive audio
  useEffect(() => {
    if (!payload) return;
    scene.setVolume(masterVol);
    scene.setTrackVolumes(baseVol, clearVol);
    scene.setCrossfade(clarity, audioFadeTime);
  }, [payload, masterVol, baseVol, clearVol, audioFadeTime, clarity, scene]);

  // History
  useEffect(() => {
    if (!payload || !programOutput) return;
    if (feedbackHistRef.current.length > 0 && programOutput.elapsed < feedbackHistRef.current[feedbackHistRef.current.length - 1].x) {
      feedbackHistRef.current = [];
      setFeedbackHistory([]);
    }
    const feedbackPoint: AlphaHistoryPoint = {
      x: programOutput.elapsed,
      alphaValue: payload.alpha_value,
      thetaValue: payload.theta_value,
      betaValue: payload.beta_value,
      alphaThreshold: payload.thresholds.alpha,
      thetaThreshold: payload.thresholds.theta,
      betaThreshold: payload.thresholds.beta,
      clarity,
      rewardActive: payload.reward_active,
      inhibitActive: payload.inhibit_active,
      thetaInhibit: payload.theta_inhibit,
      betaInhibit: payload.beta_inhibit,
      alphaLow: payload.alpha_low,
    };
    feedbackHistRef.current = [...feedbackHistRef.current.slice(-720), feedbackPoint];
    setFeedbackHistory([...feedbackHistRef.current]);
  }, [payload, programOutput, clarity]);

  const handleTrainingStarted = async () => {
    scene.play();
    await loadScene();
  };

  const handleTrainingStopped = () => {
    scene.stop();
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
      <Panel bodyStyle={{ padding: 0 }}>
        <NeurofeedbackCharts
          points={feedbackHistory}
          bandDefs={[
            { key: 'alpha', label: 'Alpha', color: '#f0cc44', value: (point) => point.alphaValue, threshold: (point) => point.alphaThreshold },
            { key: 'theta', label: 'Theta', color: '#55bb88', value: (point) => point.thetaValue, threshold: (point) => point.thetaThreshold },
            { key: 'beta', label: 'Beta', color: '#e05050', value: (point) => point.betaValue, threshold: (point) => point.betaThreshold },
          ]}
          clarityDefs={[
            { key: 'clarity', label: 'Clarity', color: '#d9dde8', value: (point) => point.clarity },
          ]}
          chartWindowSec={chartWindowSec}
          onChartWindowSecChange={setChartWindowSec}
          showThresholds={showThresholds}
          onShowThresholdsChange={setShowThresholds}
          emptyLabel="Waiting for feedback history…"
          barBands={['Alpha', 'Theta', 'Beta']}
          states={[
            { key: 'theta_inhibit', label: 'Theta inhibit', color: 'rgba(85, 187, 136, 0.12)', active: (point) => point.thetaInhibit },
            { key: 'beta_inhibit', label: 'Beta inhibit', color: 'rgba(224, 80, 80, 0.12)', active: (point) => point.betaInhibit },
            { key: 'alpha_low', label: 'Alpha low', color: 'rgba(240, 204, 68, 0.10)', active: (point) => point.alphaLow },
          ]}
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
      <Section title="Audio Preview" collapsible defaultOpen={false}>
        <AudioTrackPlayer
          label="Base track"
          programId="alpha_feedback"
          eventPrefix="main.base_track"
          selectedUrl={baseUrl}
          onSelectedUrlChange={setBaseUrl}
        />
        <AudioTrackPlayer
          label="Clear track"
          programId="alpha_feedback"
          eventPrefix="main.clear_track"
          selectedUrl={clearUrl}
          onSelectedUrlChange={setClearUrl}
        />
        <LoggedSlider label="Base vol"      min={0} max={100} step={1} value={Math.round(baseVol  * 100)} onChange={(v) => { const next = v / 100; setBaseVol(next); scene.setTrackVolumes(next, clearVol); }} format={(v) => `${v}%`} programId="alpha_feedback" eventKey="main.base_volume_pct" />
        <LoggedSlider label="Clear vol"     min={0} max={100} step={1} value={Math.round(clearVol * 100)} onChange={(v) => { const next = v / 100; setClearVol(next); scene.setTrackVolumes(baseVol, next); }} format={(v) => `${v}%`} programId="alpha_feedback" eventKey="main.clear_volume_pct" />
        <LoggedSlider label="Master volume" min={0} max={100} step={1} value={Math.round(masterVol * 100)} onChange={(v) => { setMasterVol(v / 100); scene.setVolume(v / 100); }} format={(v) => `${v}%`} programId="alpha_feedback" eventKey="main.master_volume_pct" />
      </Section>

      <Section title="Thresholds" collapsible defaultOpen={false}>
        <ProgramParamSlider label="Threshold window" min={1} max={300} step={1} value={paramNumber('threshold_window_sec', 180)} onResolved={mergeParams} programId="alpha_feedback" paramKey="threshold_window_sec" format={(v) => v < 60 ? `${v}s` : `${(v / 60).toFixed(1)}m`} />
        <ProgramParamSlider label="Threshold clarity" min={0.05} max={0.95} step={0.05} value={paramNumber('clarity_at_threshold', 0.5)} onResolved={mergeParams} programId="alpha_feedback" paramKey="clarity_at_threshold" format={(v) => `${Math.round(v * 100)}%`} />
        <ProgramParamSlider label="Reward rate"   min={0} max={100} step={1} value={paramNumber('reward_target_pct', 65)} onResolved={mergeParams} programId="alpha_feedback" paramKey="reward_target_pct" format={(v) => `${v}%`} />
        <ProgramParamSlider label="Theta inhibit" min={0} max={100} step={1} value={paramNumber('theta_inhibit_pct', 15)} onResolved={mergeParams} programId="alpha_feedback" paramKey="theta_inhibit_pct" format={(v) => `${v}%`} />
        <ProgramParamSlider label="Beta inhibit"  min={0} max={100} step={1} value={paramNumber('beta_inhibit_pct', 15)} onResolved={mergeParams} programId="alpha_feedback" paramKey="beta_inhibit_pct" format={(v) => `${v}%`} />
        <LoggedSlider label="Audio fade time" min={2} max={40} step={1} value={Math.round(audioFadeTime * 10)} onChange={(v) => setAudioFadeTime(v / 10)} format={(v) => `${(v / 10).toFixed(1)}s`} programId="alpha_feedback" eventKey="main.audio_fade_time_tenths" />
      </Section>

      {stats.length > 0 && (
        <Section title="Stats" collapsible defaultOpen={false}>
          <StatsGrid stats={stats} />
        </Section>
      )}

      <SessionControls programId="alpha_feedback" programTitle="Alpha Feedback" onStarted={handleTrainingStarted} onStopped={handleTrainingStopped} />
    </>
  );

  return (
    <ProgramLayout
      title="Alpha Feedback"
      mode={mode}
      statusText={programOutput?.status_text}
      calibrating={false}
      calibrationPct={0}
      main={main}
      sidebar={sidebar}
    />
  );
}
