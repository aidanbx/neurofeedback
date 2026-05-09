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
const CREEK_URL = '/audio/tracks/Creek.mp3';
const ALPHA_WAVES_URL = '/audio/tracks/Alpha%20Waves.mp3';
const BIRDS_URL = '/audio/tracks/Birds.mp3';

interface ATBPayload {
  mode: string;
  drives: { alpha: number; theta: number; beta: number };
  thresholds: { alpha: number; theta: number; beta: number };
  alpha_clarity: number;
  theta_clarity: number;
  beta_clarity: number;
  alpha_value: number;
  theta_value: number;
  beta_value: number;
  alpha_samples: number;
  theta_samples: number;
  beta_samples: number;
}

type ATBHistoryPoint = {
  x: number;
  alphaValue: number;
  thetaValue: number;
  betaValue: number;
  alphaThreshold: number;
  thetaThreshold: number;
  betaThreshold: number;
  alphaClarity: number;
  thetaClarity: number;
  betaClarity: number;
};

export default function AlphaThetaBetaView() {
  const programOutput = useProgramStore((s) => s.programOutput);
  const metrics       = useDeviceStore((s) => s.metrics);
  const alphaScene    = useAudioScene();
  const thetaScene    = useAudioScene();
  const betaScene     = useAudioScene();

  const [masterVol,    setMasterVol]    = useState(0.8);
  const [audioFadeTime, setAudioFadeTime] = useState(1.2);
  const [chartWindowSec, setChartWindowSec] = useState(30);
  const [showThresholds, setShowThresholds] = useState(true);

  const [alphaBase,  setAlphaBase]  = useState(BROWN_NOISE_URL);
  const [alphaClear, setAlphaClear] = useState(CREEK_URL);
  const [alphaBaseV, setAlphaBaseV] = useState(0.15);
  const [alphaClearV,setAlphaClearV]= useState(0.9);

  const [thetaBase,  setThetaBase]  = useState(BROWN_NOISE_URL);
  const [thetaClear, setThetaClear] = useState(ALPHA_WAVES_URL);
  const [thetaBaseV, setThetaBaseV] = useState(0.15);
  const [thetaClearV,setThetaClearV]= useState(0.9);

  const [betaBase,   setBetaBase]   = useState(BROWN_NOISE_URL);
  const [betaClear,  setBetaClear]  = useState(BIRDS_URL);
  const [betaBaseV,  setBetaBaseV]  = useState(0.15);
  const [betaClearV, setBetaClearV] = useState(0.9);

  const [params, setParams] = useState<Record<string, unknown>>({
    threshold_window_sec: 180,
    clarity_at_threshold: 0.5,
    alpha_reward_pct: 65,
    theta_reward_pct: 65,
    beta_reward_pct: 65,
  });

  const feedbackHistRef = useRef<ATBHistoryPoint[]>([]);
  const [feedbackHistory, setFeedbackHistory] = useState<ATBHistoryPoint[]>([]);

  const payload = programOutput?.payload as ATBPayload | undefined;
  const mode    = payload?.mode ?? '—';
  const mergeParams = (next: Record<string, unknown>) => setParams((prev) => ({ ...prev, ...next }));
  const paramNumber = (key: string, fallback: number) => {
    const value = params[key];
    return typeof value === 'number' ? value : fallback;
  };

  useEffect(() => {
    api.getProgramParams('alpha_theta_beta')
      .then((res) => setParams(res.params))
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    alphaScene.destroy();
    thetaScene.destroy();
    betaScene.destroy();
  }, [alphaScene, betaScene, thetaScene]);

  const toUrl = (u: string) => u === 'silence' ? null : u;

  const loadScenes = async () => {
    await Promise.all([
      alphaScene.load(toUrl(alphaBase), toUrl(alphaClear)),
      thetaScene.load(toUrl(thetaBase), toUrl(thetaClear)),
      betaScene.load(toUrl(betaBase), toUrl(betaClear)),
    ]);
  };

  useEffect(() => {
    if (!payload || !programOutput) return;
    if (feedbackHistRef.current.length > 0 && programOutput.elapsed < feedbackHistRef.current[feedbackHistRef.current.length - 1].x) {
      feedbackHistRef.current = [];
      setFeedbackHistory([]);
    }
    const e = programOutput.elapsed;
    feedbackHistRef.current = [
      ...feedbackHistRef.current.slice(-720),
      {
        x: e,
        alphaValue: payload.alpha_value,
        thetaValue: payload.theta_value,
        betaValue: payload.beta_value,
        alphaThreshold: payload.thresholds.alpha,
        thetaThreshold: payload.thresholds.theta,
        betaThreshold: payload.thresholds.beta,
        alphaClarity: payload.alpha_clarity,
        thetaClarity: payload.theta_clarity,
        betaClarity: payload.beta_clarity,
      },
    ];
    setFeedbackHistory([...feedbackHistRef.current]);

    const vol = masterVol;
    alphaScene.setVolume(vol); thetaScene.setVolume(vol); betaScene.setVolume(vol);
    alphaScene.setTrackVolumes(alphaBaseV, alphaClearV);
    thetaScene.setTrackVolumes(thetaBaseV, thetaClearV);
    betaScene.setTrackVolumes(betaBaseV, betaClearV);
    alphaScene.setCrossfade(payload.drives.alpha, audioFadeTime);
    thetaScene.setCrossfade(payload.drives.theta, audioFadeTime);
    betaScene.setCrossfade(payload.drives.beta,   audioFadeTime);
  }, [
    payload, programOutput, masterVol, audioFadeTime,
    alphaScene, thetaScene, betaScene,
    alphaBaseV, alphaClearV, thetaBaseV, thetaClearV, betaBaseV, betaClearV,
  ]);

  const handleTrainingStarted = async () => {
    alphaScene.play();
    thetaScene.play();
    betaScene.play();
    await loadScenes();
  };

  const handleTrainingStopped = () => {
    alphaScene.stop();
    thetaScene.stop();
    betaScene.stop();
  };

  const stats = payload ? [
    { label: 'Mode',       value: mode, color: mode === 'rolling' ? 'var(--good)' : 'var(--fair)' },
    { label: 'α Clarity',  value: `${(payload.alpha_clarity * 100).toFixed(0)}%`, color: 'var(--c-alpha)' },
    { label: 'θ Clarity',  value: `${(payload.theta_clarity * 100).toFixed(0)}%`, color: 'var(--c-theta)' },
    { label: 'β Clarity',  value: `${(payload.beta_clarity  * 100).toFixed(0)}%`, color: 'var(--c-beta)' },
    { label: 'α Samples',  value: `${payload.alpha_samples}` },
    { label: 'θ Samples',  value: `${payload.theta_samples}` },
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
            { key: 'alpha_clarity', label: 'Alpha', color: '#f0cc44', value: (point) => point.alphaClarity },
            { key: 'theta_clarity', label: 'Theta', color: '#55bb88', value: (point) => point.thetaClarity },
            { key: 'beta_clarity', label: 'Beta', color: '#e05050', value: (point) => point.betaClarity },
          ]}
          chartWindowSec={chartWindowSec}
          onChartWindowSecChange={setChartWindowSec}
          showThresholds={showThresholds}
          onShowThresholdsChange={setShowThresholds}
          emptyLabel="Waiting for feedback history…"
          barBands={['Alpha', 'Theta', 'Beta']}
        />
      </Panel>

      {metrics && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Panel title="PSD">
            <PSDPlot freqs={metrics.psd_freqs} values={metrics.psd_values} width={320} height={120} />
          </Panel>
          <Panel title="Live Waveform">
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
          label="Alpha base"
          programId="alpha_theta_beta"
          eventPrefix="alpha.base_track"
          selectedUrl={alphaBase}
          onSelectedUrlChange={setAlphaBase}
        />
        <AudioTrackPlayer
          label="Alpha clear"
          programId="alpha_theta_beta"
          eventPrefix="alpha.clear_track"
          selectedUrl={alphaClear}
          onSelectedUrlChange={setAlphaClear}
        />
        <LoggedSlider label="Base vol"  min={0} max={100} step={1} value={Math.round(alphaBaseV  * 100)} onChange={(v) => { const next = v / 100; setAlphaBaseV(next); alphaScene.setTrackVolumes(next, alphaClearV); }} format={(v) => `${v}%`} programId="alpha_theta_beta" eventKey="alpha.base_volume_pct" />
        <LoggedSlider label="Clear vol" min={0} max={100} step={1} value={Math.round(alphaClearV * 100)} onChange={(v) => { const next = v / 100; setAlphaClearV(next); alphaScene.setTrackVolumes(alphaBaseV, next); }} format={(v) => `${v}%`} programId="alpha_theta_beta" eventKey="alpha.clear_volume_pct" />
        <AudioTrackPlayer
          label="Theta base"
          programId="alpha_theta_beta"
          eventPrefix="theta.base_track"
          selectedUrl={thetaBase}
          onSelectedUrlChange={setThetaBase}
        />
        <AudioTrackPlayer
          label="Theta clear"
          programId="alpha_theta_beta"
          eventPrefix="theta.clear_track"
          selectedUrl={thetaClear}
          onSelectedUrlChange={setThetaClear}
        />
        <LoggedSlider label="Base vol"  min={0} max={100} step={1} value={Math.round(thetaBaseV  * 100)} onChange={(v) => { const next = v / 100; setThetaBaseV(next); thetaScene.setTrackVolumes(next, thetaClearV); }} format={(v) => `${v}%`} programId="alpha_theta_beta" eventKey="theta.base_volume_pct" />
        <LoggedSlider label="Clear vol" min={0} max={100} step={1} value={Math.round(thetaClearV * 100)} onChange={(v) => { const next = v / 100; setThetaClearV(next); thetaScene.setTrackVolumes(thetaBaseV, next); }} format={(v) => `${v}%`} programId="alpha_theta_beta" eventKey="theta.clear_volume_pct" />
        <AudioTrackPlayer
          label="Beta base"
          programId="alpha_theta_beta"
          eventPrefix="beta.base_track"
          selectedUrl={betaBase}
          onSelectedUrlChange={setBetaBase}
        />
        <AudioTrackPlayer
          label="Beta clear"
          programId="alpha_theta_beta"
          eventPrefix="beta.clear_track"
          selectedUrl={betaClear}
          onSelectedUrlChange={setBetaClear}
        />
        <LoggedSlider label="Base vol"  min={0} max={100} step={1} value={Math.round(betaBaseV  * 100)} onChange={(v) => { const next = v / 100; setBetaBaseV(next); betaScene.setTrackVolumes(next, betaClearV); }} format={(v) => `${v}%`} programId="alpha_theta_beta" eventKey="beta.base_volume_pct" />
        <LoggedSlider label="Clear vol" min={0} max={100} step={1} value={Math.round(betaClearV * 100)} onChange={(v) => { const next = v / 100; setBetaClearV(next); betaScene.setTrackVolumes(betaBaseV, next); }} format={(v) => `${v}%`} programId="alpha_theta_beta" eventKey="beta.clear_volume_pct" />
      </Section>

      <Section title="Settings" collapsible defaultOpen={false}>
        <ProgramParamSlider label="Threshold window" min={1} max={300} step={1} value={paramNumber('threshold_window_sec', 180)} onResolved={mergeParams} programId="alpha_theta_beta" paramKey="threshold_window_sec" format={(v) => v < 60 ? `${v}s` : `${(v / 60).toFixed(1)}m`} />
        <ProgramParamSlider label="Threshold clarity" min={0.05} max={0.95} step={0.05} value={paramNumber('clarity_at_threshold', 0.5)} onResolved={mergeParams} programId="alpha_theta_beta" paramKey="clarity_at_threshold" format={(v) => `${Math.round(v * 100)}%`} />
        <ProgramParamSlider label="Alpha reward rate" min={0} max={100} step={1} value={paramNumber('alpha_reward_pct', 65)} onResolved={mergeParams} programId="alpha_theta_beta" paramKey="alpha_reward_pct" format={(v) => `${v}%`} />
        <ProgramParamSlider label="Theta reward rate" min={0} max={100} step={1} value={paramNumber('theta_reward_pct', 65)} onResolved={mergeParams} programId="alpha_theta_beta" paramKey="theta_reward_pct" format={(v) => `${v}%`} />
        <ProgramParamSlider label="Beta reward rate" min={0} max={100} step={1} value={paramNumber('beta_reward_pct', 65)} onResolved={mergeParams} programId="alpha_theta_beta" paramKey="beta_reward_pct" format={(v) => `${v}%`} />
        <LoggedSlider label="Master volume" min={0} max={100} step={1} value={Math.round(masterVol * 100)} onChange={(v) => { setMasterVol(v / 100); }} format={(v) => `${v}%`} programId="alpha_theta_beta" eventKey="all.master_volume_pct" />
        <LoggedSlider label="Audio fade time" min={2} max={40} step={1} value={Math.round(audioFadeTime * 10)} onChange={(v) => setAudioFadeTime(v / 10)} format={(v) => `${(v / 10).toFixed(1)}s`} programId="alpha_theta_beta" eventKey="all.audio_fade_time_tenths" />
      </Section>

      {stats.length > 0 && (
        <Section title="Stats" collapsible defaultOpen={false}>
          <StatsGrid stats={stats} />
        </Section>
      )}

      <SessionControls programId="alpha_theta_beta" programTitle="Alpha-Theta-Beta Feedback" onStarted={handleTrainingStarted} onStopped={handleTrainingStopped} />
    </>
  );

  return (
    <ProgramLayout
      title="Alpha-Theta-Beta"
      mode={mode}
      statusText={programOutput?.status_text}
      calibrating={false}
      calibrationPct={0}
      main={main}
      sidebar={sidebar}
    />
  );
}
