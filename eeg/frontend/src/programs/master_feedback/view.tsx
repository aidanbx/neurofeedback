import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import { useAudioScene } from '../../audio/useAudioScene';
import { resolveAudioUrl } from '../../audio/resolveAudioUrl';
import { useDeviceStore } from '../../state/deviceStore';
import { useProgramStore } from '../../state/programStore';
import { AudioTrackPlayer } from '../../components/audio/AudioTrackPlayer';
import { Section } from '../../components/controls/Section';
import { Slider } from '../../components/controls/Slider';
import { LoggedSlider, ProgramParamSlider } from '../../components/controls/Instrumented';
import { SessionControls } from '../../components/session/SessionControls';
import { StatsGrid } from '../../components/session/StatsGrid';
import { Panel } from '../../components/layout/Panel';
import { SpectralHistoryPanel, type SpectralBandOverlay } from '../../components/graphs/SpectralHistoryPanel';
import { NeurofeedbackCharts } from '../../components/graphs/NeurofeedbackCharts';
import { InhibitStateTimeline } from '../../components/graphs/InhibitStateTimeline';
import { TimelineChart } from '../../components/graphs/TimelineChart';
import { BandPowerPanel } from '../../components/graphs/BandPowerPanel';
import { Waveform } from '../../components/graphs/Waveform';
import { ProgramLayout } from '../ProgramLayout';

const PROGRAM_ID = 'master_feedback';
const BROWN_NOISE_URL = '/audio/tracks/Brown%20Noise.mp3';
const ALPHA_WAVES_URL = '/audio/tracks/Alpha%20Waves.mp3';
const CREEK_URL = '/audio/tracks/Creek.mp3';

type Role = 'reward' | 'inhibit' | 'inhibit_sfx' | 'observe';
type Direction = 'above' | 'below';
type Feature = 'log_power';

interface BandDefinition {
  id: string;
  label: string;
  lo_hz: number;
  hi_hz: number;
  role: Role;
  direction: Direction;
  target_pct: number;
  dwell_sec: number;
  feature: Feature;
}

interface BandTelemetry extends BandDefinition {
  value: number;
  threshold: number;
  active: boolean;
  drive: number;
  mean: number;
  std: number;
  zscore: number;
  samples: number;
}

interface MasterPayload {
  mode: string;
  preset: string;
  bands: BandTelemetry[];
  drives: Record<string, number>;
  gates: Record<string, boolean>;
  reward_active: boolean;
  inhibit_active: boolean;
  any_active: boolean;
  all_rewards_active: boolean;
}

interface HistoryPoint {
  x: number;
  bands: Record<string, BandTelemetry>;
}

type Pt = { x: number; y: number };

const PRESET_LABELS: Record<string, string> = {
  alpha_feedback: 'Alpha',
  alpha_theta_beta: 'Alpha-Theta-Beta',
  alpha_theta_feedback: 'Alpha-Theta',
  smr_feedback: 'SMR',
  debug: 'Debug',
  custom: 'Custom',
};

const FALLBACK_COLORS = ['#ff9f43', '#55bb88', '#6aa6ff', '#ff69b4', '#d9dde8', '#9d7bff', '#4fd1c5'];

