import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { InhibitStateTimeline } from '../../components/graphs/InhibitStateTimeline';
import { Panel } from '../../components/layout/Panel';
import { AudioTrackPlayer } from '../../components/audio/AudioTrackPlayer';
import { Slider } from '../../components/controls/Slider';

const BROWN_NOISE_URL = '/audio/tracks/Brown%20Noise.mp3';
const ALPHA_WAVES_URL = '/audio/tracks/Alpha%20Waves.mp3';
const PROGRAM_ID = 'alpha_theta_feedback';

interface AlphaThetaPayload {
  mode: string;
  drives: { alpha: number; theta: number };
  thresholds: { alpha: number; theta: number; slow: number; beta: number };
  reward_active: boolean;
  inhibit_active: boolean;
  slow_inhibit: boolean;
  beta_inhibit: boolean;
  alpha_low: boolean;
  theta_low: boolean;
  alpha_value: number;
  theta_value: number;
  slow_value: number;
  beta_value: number;
  alpha_samples: number;
  theta_samples: number;
  slow_samples: number;
  beta_samples: number;
  alpha_reward_pct: number;
  theta_reward_pct: number;
  slow_inhibit_pct: number;
  beta_inhibit_pct: number;
}

type AlphaThetaHistoryPoint = {
  x: number;
  alphaValue: number;
  thetaValue: number;
  slowValue: number;
  betaValue: number;
  alphaThreshold: number;
  thetaThreshold: number;
  slowThreshold: number;
  betaThreshold: number;
  alphaClarity: number;
  thetaClarity: number;
  rewardActive: boolean;
  inhibitActive: boolean;
  slowInhibit: boolean;
  betaInhibit: boolean;
  alphaLow: boolean;
  thetaLow: boolean;
};

type MetricPoint = { x: number; value: number; threshold: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatPctTime(value: number) {
  return `${value.toFixed(1)}%`;
}

function rewardAudioDrive(value: number, threshold: number, spread: number, inhibited: boolean) {
  if (inhibited || !Number.isFinite(value) || !Number.isFinite(threshold)) return 0;
  const safeSpread = Math.max(0.05, spread);
  return clamp(1 / (1 + Math.exp(-(value - threshold) / safeSpread)), 0, 1);
}

function timeTargetForThreshold(values: number[], threshold: number) {
  if (values.length === 0) return 0;
  const active = values.filter((value) => value >= threshold).length;
  return (active / values.length) * 100;
}

function metricRange(values: number[], threshold: number, liveValue: number) {
  const all = [...values, threshold, liveValue].filter(Number.isFinite);
  if (all.length === 0) return { min: -1, max: 1 };
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(0.5, max - min);
  return { min: min - span * 0.15, max: max + span * 0.15 };
}

function ThresholdMeter({
  label,
  color,
  points,
  liveValue,
  threshold,
}: {
  label: string;
  color: string;
  points: MetricPoint[];
  liveValue: number;
  threshold: number;
}) {
  const values = points.map((point) => point.value);
  const { min, max } = metricRange(values, threshold, liveValue);
  const span = Math.max(1e-6, max - min);
  const thresholdPct = clamp(((threshold - min) / span) * 100, 0, 100);
  const valuePct = clamp(((liveValue - min) / span) * 100, 0, 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}>
        <span>{label} power</span>
        <span>{liveValue.toFixed(2)}</span>
      </div>
      <div style={{ position: 'relative', height: 12, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, width: `${valuePct}%`, background: `${color}66` }} />
        <div style={{ position: 'absolute', top: -1, bottom: -1, left: `calc(${thresholdPct}% - 1px)`, width: 2, background: color, boxShadow: `0 0 0 1px ${color}55` }} />
      </div>
    </div>
  );
}

function ThresholdControl({
  label,
  value,
  onChange,
  meter,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  meter: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Slider label={label} min={0} max={100} step={0.5} value={value} onChange={onChange} format={formatPctTime} />
      {meter}
    </div>
  );
}

