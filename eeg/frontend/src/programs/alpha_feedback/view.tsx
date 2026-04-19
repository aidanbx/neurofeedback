import React, { useEffect, useRef, useState } from 'react';
import { useProgramStore } from '../../state/programStore';
import { useDeviceStore } from '../../state/deviceStore';
import { useAudioScene } from '../../audio/useAudioScene';
import { Section } from '../../components/controls/Section';
import { Slider } from '../../components/controls/Slider';
import { TrackPicker } from '../../components/controls/TrackPicker';
import { SessionControls } from '../../components/session/SessionControls';
import { QualityBadge } from '../../components/session/QualityBadge';
import { ElapsedTimer } from '../../components/session/ElapsedTimer';
import { BandBars } from '../../components/graphs/BandBars';
import { TimelineChart } from '../../components/graphs/TimelineChart';
import { PSDPlot } from '../../components/graphs/PSDPlot';
import { Waveform } from '../../components/graphs/Waveform';

interface AlphaPayload {
  mode: string;
  drives: { clarity: number };
  thresholds: { alpha: number; theta: number; beta: number };
  reward_active: boolean;
  inhibit_active: boolean;
  theta_inhibit: boolean;
  beta_inhibit: boolean;
  alpha_value: number;
  theta_value: number;
  beta_value: number;
  alpha_samples: number;
  theta_samples: number;
  beta_samples: number;
}

interface HistoryPoint { x: number; y: number }

export default function AlphaFeedbackView() {
  const programOutput = useProgramStore((s) => s.programOutput);
  const metrics       = useDeviceStore((s) => s.metrics);
  const scene         = useAudioScene();

  const [masterVol, setMasterVol] = useState(0.8);
  const [baseVol,   setBaseVol]   = useState(0.9);
  const [clearVol,  setClearVol]  = useState(0.9);
  const [baseUrl,   setBaseUrl]   = useState('silence');
  const [clearUrl,  setClearUrl]  = useState('silence');
  const [responseTime, setResponseTime] = useState(1.2);

  const historyRef = useRef<HistoryPoint[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  const payload = programOutput?.payload as AlphaPayload | undefined;

  // Drive audio from program output
  useEffect(() => {
    if (!payload) return;
    const clarity = payload.drives?.clarity ?? 0;
    scene.setVolume(masterVol);
    scene.setCrossfade(clarity, responseTime);
  }, [payload, masterVol, responseTime, scene]);

  // Build history
  useEffect(() => {
    if (!payload || !programOutput) return;
    const pt = { x: programOutput.elapsed, y: payload.drives?.clarity ?? 0 };
    historyRef.current = [...historyRef.current.slice(-240), pt];
    setHistory([...historyRef.current]);
  }, [payload, programOutput]);

  const handleLoad = async () => {
    await scene.load(baseUrl === 'silence' ? null : baseUrl, clearUrl === 'silence' ? null : clearUrl);
    scene.play();
  };

  const clarity = payload?.drives?.clarity ?? 0;
  const mode    = payload?.mode ?? '—';

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, color: '#ddd', fontFamily: 'ui-monospace, monospace', fontSize: '13px' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: '0.9em', fontWeight: 600 }}>Alpha Feedback — {mode}</div>

        {metrics && (
          <>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <QualityBadge label={metrics.quality_label} score={metrics.quality_score} />
              <ElapsedTimer elapsed={metrics.elapsed_sec} />
              <span style={{ color: clarity > 0.5 ? '#44cc88' : '#888' }}>
                Clarity: {(clarity * 100).toFixed(0)}%
                {payload?.inhibit_active ? ' INHIBIT' : payload?.reward_active ? ' reward' : ''}
              </span>
            </div>
            <BandBars bands={metrics.bands} mode="smoothed" />
            <PSDPlot freqs={metrics.psd_freqs} values={metrics.psd_values} width={400} height={100} />
            <Waveform t={metrics.live_trace_t} y={metrics.live_trace_y} width={400} height={60} />
          </>
        )}

        <TimelineChart
          series={[{ label: 'Clarity', color: '#f0cc44', points: history }]}
          width={400}
          height={120}
          windowSec={120}
        />
      </div>

      <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Section title="Audio">
          <TrackPicker label="Base track" value={baseUrl}  onChange={setBaseUrl}  />
          <TrackPicker label="Clear track" value={clearUrl} onChange={setClearUrl} />
          <button onClick={handleLoad} style={{ background: '#2980b9', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 10px', cursor: 'pointer' }}>
            Load & Preview
          </button>
          <Slider label="Master volume" min={0} max={100} step={1} value={Math.round(masterVol * 100)}
            onChange={(v) => { setMasterVol(v / 100); scene.setVolume(v / 100); }}
            format={(v) => `${v}%`} />
          <Slider label="Base vol" min={0} max={100} step={1} value={Math.round(baseVol * 100)}
            onChange={(v) => setBaseVol(v / 100)} format={(v) => `${v}%`} />
          <Slider label="Clear vol" min={0} max={100} step={1} value={Math.round(clearVol * 100)}
            onChange={(v) => setClearVol(v / 100)} format={(v) => `${v}%`} />
          <Slider label="Response time" min={2} max={40} step={1} value={Math.round(responseTime * 10)}
            onChange={(v) => setResponseTime(v / 10)} format={(v) => `${(v / 10).toFixed(1)}s`} />
        </Section>

        <Section title="Status">
          {payload && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em', color: '#aaa' }}>
              <div>Alpha: {payload.alpha_value.toFixed(3)} (n={payload.alpha_samples})</div>
              <div>Theta: {payload.theta_value.toFixed(3)} (n={payload.theta_samples})</div>
              <div>Beta+hβ: {payload.beta_value.toFixed(3)} (n={payload.beta_samples})</div>
            </div>
          )}
        </Section>

        <SessionControls programId="alpha_feedback" programTitle="Alpha Feedback" />
      </div>
    </div>
  );
}