function colorForBand(band: { id: string; label: string }, index = 0) {
  const key = `${band.id} ${band.label}`.toLowerCase();
  if (key.includes('delta') || key.includes('slow')) return '#6aa6ff';
  if (key.includes('theta')) return '#55bb88';
  if (key.includes('alpha')) return '#ffbf47';
  if (key.includes('smr')) return '#ff9f43';
  if (key.includes('beta')) return '#ff69b4';
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function parseBands(raw: unknown): BandDefinition[] {
  if (typeof raw !== 'string') return [];
  try {
    const decoded = JSON.parse(raw);
    return Array.isArray(decoded) ? decoded.filter((item) => item && typeof item === 'object') as BandDefinition[] : [];
  } catch {
    return [];
  }
}

function bandJson(bands: BandDefinition[]) {
  return JSON.stringify(bands.map((band, index) => ({
    id: band.id || `band_${index + 1}`,
    label: band.label || `Band ${index + 1}`,
    lo_hz: Number(band.lo_hz),
    hi_hz: Number(band.hi_hz),
    role: band.role,
    direction: band.direction,
    target_pct: Number(band.target_pct),
    dwell_sec: Number(band.dwell_sec ?? 0),
    feature: band.feature,
  })));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

function rewardCurveDrive(value: number, spread: number) {
  const centered = clamp(value, 0, 1) - 0.5;
  return clamp(1 / (1 + Math.exp(-(centered * 8) / Math.max(0.1, spread))), 0, 1);
}

function FieldLabel({ children }: { children: string }) {
  return <span style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{children}</span>;
}

function RewardCurvePreview({
  spread,
  markers,
}: {
  spread: number;
  markers: { id: string; label: string; color: string; inputDrive: number; outputDrive: number }[];
}) {
  const width = 220;
  const height = 92;
  const pad = 14;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;
  const samples = Array.from({ length: 81 }, (_, i) => {
    const input = i / 80;
    return {
      x: pad + input * usableW,
      y: pad + (1 - rewardCurveDrive(input, spread)) * usableH,
    };
  });
  const path = samples.map((point, i) => `${i === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Reward audio curve" style={{ display: 'block' }}>
      <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} stroke="rgba(255,255,255,0.18)" />
      <line x1={pad} x2={pad} y1={pad} y2={height - pad} stroke="rgba(255,255,255,0.18)" />
      <line x1={width / 2} x2={width / 2} y1={pad} y2={height - pad} stroke="rgba(255,255,255,0.24)" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke="#d9dde8" strokeWidth="2" />
      {markers.map((marker, index) => {
        const markerX = pad + clamp(marker.inputDrive, 0, 1) * usableW;
        const markerY = pad + (1 - clamp(marker.outputDrive, 0, 1)) * usableH;
        return (
          <circle
            key={marker.id}
            cx={markerX}
            cy={markerY}
            r={4 + Math.min(2, marker.outputDrive * 2)}
            fill={marker.color}
            stroke="rgba(0,0,0,0.48)"
            strokeWidth="1"
            opacity={0.45 + marker.outputDrive * 0.55}
          >
            <title>{`${marker.label}: ${Math.round(marker.outputDrive * 100)}%`}</title>
          </circle>
        );
      })}
      <text x={pad} y={height - 3} fill="rgba(255,255,255,0.42)" fontSize="9" fontFamily="ui-monospace, monospace">low</text>
      <text x={width / 2} y={height - 3} fill="rgba(255,255,255,0.42)" fontSize="9" fontFamily="ui-monospace, monospace" textAnchor="middle">threshold</text>
      <text x={width - pad} y={height - 3} fill="rgba(255,255,255,0.42)" fontSize="9" fontFamily="ui-monospace, monospace" textAnchor="end">high</text>
    </svg>
  );
}

const BAND_PRESETS: BandDefinition[] = [
  { id: 'alpha', label: 'Alpha', lo_hz: 8, hi_hz: 12, role: 'reward', direction: 'above', target_pct: 65, dwell_sec: 0, feature: 'log_power' },
  { id: 'theta', label: 'Theta', lo_hz: 4, hi_hz: 8, role: 'inhibit', direction: 'above', target_pct: 15, dwell_sec: 0.5, feature: 'log_power' },
  { id: 'delta', label: 'Delta', lo_hz: 0.5, hi_hz: 4, role: 'inhibit_sfx', direction: 'above', target_pct: 15, dwell_sec: 2, feature: 'log_power' },
  { id: 'smr', label: 'SMR', lo_hz: 12, hi_hz: 15, role: 'reward', direction: 'above', target_pct: 65, dwell_sec: 0, feature: 'log_power' },
  { id: 'beta', label: 'Beta+', lo_hz: 15, hi_hz: 30, role: 'inhibit_sfx', direction: 'above', target_pct: 15, dwell_sec: 2, feature: 'log_power' },
];

function uniqueBandId(base: string, bands: BandDefinition[]) {
  const taken = new Set(bands.map((band) => band.id));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function DraftNumberInput({
  value,
  min,
  max,
  step,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    if (draft.trim() === '') {
      setDraft(String(value));
      return;
    }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clamp(parsed, min, max);
    setDraft(String(next));
    onCommit(next);
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
      style={inputStyle}
    />
  );
}

function DraftTextInput({
  value,
  fallback,
  onCommit,
}: {
  value: string;
  fallback: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const next = draft.trim() || fallback;
    setDraft(next);
    onCommit(next);
  };

  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      style={inputStyle}
    />
  );
}

function BandEditor({
  bands,
  onChange,
}: {
  bands: BandDefinition[];
  onChange: (bands: BandDefinition[]) => void;
}) {
  const update = (index: number, patch: Partial<BandDefinition>) => {
    onChange(bands.map((band, i) => i === index ? { ...band, ...patch } : band));
  };
  const remove = (index: number) => onChange(bands.filter((_, i) => i !== index));
  const add = () => {
    const next = bands.length + 1;
    onChange([
      ...bands,
      { id: `band_${next}`, label: `Band ${next}`, lo_hz: 8, hi_hz: 12, role: 'reward', direction: 'above', target_pct: 50, dwell_sec: 0, feature: 'log_power' },
    ]);
  };
  const addPreset = (preset: BandDefinition) => {
    const id = uniqueBandId(preset.id, bands);
    onChange([...bands, { ...preset, id }]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {bands.map((band, index) => (
        <div key={index} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.2fr) repeat(2, minmax(54px, 0.5fr)) minmax(102px, 0.8fr) minmax(82px, 0.7fr) minmax(104px, 0.8fr) minmax(68px, 0.55fr) 32px', gap: 6, alignItems: 'end', padding: 8, background: '#10121b', border: '1px solid var(--border)', borderRadius: 6 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <FieldLabel>Name</FieldLabel>
            <DraftTextInput value={band.label} fallback={`Band ${index + 1}`} onCommit={(value) => update(index, { label: value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <FieldLabel>Low</FieldLabel>
            <DraftNumberInput min={0} max={70} step={0.5} value={band.lo_hz} onCommit={(value) => update(index, { lo_hz: value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <FieldLabel>High</FieldLabel>
            <DraftNumberInput min={0.5} max={70} step={0.5} value={band.hi_hz} onCommit={(value) => update(index, { hi_hz: value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <FieldLabel>Action</FieldLabel>
            <select value={band.role} onChange={(event) => update(index, { role: event.target.value as Role })} style={inputStyle}>
              <option value="reward">Play audio</option>
              <option value="inhibit">Mute audio</option>
              <option value="inhibit_sfx">Mute + SFX</option>
              <option value="observe">Monitor only</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <FieldLabel>Gate</FieldLabel>
            <select value={band.direction} onChange={(event) => update(index, { direction: event.target.value as Direction })} style={inputStyle}>
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <FieldLabel>Threshold %</FieldLabel>
            <DraftNumberInput min={0} max={100} step={0.5} value={band.target_pct} onCommit={(value) => update(index, { target_pct: value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <FieldLabel>Hold s</FieldLabel>
            <DraftNumberInput min={0} max={10} step={0.25} value={band.dwell_sec ?? 0} onCommit={(value) => update(index, { dwell_sec: value })} />
          </label>
          <button type="button" className="btn" onClick={() => remove(index)} title="Remove band" aria-label={`Remove ${band.label}`} style={{ height: 28, padding: 0 }}>x</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={add}>Add band</button>
        {BAND_PRESETS.map((preset) => (
          <button key={preset.id} type="button" className="btn" onClick={() => addPreset(preset)}>
            Add {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function pctForThreshold(points: HistoryPoint[], bandId: string, threshold: number, direction: Direction) {
  const values = points.map((point) => point.bands[bandId]?.value).filter((value): value is number => Number.isFinite(value));
  if (values.length === 0) return 0;
  const active = values.filter((value) => direction === 'below' ? value <= threshold : value >= threshold).length;
  return Number(((active / values.length) * 100).toFixed(1));
}

function namedBarBand(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes('theta')) return 'Theta';
  if (normalized.includes('alpha')) return 'Alpha';
  if (normalized.includes('smr')) return 'SMR';
  if (normalized.includes('hi')) return 'Hi-Beta';
  if (normalized.includes('beta')) return 'Beta+';
  if (normalized.includes('slow') || normalized.includes('delta')) return 'Delta';
  return label;
}

function trackUrlFor(urls: Record<string, string>, band: BandDefinition | BandTelemetry) {
  return urls[band.id] ?? (band.label.toLowerCase().includes('theta') ? CREEK_URL : ALPHA_WAVES_URL);
}

function effectUrlFor(urls: Record<string, string>, band: BandDefinition | BandTelemetry, edge: 'in' | 'out') {
  const key = `${band.id}.${edge}`;
  if (urls[key]) return urls[key];
  const label = `${band.id} ${band.label}`.toLowerCase();
  if (label.includes('delta') || label.includes('slow')) {
    return edge === 'in' ? '/audio/effects/soft-chime-down.wav' : '/audio/effects/soft-chime-up.wav';
  }
  if (label.includes('beta')) {
    return edge === 'in' ? '/audio/effects/Beep%201.wav' : '/audio/effects/Beep%202.wav';
  }
  return edge === 'in' ? '/audio/effects/soft-chime-up.wav' : '/audio/effects/soft-chime-down.wav';
}

function ContactQualityPanel() {
  const metrics = useDeviceStore((s) => s.metrics);
  const metricsBatch = useDeviceStore((s) => s.metricsBatch);
  const appState = useDeviceStore((s) => s.appState);
  const historyRef = useRef<Pt[]>([]);
  const lastXRef = useRef(0);
  const [history, setHistory] = useState<Pt[]>([]);

  useEffect(() => {
    if (metricsBatch.length === 0) return;
    for (const snap of metricsBatch) {
      const x = snap.elapsed_sec > lastXRef.current ? snap.elapsed_sec : lastXRef.current + 0.25;
      lastXRef.current = x;
      historyRef.current = [...historyRef.current.slice(-420), { x, y: snap.quality_score }];
    }
    setHistory([...historyRef.current]);
  }, [metricsBatch]);

  if (!metrics) {
    return <div style={{ color: 'var(--muted)', fontSize: 12 }}>Waiting for contact quality...</div>;
  }

  const commonModeCorr = metrics.common_mode_corr ?? 0;
  const slowWaveRatio = metrics.slow_wave_ratio ?? 0;
  const lineNoiseRatio = metrics.line_noise_ratio ?? 0;
  const stats = [
    { label: 'Quality score', value: `${metrics.quality_score.toFixed(0)}`, color: qualColor(metrics.quality_score, 70, 40) },
    { label: 'Artifact frac', value: `${(metrics.artifact_fraction * 100).toFixed(0)}%`, color: qualColor(metrics.artifact_fraction, 0.05, 0.2, true) },
    { label: 'Common corr', value: `${(commonModeCorr * 100).toFixed(0)}%`, color: qualColor(commonModeCorr, 0.25, 0.55, true) },
    { label: 'Slow waves', value: `${(slowWaveRatio * 100).toFixed(0)}%`, color: qualColor(slowWaveRatio, 0.25, 0.55, true) },
    { label: '60Hz noise', value: `${(lineNoiseRatio * 100).toFixed(0)}%`, color: qualColor(lineNoiseRatio, 0.08, 0.25, true) },
    { label: 'Notch', value: appState?.notch_60hz ? 'on' : 'off', color: appState?.notch_60hz ? 'var(--fair)' : 'var(--good)' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <StatsGrid stats={stats} />
      <TimelineChart
        series={[{ label: 'Quality', color: '#88aaff', points: history, threshold: 55 }]}
        height={160}
        windowSec={120}
        yMin={0}
        yMax={100}
      />
    </div>
  );
}

const inputStyle = {
  background: '#1a1a28',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '5px 6px',
  fontFamily: 'inherit',
  fontSize: 12,
  minWidth: 0,
} as const;

export default function MasterFeedbackView() {
  const programOutput = useProgramStore((s) => s.programOutput);
  const metrics = useDeviceStore((s) => s.metrics);
  const scene = useAudioScene();
  const bandScene0 = useAudioScene();
  const bandScene1 = useAudioScene();
  const bandScene2 = useAudioScene();
  const bandScene3 = useAudioScene();
  const bandScene4 = useAudioScene();
  const bandScene5 = useAudioScene();
  const bandScenes = useMemo(() => [bandScene0, bandScene1, bandScene2, bandScene3, bandScene4, bandScene5], [bandScene0, bandScene1, bandScene2, bandScene3, bandScene4, bandScene5]);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [bands, setBands] = useState<BandDefinition[]>([]);
  const [baseUrl, setBaseUrl] = useState(BROWN_NOISE_URL);
  const [activeUrl] = useState('silence');
  const [bandTrackUrls, setBandTrackUrls] = useState<Record<string, string>>({});
  const [effectUrls, setEffectUrls] = useState<Record<string, string>>({});
  const [masterVol, setMasterVol] = useState(0.8);
  const [baseVol, setBaseVol] = useState(0.12);
  const [activeVol, setActiveVol] = useState(0.85);
  const [fadeTime, setFadeTime] = useState(1.2);
  const [rewardSpread, setRewardSpread] = useState(0.8);
  const [chartWindowSec, setChartWindowSec] = useState(30);
  const [showThresholds, setShowThresholds] = useState(true);
  const historyRef = useRef<HistoryPoint[]>([]);
  const prevGateRef = useRef<Record<string, boolean>>({});
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const payload = programOutput?.payload as unknown as MasterPayload | undefined;
  const telemetryBands = payload?.bands ?? [];
  const rewardDrive = telemetryBands
    .filter((band) => band.role === 'reward')
    .reduce((max, band) => Math.max(max, band.drive), 0);
  const curvedRewardDrive = rewardCurveDrive(rewardDrive, rewardSpread);
  const audioDrive = payload?.inhibit_active ? 0 : curvedRewardDrive;
  const preset = String(params.preset ?? payload?.preset ?? 'alpha_theta_feedback');
  const mode = payload?.mode ?? 'starting';
  const recentHistory = history.filter((point) => history.length === 0 || point.x >= history[history.length - 1].x - chartWindowSec);
  const playBands = bands.filter((band) => band.role === 'reward').slice(0, bandScenes.length);
  const sfxBands = bands.filter((band) => band.role === 'inhibit_sfx');
  const telemetryById = telemetryBands.reduce<Record<string, BandTelemetry>>((acc, band) => {
    acc[band.id] = band;
    return acc;
  }, {});

  const applyParams = (next: Record<string, unknown>) => {
    setParams((prev) => ({ ...prev, ...next }));
    api.setProgramParams(PROGRAM_ID, next)
      .then((res) => {
        setParams(res.params);
        const nextBands = parseBands(res.params.bands_json);
        if (nextBands.length) setBands(nextBands);
      })
      .catch(() => {});
  };

  const applyBands = (nextBands: BandDefinition[]) => {
    setBands(nextBands);
    applyParams({ preset: 'custom', bands_json: bandJson(nextBands) });
  };

  useEffect(() => {
    api.getProgramParams(PROGRAM_ID)
      .then((res) => {
        setParams(res.params);
        setBands(parseBands(res.params.bands_json));
      })
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    scene.destroy();
    bandScenes.forEach((bandScene) => bandScene.destroy());
  }, [bandScenes, scene]);

  useEffect(() => {
    scene.setVolume(masterVol);
    scene.setTrackVolumes(baseVol, activeVol);
    scene.setCrossfade(audioDrive, fadeTime);
  }, [scene, masterVol, baseVol, activeVol, audioDrive, fadeTime]);

  useEffect(() => {
    bandScenes.forEach((bandScene, index) => {
      const band = playBands[index];
      const telemetry = band ? telemetryById[band.id] : undefined;
      const drive = telemetry ? rewardCurveDrive(telemetry.drive, rewardSpread) : 0;
      bandScene.setVolume(masterVol);
      bandScene.setTrackVolumes(0, activeVol);
      bandScene.setCrossfade(payload?.inhibit_active ? 0 : drive, fadeTime);
    });
  }, [activeVol, bandScenes, fadeTime, masterVol, payload?.inhibit_active, playBands, rewardSpread, telemetryById]);

  useEffect(() => {
    if (!payload) return;
    const next: Record<string, boolean> = {};
    payload.bands.forEach((band) => {
      next[band.id] = band.active;
      if (band.role !== 'inhibit_sfx') return;
      const prev = prevGateRef.current[band.id] ?? false;
      if (prev === band.active) return;
      const edge = band.active ? 'in' : 'out';
      const url = effectUrlFor(effectUrls, band, edge);
      if (url === 'silence') return;
      const audio = new Audio(resolveAudioUrl(url));
      audio.volume = Math.max(0, Math.min(1, masterVol));
      const timeout = window.setTimeout(() => {
        audio.pause();
        audio.src = '';
      }, 3000);
      audio.addEventListener('ended', () => window.clearTimeout(timeout), { once: true });
      audio.play().catch(() => window.clearTimeout(timeout));
    });
    prevGateRef.current = next;
  }, [effectUrls, masterVol, payload]);

  useEffect(() => {
    if (!payload || !programOutput) return;
    if (historyRef.current.length > 0 && programOutput.elapsed < historyRef.current[historyRef.current.length - 1].x) {
      historyRef.current = [];
      setHistory([]);
    }
    const byId = payload.bands.reduce<Record<string, BandTelemetry>>((acc, band) => {
      acc[band.id] = band;
      return acc;
    }, {});
    historyRef.current = [...historyRef.current.slice(-900), { x: programOutput.elapsed, bands: byId }];
    setHistory([...historyRef.current]);
  }, [payload, programOutput]);

  const loadScene = async () => {
    await Promise.all([
      scene.load(baseUrl === 'silence' ? null : baseUrl, activeUrl === 'silence' ? null : activeUrl),
      ...bandScenes.map((bandScene, index) => {
        const band = playBands[index];
        const url = band ? trackUrlFor(bandTrackUrls, band) : 'silence';
        return bandScene.load(null, url === 'silence' ? null : url);
      }),
    ]);
  };

  const chartBandDefs = telemetryBands.map((band, index) => ({
    key: band.id,
    label: band.label,
    color: colorForBand(band, index),
    value: (point: HistoryPoint) => point.bands[band.id]?.value ?? 0,
    threshold: (point: HistoryPoint) => point.bands[band.id]?.threshold ?? 0,
    onThresholdChange: (threshold: number) => {
      const target_pct = pctForThreshold(recentHistory, band.id, threshold, band.direction);
      applyBands(bands.map((item) => item.id === band.id ? { ...item, target_pct } : item));
    },
  }));
  const driveDefs = telemetryBands.map((band, index) => ({
    key: `${band.id}_drive`,
    label: `${band.label} drive`,
    color: colorForBand(band, index),
    value: (point: HistoryPoint) => point.bands[band.id]?.drive ?? 0,
  }));
  const stateLines = telemetryBands.map((band, index) => ({
    key: band.id,
    label: band.label,
    color: colorForBand(band, index),
    active: (point: HistoryPoint) => Boolean(point.bands[band.id]?.active),
  }));
  const overlaySource = telemetryBands.length ? telemetryBands : bands;
  const overlays: SpectralBandOverlay[] = overlaySource.map((band, index) => {
    const telemetry = telemetryBands.find((item) => item.id === band.id);
    return {
      ...band,
      color: colorForBand(band, index),
      threshold: telemetry?.threshold,
      active: telemetry?.active,
    };
  });
  const barBands = [...new Set(telemetryBands.map((band) => namedBarBand(band.label)))];
  const rewardCurveMarkers = playBands.map((band, index) => {
    const telemetry = telemetryById[band.id];
    const inputDrive = telemetry?.drive ?? 0;
    return {
      id: band.id,
      label: band.label,
      color: colorForBand(band, index),
      inputDrive,
      outputDrive: payload?.inhibit_active ? 0 : rewardCurveDrive(inputDrive, rewardSpread),
    };
  });

  const main = (
    <>
      <Panel bodyStyle={{ padding: 0 }}>
        <NeurofeedbackCharts
          points={history}
          bandDefs={chartBandDefs}
          clarityDefs={driveDefs}
          middleContent={
            <InhibitStateTimeline
              points={history}
              lines={stateLines}
              windowSec={chartWindowSec}
              emptyLabel="Waiting for gate history..."
            />
          }
          chartWindowSec={chartWindowSec}
          onChartWindowSecChange={setChartWindowSec}
          showThresholds={showThresholds}
          onShowThresholdsChange={setShowThresholds}
          emptyLabel="Waiting for feedback history..."
          barBands={barBands.length ? barBands : ['Alpha', 'Theta', 'Beta+']}
          barInitialMode="log_absolute"
          lockBarMode
          barThresholdDefs={telemetryBands.map((band, index) => ({
            band: namedBarBand(band.label),
            color: colorForBand(band, index),
            value: (point: HistoryPoint) => point.bands[band.id]?.threshold ?? 0,
          }))}
          states={[]}
        />
      </Panel>

      <Panel title="Band Selection">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <BandEditor bands={bands} onChange={applyBands} />
          {metrics && (
            <Waveform t={metrics.live_trace_t} y={metrics.live_trace_y} width={800} height={150} color="#55bb88" />
          )}
          <SpectralHistoryPanel bandOverlays={overlays} />
        </div>
      </Panel>

      <Panel title="Contact Quality">
        <ContactQualityPanel />
      </Panel>

      <Panel title="Band Powers">
        <BandPowerPanel initialMode="log_absolute" timelineHeight={220} lockMode />
      </Panel>
    </>
  );

  const sidebar = (
    <>
      <Section title="Preset">
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <span style={{ color: 'var(--muted)' }}>Program preset</span>
          <select
            value={preset}
            onChange={(event) => applyParams({ preset: event.target.value })}
            style={inputStyle}
          >
            {Object.entries(PRESET_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <ProgramParamSlider label="Threshold window" min={1} max={300} step={1} value={typeof params.threshold_window_sec === 'number' ? params.threshold_window_sec : 60} onResolved={setParams} programId={PROGRAM_ID} paramKey="threshold_window_sec" format={(v) => v < 60 ? `${v}s` : `${(v / 60).toFixed(1)}m`} />
      </Section>

      <Section title="Audio">
        <AudioTrackPlayer label="Base track" programId={PROGRAM_ID} eventPrefix="main.base_track" selectedUrl={baseUrl} onSelectedUrlChange={setBaseUrl} />
        {playBands.map((band) => (
          <AudioTrackPlayer
            key={band.id}
            label={`${band.label} track`}
            programId={PROGRAM_ID}
            eventPrefix={`band.${band.id}.track`}
            selectedUrl={trackUrlFor(bandTrackUrls, band)}
            onSelectedUrlChange={(url) => setBandTrackUrls((prev) => ({ ...prev, [band.id]: url }))}
          />
        ))}
        {sfxBands.map((band) => (
          <div key={band.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
            <AudioTrackPlayer
              label={`${band.label} on sound`}
              library="effects"
              programId={PROGRAM_ID}
              eventPrefix={`band.${band.id}.effect_in`}
              selectedUrl={effectUrlFor(effectUrls, band, 'in')}
              onSelectedUrlChange={(url) => setEffectUrls((prev) => ({ ...prev, [`${band.id}.in`]: url }))}
            />
            <AudioTrackPlayer
              label={`${band.label} off sound`}
              library="effects"
              programId={PROGRAM_ID}
              eventPrefix={`band.${band.id}.effect_out`}
              selectedUrl={effectUrlFor(effectUrls, band, 'out')}
              onSelectedUrlChange={(url) => setEffectUrls((prev) => ({ ...prev, [`${band.id}.out`]: url }))}
            />
          </div>
        ))}
        <LoggedSlider label="Master volume" min={0} max={100} step={1} value={Math.round(masterVol * 100)} onChange={(value) => setMasterVol(value / 100)} format={(v) => `${v}%`} programId={PROGRAM_ID} eventKey="main.master_volume_pct" />
        <LoggedSlider label="Base volume" min={0} max={100} step={1} value={Math.round(baseVol * 100)} onChange={(value) => setBaseVol(value / 100)} format={(v) => `${v}%`} programId={PROGRAM_ID} eventKey="main.base_volume_pct" />
        <LoggedSlider label="Reward volume" min={0} max={100} step={1} value={Math.round(activeVol * 100)} onChange={(value) => setActiveVol(value / 100)} format={(v) => `${v}%`} programId={PROGRAM_ID} eventKey="main.reward_volume_pct" />
        <Slider label="Fade time" min={0.2} max={4} step={0.1} value={fadeTime} onChange={setFadeTime} format={(v) => `${v.toFixed(1)}s`} />
        <Slider label="Reward curve" min={1} max={30} step={1} value={Math.round(rewardSpread * 10)} onChange={(v) => setRewardSpread(v / 10)} format={(v) => `${(v / 10).toFixed(1)}`} />
        <RewardCurvePreview spread={rewardSpread} markers={rewardCurveMarkers} />
      </Section>

      <SessionControls
        programId={PROGRAM_ID}
        programTitle="Master"
        onStarted={async () => {
          scene.play();
          bandScenes.forEach((bandScene) => bandScene.play());
          await loadScene();
        }}
        onStopped={() => {
          scene.stop();
          bandScenes.forEach((bandScene) => bandScene.stop());
        }}
      />
    </>
  );

  return (
    <ProgramLayout
      title="Master"
      mode={mode}
      statusText={programOutput?.status_text}
      main={main}
      sidebar={sidebar}
    />
  );
}
