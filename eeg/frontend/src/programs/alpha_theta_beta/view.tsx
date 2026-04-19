import React, { useEffect, useRef, useState } from 'react';
import { useProgramStore } from '../../state/programStore';
import { useDeviceStore } from '../../state/deviceStore';
import { useAudioScene } from '../../audio/useAudioScene';
import { Section } from '../../components/controls/Section';
import { TrackPicker } from '../../components/controls/TrackPicker';
import { Slider } from '../../components/controls/Slider';
import { SessionControls } from '../../components/session/SessionControls';
import { QualityBadge } from '../../components/session/QualityBadge';
import { ElapsedTimer } from '../../components/session/ElapsedTimer';
import { BandBars } from '../../components/graphs/BandBars';
import { TimelineChart } from '../../components/graphs/TimelineChart';
import { PSDPlot } from '../../components/graphs/PSDPlot';

interface ATBPayload {
  mode: string;
  drives: { alpha: number; theta: number; beta: number };
  alpha_clarity: number;
  theta_clarity: number;
  beta_clarity: number;
  alpha_samples: number;
  theta_samples: number;
  beta_samples: number;
}

interface HistoryPoint { x: number; y: number }

export default function AlphaThetaBetaView() {
  const programOutput = useProgramStore((s) => s.programOutput);
  const metrics       = useDeviceStore((s) => s.metrics);

  const alphaScene = useAudioScene();
  const thetaScene = useAudioScene();
  const betaScene  = useAudioScene();

  const [alphaBase,  setAlphaBase]  = useState('silence');
  const [alphaClear, setAlphaClear] = useState('silence');
  const [thetaBase,  setThetaBase]  = useState('silence');
  const [thetaClear, setThetaClear] = useState('silence');
  const [betaBase,   setBetaBase]   = useState('silence');
  const [betaClear,  setBetaClear]  = useState('silence');
  const [masterVol,  setMasterVol]  = useState(0.8);
  const [responseTime, setResponseTime] = useState(1.2);

  const alphaHistRef = useRef<HistoryPoint[]>([]);
  const thetaHistRef = useRef<HistoryPoint[]>([]);
  const betaHistRef  = useRef<HistoryPoint[]>([]);
  const [alphaHist, setAlphaHist] = useState<HistoryPoint[]>([]);
  const [thetaHist, setThetaHist] = useState<HistoryPoint[]>([]);
  const [betaHist,  setBetaHist]  = useState<HistoryPoint[]>([]);

  const payload = programOutput?.payload as ATBPayload | undefined;

  useEffect(() => {
    if (!payload || !programOutput) return;
    const e = programOutput.elapsed;
    const push = (ref: React.MutableRefObject<HistoryPoint[]>, y: number, set: React.Dispatch<React.SetStateAction<HistoryPoint[]>>) => {
      ref.current = [...ref.current.slice(-240), { x: e, y }];
      set([...ref.current]);
    };
    push(alphaHistRef, payload.alpha_clarity, setAlphaHist);
    push(thetaHistRef, payload.theta_clarity, setThetaHist);
    push(betaHistRef,  payload.beta_clarity,  setBetaHist);

    alphaScene.setVolume(masterVol);
    thetaScene.setVolume(masterVol);
    betaScene.setVolume(masterVol);
    alphaScene.setCrossfade(payload.drives.alpha, responseTime);
    thetaScene.setCrossfade(payload.drives.theta, responseTime);
    betaScene.setCrossfade(payload.drives.beta,   responseTime);
  }, [payload, programOutput, masterVol, responseTime]);

  const handleLoadAll = async () => {
    const toUrl = (u: string) => u === 'silence' ? null : u;
    await Promise.all([
      alphaScene.load(toUrl(alphaBase), toUrl(alphaClear)),
      thetaScene.load(toUrl(thetaBase), toUrl(thetaClear)),
      betaScene.load(toUrl(betaBase),   toUrl(betaClear)),
    ]);
    alphaScene.play(); thetaScene.play(); betaScene.play();
  };

  const mode = payload?.mode ?? '—';

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, color: '#ddd', fontFamily: 'ui-monospace, monospace', fontSize: '13px' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: '0.9em', fontWeight: 600 }}>Alpha-Theta-Beta — {mode}</div>

        {metrics && (
          <>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <QualityBadge label={metrics.quality_label} score={metrics.quality_score} />
              <ElapsedTimer elapsed={metrics.elapsed_sec} />
            </div>
            <BandBars bands={metrics.bands} mode="smoothed" />
            <PSDPlot freqs={metrics.psd_freqs} values={metrics.psd_values} width={400} height={100} />
          </>
        )}

        <TimelineChart
          series={[
            { label: 'Alpha', color: '#f0cc44', points: alphaHist },
            { label: 'Theta', color: '#55bb88', points: thetaHist },
            { label: 'Beta',  color: '#e05050', points: betaHist  },
          ]}
          width={400}
          height={120}
          windowSec={120}
        />

        {payload && (
          <div style={{ display: 'flex', gap: 12, fontSize: '0.85em', color: '#aaa' }}>
            <span>α={payload.alpha_clarity.toFixed(2)}</span>
            <span>θ={payload.theta_clarity.toFixed(2)}</span>
            <span>β={payload.beta_clarity.toFixed(2)}</span>
          </div>
        )}
      </div>

      <div style={{ width: 240, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Section title="Alpha Audio">
          <TrackPicker label="Base"  value={alphaBase}  onChange={setAlphaBase}  />
          <TrackPicker label="Clear" value={alphaClear} onChange={setAlphaClear} />
        </Section>
        <Section title="Theta Audio">
          <TrackPicker label="Base"  value={thetaBase}  onChange={setThetaBase}  />
          <TrackPicker label="Clear" value={thetaClear} onChange={setThetaClear} />
        </Section>
        <Section title="Beta Audio">
          <TrackPicker label="Base"  value={betaBase}   onChange={setBetaBase}   />
          <TrackPicker label="Clear" value={betaClear}  onChange={setBetaClear}  />
        </Section>
        <button onClick={handleLoadAll} style={{ background: '#2980b9', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 10px', cursor: 'pointer' }}>
          Load All & Preview
        </button>
        <Slider label="Master volume" min={0} max={100} step={1} value={Math.round(masterVol * 100)}
          onChange={(v) => setMasterVol(v / 100)} format={(v) => `${v}%`} />
        <Slider label="Response time" min={2} max={40} step={1} value={Math.round(responseTime * 10)}
          onChange={(v) => setResponseTime(v / 10)} format={(v) => `${(v / 10).toFixed(1)}s`} />
        <SessionControls programId="alpha_theta_beta" programTitle="Alpha-Theta-Beta Feedback" />
      </div>
    </div>
  );
}
