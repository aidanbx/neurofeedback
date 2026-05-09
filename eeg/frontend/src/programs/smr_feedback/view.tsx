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

interface SMRPayload {
  mode: string;
  drives: { clarity: number };
  thresholds: { smr: number; theta: number; hibeta: number };
  reward_active: boolean;
  inhibit_active: boolean;
  theta_inhibit: boolean;
  hibeta_inhibit: boolean;
  smr_low: boolean;
  smr_value: number;
  theta_value: number;
  hibeta_value: number;
  smr_samples: number;
  theta_samples: number;
  hibeta_samples: number;
  reward_target_pct: number;
  theta_inhibit_pct: number;
  hibeta_inhibit_pct: number;
}

type SMRHistoryPoint = {
  x: number;
  smrValue: number;
  thetaValue: number;
  hibetaValue: number;
  smrThreshold: number;
  thetaThreshold: number;
  hibetaThreshold: number;
  clarity: number;
  rewardActive: boolean;
  inhibitActive: boolean;
  thetaInhibit: boolean;
  hibetaInhibit: boolean;
  smrLow: boolean;
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
  drive,
  relative,
}: {
  spread: number;
  drive: number;
  relative: number;
}) {
  const width = 200;
  const height = 86;
  const pad = 12;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;
  const samples = Array.from({ length: 81 }, (_, i) => {
    const rel = -3 + (i / 80) * 6;
    const y = rewardAudioDrive(rel, 0, spread, false);
    return {
      x: pad + (i / 80) * usableW,
      y: pad + (1 - y) * usableH,
    };
  });
  const path = samples.map((point, i) => `${i === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const markerX = pad + clamp((relative + 3) / 6, 0, 1) * usableW;
  const markerY = pad + (1 - clamp(drive, 0, 1)) * usableH;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Reward volume curve" style={{ display: 'block' }}>
        <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} stroke="rgba(255,255,255,0.18)" />
        <line x1={pad} x2={pad} y1={pad} y2={height - pad} stroke="rgba(255,255,255,0.18)" />
        <line x1={width / 2} x2={width / 2} y1={pad} y2={height - pad} stroke="rgba(255,255,255,0.24)" strokeDasharray="3 3" />
        <path d={path} fill="none" stroke="#d9dde8" strokeWidth="2" />
        <circle cx={markerX} cy={markerY} r="3.5" fill="#ff9f43" stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}>
        <span>below</span>
        <span>threshold</span>
        <span>above</span>
      </div>
    </div>
  );
}

export default function SMRFeedbackView() {
  const programOutput = useProgramStore((s) => s.programOutput);
  const metrics = useDeviceStore((s) => s.metrics);
  const scene = useAudioScene();

  const [masterVol, setMasterVol] = useState(0.8);
  const [baseVol, setBaseVol] = useState(0.15);
  const [clearVol, setClearVol] = useState(0.9);
  const [baseUrl, setBaseUrl] = useState(BROWN_NOISE_URL);
  const [clearUrl, setClearUrl] = useState(ALPHA_WAVES_URL);
  const [audioFadeTime, setAudioFadeTime] = useState(1.2);
  const [rewardSpread, setRewardSpread] = useState(0.8);
  const [chartWindowSec, setChartWindowSec] = useState(30);
  const [showThresholds, setShowThresholds] = useState(true);
  const [params, setParams] = useState<Record<string, unknown>>({
    threshold_window_sec: 60,
    clarity_at_threshold: 0.5,
    reward_target_pct: 27.5,
    theta_inhibit_pct: 15,
    hibeta_inhibit_pct: 15,
  });

  const feedbackHistRef = useRef<SMRHistoryPoint[]>([]);
  const [feedbackHistory, setFeedbackHistory] = useState<SMRHistoryPoint[]>([]);

  const payload = programOutput?.payload as SMRPayload | undefined;
  const mode = payload?.mode ?? '—';
  const clarity = payload?.drives?.clarity ?? 0;
  const rewardVolume = payload
    ? rewardAudioDrive(payload.smr_value, payload.thresholds.smr, rewardSpread, payload.inhibit_active)
    : 0;
  const rewardRelative = payload ? payload.smr_value - payload.thresholds.smr : 0;
  const mergeParams = (next: Record<string, unknown>) => setParams((prev) => ({ ...prev, ...next }));
  const paramNumber = (key: string, fallback: number) => {
    const value = params[key];
    return typeof value === 'number' ? value : fallback;
  };
  const setProgramParam = (key: string, value: number) => {
    mergeParams({ [key]: value });
    api.setProgramParams('smr_feedback', { [key]: value })
      .then((res) => setParams(res.params))
      .catch(() => {});
  };

  const thresholdWindowSec = paramNumber('threshold_window_sec', 60);
  const recentHistory = feedbackHistory.filter((point) => feedbackHistory.length === 0 || point.x >= feedbackHistory[feedbackHistory.length - 1].x - thresholdWindowSec);
  const smrPoints = recentHistory.map((point) => ({ x: point.x, value: point.smrValue, threshold: point.smrThreshold }));
  const thetaPoints = recentHistory.map((point) => ({ x: point.x, value: point.thetaValue, threshold: point.thetaThreshold }));
  const hibetaPoints = recentHistory.map((point) => ({ x: point.x, value: point.hibetaValue, threshold: point.hibetaThreshold }));
  const thresholdTargetForBand = (band: 'smr' | 'theta' | 'hibeta', threshold: number) => {
    const values = band === 'smr'
      ? smrPoints.map((point) => point.value)
      : band === 'theta'
        ? thetaPoints.map((point) => point.value)
        : hibetaPoints.map((point) => point.value);
    return Number(timeTargetForThreshold(values, threshold).toFixed(1));
  };

  useEffect(() => {
    api.getProgramParams('smr_feedback')
      .then((res) => setParams(res.params))
      .catch(() => {});
  }, []);

  useEffect(() => () => scene.destroy(), [scene]);

  const loadScene = async () => {
    await scene.load(baseUrl === 'silence' ? null : baseUrl, clearUrl === 'silence' ? null : clearUrl);
  };

  useEffect(() => {
    if (!payload) return;
    scene.setVolume(masterVol);
    scene.setTrackVolumes(baseVol, clearVol);
    scene.setCrossfade(rewardVolume, audioFadeTime);
  }, [payload, masterVol, baseVol, clearVol, audioFadeTime, rewardVolume, scene]);

  useEffect(() => {
    if (!payload || !programOutput) return;
    if (feedbackHistRef.current.length > 0 && programOutput.elapsed < feedbackHistRef.current[feedbackHistRef.current.length - 1].x) {
      feedbackHistRef.current = [];
      setFeedbackHistory([]);
    }
    const feedbackPoint: SMRHistoryPoint = {
      x: programOutput.elapsed,
      smrValue: payload.smr_value,
      thetaValue: payload.theta_value,
      hibetaValue: payload.hibeta_value,
      smrThreshold: payload.thresholds.smr,
      thetaThreshold: payload.thresholds.theta,
      hibetaThreshold: payload.thresholds.hibeta,
      clarity,
      rewardActive: payload.reward_active,
      inhibitActive: payload.inhibit_active,
      thetaInhibit: payload.theta_inhibit,
      hibetaInhibit: payload.hibeta_inhibit,
      smrLow: payload.smr_low,
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
    { label: 'Mode', value: mode, color: mode === 'rolling' ? 'var(--good)' : 'var(--fair)' },
    { label: 'Clarity', value: `${(clarity * 100).toFixed(0)}%`, color: clarity > 0.5 ? 'var(--good)' : 'var(--text)' },
    { label: 'Reward audio', value: `${(rewardVolume * 100).toFixed(0)}%`, color: rewardVolume > 0.5 ? 'var(--good)' : 'var(--text)' },
    { label: 'SMR', value: `${payload.smr_value.toFixed(3)} (${payload.smr_samples})` },
    { label: 'Theta', value: `${payload.theta_value.toFixed(3)} (${payload.theta_samples})` },
    { label: 'Hi-Beta', value: `${payload.hibeta_value.toFixed(3)} (${payload.hibeta_samples})` },
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
              key: 'smr',
              label: 'SMR',
              color: '#ff9f43',
              value: (point) => point.smrValue,
              threshold: (point) => point.smrThreshold,
              onThresholdChange: (value) => setProgramParam('reward_target_pct', thresholdTargetForBand('smr', value)),
            },
            {
              key: 'theta',
              label: 'Theta',
              color: '#55bb88',
              value: (point) => point.thetaValue,
              threshold: (point) => point.thetaThreshold,
              onThresholdChange: (value) => setProgramParam('theta_inhibit_pct', thresholdTargetForBand('theta', value)),
            },
            {
              key: 'hibeta',
              label: 'Hi-Beta',
              color: '#ff69b4',
              value: (point) => point.hibetaValue,
              threshold: (point) => point.hibetaThreshold,
              onThresholdChange: (value) => setProgramParam('hibeta_inhibit_pct', thresholdTargetForBand('hibeta', value)),
            },
          ]}
          clarityDefs={[
            {
              key: 'reward_volume',
              label: 'Reward volume',
              color: '#ff9f43',
              value: (point) => rewardAudioDrive(point.smrValue, point.smrThreshold, rewardSpread, point.inhibitActive),
            },
          ]}
          middleContent={
            <InhibitStateTimeline
              points={feedbackHistory}
              windowSec={chartWindowSec}
              lines={[
                { key: 'smr_low', label: 'SMR low', color: '#ff9f43', active: (point) => point.smrLow },
                { key: 'theta_inhibit', label: 'Theta inhibit', color: '#55bb88', active: (point) => point.thetaInhibit },
                { key: 'hibeta_inhibit', label: 'Hi-beta inhibit', color: '#ff69b4', active: (point) => point.hibetaInhibit },
              ]}
            />
          }
          chartWindowSec={chartWindowSec}
          onChartWindowSecChange={setChartWindowSec}
          showThresholds={showThresholds}
          onShowThresholdsChange={setShowThresholds}
          emptyLabel="Waiting for feedback history…"
          barBands={['SMR', 'Theta', 'Hi-Beta']}
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
          label="Base track"
          programId="smr_feedback"
          eventPrefix="main.base_track"
          selectedUrl={baseUrl}
          onSelectedUrlChange={setBaseUrl}
        />
        <AudioTrackPlayer
          label="Reward track"
          programId="smr_feedback"
          eventPrefix="main.clear_track"
          selectedUrl={clearUrl}
          onSelectedUrlChange={setClearUrl}
        />
        <LoggedSlider label="Base vol" min={0} max={100} step={1} value={Math.round(baseVol * 100)} onChange={(v) => { const next = v / 100; setBaseVol(next); scene.setTrackVolumes(next, clearVol); }} format={(v) => `${v}%`} programId="smr_feedback" eventKey="main.base_volume_pct" />
        <LoggedSlider label="Reward vol" min={0} max={100} step={1} value={Math.round(clearVol * 100)} onChange={(v) => { const next = v / 100; setClearVol(next); scene.setTrackVolumes(baseVol, next); }} format={(v) => `${v}%`} programId="smr_feedback" eventKey="main.clear_volume_pct" />
        <LoggedSlider label="Master volume" min={0} max={100} step={1} value={Math.round(masterVol * 100)} onChange={(v) => { setMasterVol(v / 100); scene.setVolume(v / 100); }} format={(v) => `${v}%`} programId="smr_feedback" eventKey="main.master_volume_pct" />
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
          programId="smr_feedback"
          eventKey="main.reward_spread_tenths"
        />
        <RewardCurvePreview spread={rewardSpread} drive={rewardVolume} relative={rewardRelative} />
      </Section>

      <Section title="Thresholds" collapsible defaultOpen={false}>
        <ProgramParamSlider label="Adaptive window" min={30} max={180} step={5} value={paramNumber('threshold_window_sec', 60)} onResolved={mergeParams} programId="smr_feedback" paramKey="threshold_window_sec" format={(v) => v < 60 ? `${v}s` : `${(v / 60).toFixed(1)}m`} />
        <ProgramParamSlider label="Threshold clarity" min={0.05} max={0.95} step={0.05} value={paramNumber('clarity_at_threshold', 0.5)} onResolved={mergeParams} programId="smr_feedback" paramKey="clarity_at_threshold" format={(v) => `${Math.round(v * 100)}%`} />
        <ThresholdControl
          label="SMR reward time"
          value={paramNumber('reward_target_pct', 27.5)}
          onChange={(value) => setProgramParam('reward_target_pct', value)}
          meter={<ThresholdMeter label="SMR" color="#ff9f43" points={smrPoints} liveValue={payload?.smr_value ?? 0} threshold={payload?.thresholds.smr ?? 0} />}
        />
        <ThresholdControl
          label="Theta inhibit time"
          value={paramNumber('theta_inhibit_pct', 15)}
          onChange={(value) => setProgramParam('theta_inhibit_pct', value)}
          meter={<ThresholdMeter label="Theta" color="#55bb88" points={thetaPoints} liveValue={payload?.theta_value ?? 0} threshold={payload?.thresholds.theta ?? 0} />}
        />
        <ThresholdControl
          label="Hi-beta inhibit time"
          value={paramNumber('hibeta_inhibit_pct', 15)}
          onChange={(value) => setProgramParam('hibeta_inhibit_pct', value)}
          meter={<ThresholdMeter label="Hi-Beta" color="#ff69b4" points={hibetaPoints} liveValue={payload?.hibeta_value ?? 0} threshold={payload?.thresholds.hibeta ?? 0} />}
        />
        <LoggedSlider label="Audio fade time" min={2} max={40} step={1} value={Math.round(audioFadeTime * 10)} onChange={(v) => setAudioFadeTime(v / 10)} format={(v) => `${(v / 10).toFixed(1)}s`} programId="smr_feedback" eventKey="main.audio_fade_time_tenths" />
      </Section>

      {stats.length > 0 && (
        <Section title="Stats" collapsible defaultOpen={false}>
          <StatsGrid stats={stats} />
        </Section>
      )}

      <SessionControls programId="smr_feedback" programTitle="SMR Feedback" onStarted={handleTrainingStarted} onStopped={handleTrainingStopped} />
    </>
  );

  return (
    <ProgramLayout
      title="SMR Feedback"
      mode={mode}
      statusText={programOutput?.status_text}
      calibrating={false}
      calibrationPct={0}
      main={main}
      sidebar={sidebar}
    />
  );
}