function RewardCurvePreview({
  spread,
  alphaDrive,
  thetaDrive,
  alphaRelative,
  thetaRelative,
}: {
  spread: number;
  alphaDrive: number;
  thetaDrive: number;
  alphaRelative: number;
  thetaRelative: number;
}) {
  const width = 200;
  const height = 86;
  const pad = 12;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;
  const samples = Array.from({ length: 81 }, (_, i) => {
    const relative = -3 + (i / 80) * 6;
    const y = rewardAudioDrive(relative, 0, spread, false);
    return {
      x: pad + (i / 80) * usableW,
      y: pad + (1 - y) * usableH,
    };
  });
  const path = samples.map((point, i) => `${i === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const marker = (relative: number, drive: number, color: string) => {
    const x = pad + clamp((relative + 3) / 6, 0, 1) * usableW;
    const y = pad + (1 - clamp(drive, 0, 1)) * usableH;
    return <circle cx={x} cy={y} r="3.5" fill={color} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Reward volume curve" style={{ display: 'block' }}>
        <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} stroke="rgba(255,255,255,0.18)" />
        <line x1={pad} x2={pad} y1={pad} y2={height - pad} stroke="rgba(255,255,255,0.18)" />
        <line x1={width / 2} x2={width / 2} y1={pad} y2={height - pad} stroke="rgba(255,255,255,0.24)" strokeDasharray="3 3" />
        <path d={path} fill="none" stroke="#d9dde8" strokeWidth="2" />
        {marker(alphaRelative, alphaDrive, '#ff9f43')}
        {marker(thetaRelative, thetaDrive, '#55bb88')}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}>
        <span>below</span>
        <span>threshold</span>
        <span>above</span>
      </div>
    </div>
  );
}

export default function AlphaThetaFeedbackView() {
  const programOutput = useProgramStore((s) => s.programOutput);
  const metrics = useDeviceStore((s) => s.metrics);
  const alphaScene = useAudioScene();
  const thetaScene = useAudioScene();

  const [masterVol, setMasterVol] = useState(0.8);
  const [alphaBaseVol, setAlphaBaseVol] = useState(0.12);
  const [thetaBaseVol, setThetaBaseVol] = useState(0.12);
  const [alphaVol, setAlphaVol] = useState(0.85);
  const [thetaVol, setThetaVol] = useState(0.85);
  const [alphaBaseUrl, setAlphaBaseUrl] = useState(BROWN_NOISE_URL);
  const [thetaBaseUrl, setThetaBaseUrl] = useState(BROWN_NOISE_URL);
  const [alphaUrl, setAlphaUrl] = useState(ALPHA_WAVES_URL);
  const [thetaUrl, setThetaUrl] = useState(BROWN_NOISE_URL);
  const [audioFadeTime, setAudioFadeTime] = useState(1.2);
  const [rewardSpread, setRewardSpread] = useState(0.8);
  const [chartWindowSec, setChartWindowSec] = useState(30);
  const [showThresholds, setShowThresholds] = useState(true);
  const [params, setParams] = useState<Record<string, unknown>>({
    threshold_window_sec: 60,
    clarity_at_threshold: 0.5,
    alpha_reward_pct: 27.5,
    theta_reward_pct: 27.5,
    slow_inhibit_pct: 15,
    beta_inhibit_pct: 15,
  });

  const feedbackHistRef = useRef<AlphaThetaHistoryPoint[]>([]);
  const [feedbackHistory, setFeedbackHistory] = useState<AlphaThetaHistoryPoint[]>([]);

  const payload = programOutput?.payload as AlphaThetaPayload | undefined;
  const mode = payload?.mode ?? '—';
  const alphaClarity = payload?.drives?.alpha ?? 0;
  const thetaClarity = payload?.drives?.theta ?? 0;
  const alphaAudioDrive = payload
    ? rewardAudioDrive(payload.alpha_value, payload.thresholds.alpha, rewardSpread, payload.inhibit_active)
    : 0;
  const thetaAudioDrive = payload
    ? rewardAudioDrive(payload.theta_value, payload.thresholds.theta, rewardSpread, payload.inhibit_active)
    : 0;
  const alphaAudioRelative = payload ? payload.alpha_value - payload.thresholds.alpha : 0;
  const thetaAudioRelative = payload ? payload.theta_value - payload.thresholds.theta : 0;
  const mergeParams = (next: Record<string, unknown>) => setParams((prev) => ({ ...prev, ...next }));
  const paramNumber = (key: string, fallback: number) => {
    const value = params[key];
    return typeof value === 'number' ? value : fallback;
  };
  const setProgramParam = (key: string, value: number) => {
    mergeParams({ [key]: value });
    api.setProgramParams(PROGRAM_ID, { [key]: value })
      .then((res) => setParams(res.params))
      .catch(() => {});
  };

  const thresholdWindowSec = paramNumber('threshold_window_sec', 60);
  const recentHistory = feedbackHistory.filter((point) => feedbackHistory.length === 0 || point.x >= feedbackHistory[feedbackHistory.length - 1].x - thresholdWindowSec);
  const alphaPoints = recentHistory.map((point) => ({ x: point.x, value: point.alphaValue, threshold: point.alphaThreshold }));
  const thetaPoints = recentHistory.map((point) => ({ x: point.x, value: point.thetaValue, threshold: point.thetaThreshold }));
  const slowPoints = recentHistory.map((point) => ({ x: point.x, value: point.slowValue, threshold: point.slowThreshold }));
  const betaPoints = recentHistory.map((point) => ({ x: point.x, value: point.betaValue, threshold: point.betaThreshold }));
  const thresholdTargetForBand = (band: 'alpha' | 'theta' | 'slow' | 'beta', threshold: number) => {
    const values = band === 'alpha'
      ? alphaPoints.map((point) => point.value)
      : band === 'theta'
        ? thetaPoints.map((point) => point.value)
        : band === 'slow'
          ? slowPoints.map((point) => point.value)
          : betaPoints.map((point) => point.value);
    return Number(timeTargetForThreshold(values, threshold).toFixed(1));
  };

  useEffect(() => {
    api.getProgramParams(PROGRAM_ID)
      .then((res) => setParams(res.params))
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    alphaScene.destroy();
    thetaScene.destroy();
  }, [alphaScene, thetaScene]);

  const loadScene = async () => {
    await Promise.all([
      alphaScene.load(alphaBaseUrl === 'silence' ? null : alphaBaseUrl, alphaUrl === 'silence' ? null : alphaUrl),
      thetaScene.load(thetaBaseUrl === 'silence' ? null : thetaBaseUrl, thetaUrl === 'silence' ? null : thetaUrl),
    ]);
  };

  useEffect(() => {
    if (!payload) return;
    alphaScene.setVolume(masterVol);
    thetaScene.setVolume(masterVol);
    alphaScene.setTrackVolumes(alphaBaseVol, alphaVol);
    thetaScene.setTrackVolumes(thetaBaseVol, thetaVol);
    alphaScene.setCrossfade(alphaAudioDrive, audioFadeTime);
    thetaScene.setCrossfade(thetaAudioDrive, audioFadeTime);
  }, [payload, masterVol, alphaBaseVol, thetaBaseVol, alphaVol, thetaVol, audioFadeTime, alphaAudioDrive, thetaAudioDrive, alphaScene, thetaScene]);

  useEffect(() => {
    if (!payload || !programOutput) return;
    if (feedbackHistRef.current.length > 0 && programOutput.elapsed < feedbackHistRef.current[feedbackHistRef.current.length - 1].x) {
      feedbackHistRef.current = [];
      setFeedbackHistory([]);
    }
    const feedbackPoint: AlphaThetaHistoryPoint = {
      x: programOutput.elapsed,
      alphaValue: payload.alpha_value,
      thetaValue: payload.theta_value,
      slowValue: payload.slow_value,
      betaValue: payload.beta_value,
      alphaThreshold: payload.thresholds.alpha,
      thetaThreshold: payload.thresholds.theta,
      slowThreshold: payload.thresholds.slow,
      betaThreshold: payload.thresholds.beta,
      alphaClarity,
      thetaClarity,
      rewardActive: payload.reward_active,
      inhibitActive: payload.inhibit_active,
      slowInhibit: payload.slow_inhibit,
      betaInhibit: payload.beta_inhibit,
      alphaLow: payload.alpha_low,
      thetaLow: payload.theta_low,
    };
    feedbackHistRef.current = [...feedbackHistRef.current.slice(-720), feedbackPoint];
    setFeedbackHistory([...feedbackHistRef.current]);
  }, [payload, programOutput, alphaClarity, thetaClarity]);

  const handleTrainingStarted = async () => {
    alphaScene.play();
    thetaScene.play();
    await loadScene();
  };

  const handleTrainingStopped = () => {
    alphaScene.stop();
    thetaScene.stop();
  };

  const stats = payload ? [
    { label: 'Mode', value: mode, color: mode === 'rolling' ? 'var(--good)' : 'var(--fair)' },
    { label: 'Alpha clarity', value: `${(alphaClarity * 100).toFixed(0)}%`, color: alphaClarity > 0.5 ? 'var(--good)' : 'var(--text)' },
    { label: 'Theta clarity', value: `${(thetaClarity * 100).toFixed(0)}%`, color: thetaClarity > 0.5 ? 'var(--good)' : 'var(--text)' },
    { label: 'Alpha audio', value: `${(alphaAudioDrive * 100).toFixed(0)}%` },
    { label: 'Theta audio', value: `${(thetaAudioDrive * 100).toFixed(0)}%` },
    { label: 'Alpha', value: `${payload.alpha_value.toFixed(3)} (${payload.alpha_samples})` },
    { label: 'Theta', value: `${payload.theta_value.toFixed(3)} (${payload.theta_samples})` },
    { label: 'Beta+', value: `${payload.beta_value.toFixed(3)} (${payload.beta_samples})` },
    { label: 'Slow', value: `${payload.slow_value.toFixed(3)} (${payload.slow_samples})` },
    { label: 'State', value: payload.inhibit_active ? 'INHIBIT' : payload.reward_active ? 'reward' : 'neutral',
      color: payload.inhibit_active ? 'var(--poor)' : payload.reward_active ? 'var(--good)' : 'var(--muted)' },
  ] : [];

  const main = (
    <>
      <Panel bodyStyle={{ padding: 0 }}>
        <NeurofeedbackCharts
          points={feedbackHistory}
          bandDefs={[
            {
              key: 'alpha',
              label: 'Alpha',
              color: '#ff9f43',
              value: (point) => point.alphaValue,
              threshold: (point) => point.alphaThreshold,
              onThresholdChange: (value) => setProgramParam('alpha_reward_pct', thresholdTargetForBand('alpha', value)),
            },
            {
              key: 'theta',
              label: 'Theta',
              color: '#55bb88',
              value: (point) => point.thetaValue,
              threshold: (point) => point.thetaThreshold,
              onThresholdChange: (value) => setProgramParam('theta_reward_pct', thresholdTargetForBand('theta', value)),
            },
            {
              key: 'slow',
              label: 'Slow',
              color: '#6aa6ff',
              value: (point) => point.slowValue,
              threshold: (point) => point.slowThreshold,
              onThresholdChange: (value) => setProgramParam('slow_inhibit_pct', thresholdTargetForBand('slow', value)),
            },
            {
              key: 'beta',
              label: 'Beta+',
              color: '#ff69b4',
              value: (point) => point.betaValue,
              threshold: (point) => point.betaThreshold,
              onThresholdChange: (value) => setProgramParam('beta_inhibit_pct', thresholdTargetForBand('beta', value)),
            },
          ]}
          clarityDefs={[
            {
              key: 'alpha_volume',
              label: 'Alpha volume',
              color: '#ff9f43',
              value: (point) => rewardAudioDrive(point.alphaValue, point.alphaThreshold, rewardSpread, point.inhibitActive),
            },
            {
              key: 'theta_volume',
              label: 'Theta volume',
              color: '#55bb88',
              value: (point) => rewardAudioDrive(point.thetaValue, point.thetaThreshold, rewardSpread, point.inhibitActive),
            },
          ]}
          middleContent={
            <InhibitStateTimeline
              points={feedbackHistory}
              windowSec={chartWindowSec}
              lines={[
                { key: 'alpha_low', label: 'Alpha low', color: '#ff9f43', active: (point) => point.alphaLow },
                { key: 'theta_low', label: 'Theta low', color: '#55bb88', active: (point) => point.thetaLow },
                { key: 'slow_inhibit', label: 'Slow inhibit', color: '#6aa6ff', active: (point) => point.slowInhibit },
                { key: 'beta_inhibit', label: 'Beta+ inhibit', color: '#ff69b4', active: (point) => point.betaInhibit },
              ]}
            />
          }
          chartWindowSec={chartWindowSec}
          onChartWindowSecChange={setChartWindowSec}
          showThresholds={showThresholds}
          onShowThresholdsChange={setShowThresholds}
          emptyLabel="Waiting for feedback history…"
          barBands={['Theta', 'Alpha', 'Delta', 'Beta+']}
          barInitialMode="smoothed"
          barThresholdDefs={[
            { band: 'Theta', color: '#55bb88', value: (point) => point.thetaThreshold },
            { band: 'Alpha', color: '#ff9f43', value: (point) => point.alphaThreshold },
            { band: 'Delta', color: '#6aa6ff', value: (point) => point.slowThreshold },
            { band: 'Beta+', color: '#ff69b4', value: (point) => point.betaThreshold },
          ]}
          states={[]}
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
          label="Alpha base"
          programId={PROGRAM_ID}
          eventPrefix="main.alpha_base_track"
          selectedUrl={alphaBaseUrl}
          onSelectedUrlChange={setAlphaBaseUrl}
        />
        <AudioTrackPlayer
          label="Alpha track"
          programId={PROGRAM_ID}
          eventPrefix="main.alpha_track"
          selectedUrl={alphaUrl}
          onSelectedUrlChange={setAlphaUrl}
        />
        <AudioTrackPlayer
          label="Theta base"
          programId={PROGRAM_ID}
          eventPrefix="main.theta_base_track"
          selectedUrl={thetaBaseUrl}
          onSelectedUrlChange={setThetaBaseUrl}
        />
        <AudioTrackPlayer
          label="Theta track"
          programId={PROGRAM_ID}
          eventPrefix="main.theta_track"
          selectedUrl={thetaUrl}
          onSelectedUrlChange={setThetaUrl}
        />
        <LoggedSlider label="Alpha base vol" min={0} max={100} step={1} value={Math.round(alphaBaseVol * 100)} onChange={(v) => { const next = v / 100; setAlphaBaseVol(next); alphaScene.setTrackVolumes(next, alphaVol); }} format={(v) => `${v}%`} programId={PROGRAM_ID} eventKey="main.alpha_base_volume_pct" />
        <LoggedSlider label="Alpha reward vol" min={0} max={100} step={1} value={Math.round(alphaVol * 100)} onChange={(v) => { const next = v / 100; setAlphaVol(next); alphaScene.setTrackVolumes(alphaBaseVol, next); }} format={(v) => `${v}%`} programId={PROGRAM_ID} eventKey="main.alpha_volume_pct" />
        <LoggedSlider label="Theta base vol" min={0} max={100} step={1} value={Math.round(thetaBaseVol * 100)} onChange={(v) => { const next = v / 100; setThetaBaseVol(next); thetaScene.setTrackVolumes(next, thetaVol); }} format={(v) => `${v}%`} programId={PROGRAM_ID} eventKey="main.theta_base_volume_pct" />
        <LoggedSlider label="Theta reward vol" min={0} max={100} step={1} value={Math.round(thetaVol * 100)} onChange={(v) => { const next = v / 100; setThetaVol(next); thetaScene.setTrackVolumes(thetaBaseVol, next); }} format={(v) => `${v}%`} programId={PROGRAM_ID} eventKey="main.theta_volume_pct" />
        <LoggedSlider label="Master volume" min={0} max={100} step={1} value={Math.round(masterVol * 100)} onChange={(v) => { setMasterVol(v / 100); alphaScene.setVolume(v / 100); thetaScene.setVolume(v / 100); }} format={(v) => `${v}%`} programId={PROGRAM_ID} eventKey="main.master_volume_pct" />
      </Section>

      <Section title="Reward Curve" collapsible defaultOpen={false}>
        <LoggedSlider
          label="Reward spread"
          min={1}
          max={30}
          step={1}
          value={Math.round(rewardSpread * 10)}
          onChange={(v) => setRewardSpread(v / 10)}
          format={(v) => `${(v / 10).toFixed(1)}`}
          programId={PROGRAM_ID}
          eventKey="main.reward_spread_tenths"
        />
        <RewardCurvePreview
          spread={rewardSpread}
          alphaDrive={alphaAudioDrive}
          thetaDrive={thetaAudioDrive}
          alphaRelative={alphaAudioRelative}
          thetaRelative={thetaAudioRelative}
        />
      </Section>

      <Section title="Thresholds" collapsible defaultOpen={false}>
        <ProgramParamSlider label="Adaptive window" min={30} max={180} step={5} value={paramNumber('threshold_window_sec', 60)} onResolved={mergeParams} programId={PROGRAM_ID} paramKey="threshold_window_sec" format={(v) => v < 60 ? `${v}s` : `${(v / 60).toFixed(1)}m`} />
        <ProgramParamSlider label="Threshold clarity" min={0.05} max={0.95} step={0.05} value={paramNumber('clarity_at_threshold', 0.5)} onResolved={mergeParams} programId={PROGRAM_ID} paramKey="clarity_at_threshold" format={(v) => `${Math.round(v * 100)}%`} />
        <ThresholdControl
          label="Alpha reward time"
          value={paramNumber('alpha_reward_pct', 27.5)}
          onChange={(value) => setProgramParam('alpha_reward_pct', value)}
          meter={<ThresholdMeter label="Alpha" color="#ff9f43" points={alphaPoints} liveValue={payload?.alpha_value ?? 0} threshold={payload?.thresholds.alpha ?? 0} />}
        />
        <ThresholdControl
          label="Theta reward time"
          value={paramNumber('theta_reward_pct', 27.5)}
          onChange={(value) => setProgramParam('theta_reward_pct', value)}
          meter={<ThresholdMeter label="Theta" color="#55bb88" points={thetaPoints} liveValue={payload?.theta_value ?? 0} threshold={payload?.thresholds.theta ?? 0} />}
        />
        <ThresholdControl
          label="Slow inhibit time"
          value={paramNumber('slow_inhibit_pct', 15)}
          onChange={(value) => setProgramParam('slow_inhibit_pct', value)}
          meter={<ThresholdMeter label="Slow" color="#6aa6ff" points={slowPoints} liveValue={payload?.slow_value ?? 0} threshold={payload?.thresholds.slow ?? 0} />}
        />
        <ThresholdControl
          label="Beta+ inhibit time"
          value={paramNumber('beta_inhibit_pct', 15)}
          onChange={(value) => setProgramParam('beta_inhibit_pct', value)}
          meter={<ThresholdMeter label="Beta+" color="#ff69b4" points={betaPoints} liveValue={payload?.beta_value ?? 0} threshold={payload?.thresholds.beta ?? 0} />}
        />
        <LoggedSlider label="Audio fade time" min={2} max={40} step={1} value={Math.round(audioFadeTime * 10)} onChange={(v) => setAudioFadeTime(v / 10)} format={(v) => `${(v / 10).toFixed(1)}s`} programId={PROGRAM_ID} eventKey="main.audio_fade_time_tenths" />
      </Section>

      {stats.length > 0 && (
        <Section title="Stats" collapsible defaultOpen={false}>
          <StatsGrid stats={stats} />
        </Section>
      )}

      <SessionControls programId={PROGRAM_ID} programTitle="Alpha Theta Feedback" onStarted={handleTrainingStarted} onStopped={handleTrainingStopped} />
    </>
  );

  return (
    <ProgramLayout
      title="Alpha Theta Feedback"
      mode={mode}
      statusText={programOutput?.status_text}
      calibrating={false}
      calibrationPct={0}
      main={main}
      sidebar={sidebar}
    />
  );
}
