import { useEffect, useRef, useState, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
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

type Pt = { x: number; y: number };

export default function AlphaThetaBetaView() {
  const programOutput = useProgramStore((s) => s.programOutput);
  const metrics       = useDeviceStore((s) => s.metrics);
  const alphaScene    = useAudioScene();
  const thetaScene    = useAudioScene();
  const betaScene     = useAudioScene();

  const [masterVol,    setMasterVol]    = useState(0.8);
  const [responseTime, setResponseTime] = useState(1.2);

  const [alphaBase,  setAlphaBase]  = useState('silence');
  const [alphaClear, setAlphaClear] = useState('silence');
  const [alphaBaseV, setAlphaBaseV] = useState(0.9);
  const [alphaClearV,setAlphaClearV]= useState(0.9);

  const [thetaBase,  setThetaBase]  = useState('silence');
  const [thetaClear, setThetaClear] = useState('silence');
  const [thetaBaseV, setThetaBaseV] = useState(0.9);
  const [thetaClearV,setThetaClearV]= useState(0.9);

  const [betaBase,   setBetaBase]   = useState('silence');
  const [betaClear,  setBetaClear]  = useState('silence');
  const [betaBaseV,  setBetaBaseV]  = useState(0.9);
  const [betaClearV, setBetaClearV] = useState(0.9);

  const [alphaReward, setAlphaReward] = useState(65);
  const [thetaReward, setThetaReward] = useState(65);
  const [betaReward,  setBetaReward]  = useState(65);

  const aHistRef = useRef<Pt[]>([]); const [aHist, setAHist] = useState<Pt[]>([]);
  const tHistRef = useRef<Pt[]>([]); const [tHist, setTHist] = useState<Pt[]>([]);
  const bHistRef = useRef<Pt[]>([]); const [bHist, setBHist] = useState<Pt[]>([]);

  const payload = programOutput?.payload as ATBPayload | undefined;
  const mode    = payload?.mode ?? '—';
  const calibrating = mode === 'calibrating';
  const calibPct    = payload ? Math.min(payload.alpha_samples / 60, 1) * 100 : 0;

  const push = (ref: MutableRefObject<Pt[]>, y: number, set: Dispatch<SetStateAction<Pt[]>>, elapsed: number) => {
    ref.current = [...ref.current.slice(-300), { x: elapsed, y }];
    set([...ref.current]);
  };

  useEffect(() => {
    if (!payload || !programOutput) return;
    const e = programOutput.elapsed;
    push(aHistRef, payload.alpha_clarity, setAHist, e);
    push(tHistRef, payload.theta_clarity, setTHist, e);
    push(bHistRef, payload.beta_clarity,  setBHist, e);

    const vol = masterVol;
    alphaScene.setVolume(vol); thetaScene.setVolume(vol); betaScene.setVolume(vol);
    alphaScene.setCrossfade(payload.drives.alpha, responseTime);
    thetaScene.setCrossfade(payload.drives.theta, responseTime);
    betaScene.setCrossfade(payload.drives.beta,   responseTime);
  }, [payload, programOutput]);

  const toUrl = (u: string) => u === 'silence' ? null : u;

  const handleLoadAll = async () => {
    await Promise.all([
      alphaScene.load(toUrl(alphaBase), toUrl(alphaClear)),
      thetaScene.load(toUrl(thetaBase), toUrl(thetaClear)),
      betaScene.load(toUrl(betaBase),   toUrl(betaClear)),
    ]);
    alphaScene.play(); thetaScene.play(); betaScene.play();
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
          series={[
            { label: 'Alpha', color: '#f0cc44', points: aHist, threshold: 0.5 },
            { label: 'Theta', color: '#55bb88', points: tHist, threshold: 0.5 },
            { label: 'Beta',  color: '#e05050', points: bHist, threshold: 0.5 },
          ]}
          width={700} height={180}
          windowSec={120} yMin={0} yMax={1}
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
      <Section title="Alpha Audio">
        <TrackPicker label="Base"  value={alphaBase}  onChange={setAlphaBase}  />
        <TrackPicker label="Clear" value={alphaClear} onChange={setAlphaClear} />
        <Slider label="Base vol"  min={0} max={100} step={1} value={Math.round(alphaBaseV  * 100)} onChange={(v) => setAlphaBaseV(v  / 100)} format={(v) => `${v}%`} />
        <Slider label="Clear vol" min={0} max={100} step={1} value={Math.round(alphaClearV * 100)} onChange={(v) => setAlphaClearV(v / 100)} format={(v) => `${v}%`} />
        <Slider label="Reward rate" min={40} max={85} step={1} value={alphaReward} onChange={setAlphaReward} format={(v) => `${v}%`} />
      </Section>

      <Section title="Theta Audio">
        <TrackPicker label="Base"  value={thetaBase}  onChange={setThetaBase}  />
        <TrackPicker label="Clear" value={thetaClear} onChange={setThetaClear} />
        <Slider label="Base vol"  min={0} max={100} step={1} value={Math.round(thetaBaseV  * 100)} onChange={(v) => setThetaBaseV(v  / 100)} format={(v) => `${v}%`} />
        <Slider label="Clear vol" min={0} max={100} step={1} value={Math.round(thetaClearV * 100)} onChange={(v) => setThetaClearV(v / 100)} format={(v) => `${v}%`} />
        <Slider label="Reward rate" min={40} max={85} step={1} value={thetaReward} onChange={setThetaReward} format={(v) => `${v}%`} />
      </Section>

      <Section title="Beta Audio">
        <TrackPicker label="Base"  value={betaBase}  onChange={setBetaBase}  />
        <TrackPicker label="Clear" value={betaClear} onChange={setBetaClear} />
        <Slider label="Base vol"  min={0} max={100} step={1} value={Math.round(betaBaseV  * 100)} onChange={(v) => setBetaBaseV(v  / 100)} format={(v) => `${v}%`} />
        <Slider label="Clear vol" min={0} max={100} step={1} value={Math.round(betaClearV * 100)} onChange={(v) => setBetaClearV(v / 100)} format={(v) => `${v}%`} />
        <Slider label="Reward rate" min={40} max={85} step={1} value={betaReward} onChange={setBetaReward} format={(v) => `${v}%`} />
      </Section>

      <button className="btn btn-accent btn-full" onClick={handleLoadAll}>Load All &amp; Preview</button>

      <Section title="Settings">
        <Slider label="Master volume" min={0} max={100} step={1} value={Math.round(masterVol * 100)} onChange={(v) => { setMasterVol(v / 100); }} format={(v) => `${v}%`} />
        <Slider label="Response time" min={2} max={40} step={1} value={Math.round(responseTime * 10)} onChange={(v) => setResponseTime(v / 10)} format={(v) => `${(v / 10).toFixed(1)}s`} />
      </Section>

      {stats.length > 0 && (
        <Section title="Stats">
          <StatsGrid stats={stats} />
        </Section>
      )}

      <SessionControls programId="alpha_theta_beta" programTitle="Alpha-Theta-Beta Feedback" />
    </>
  );

  return (
    <ProgramLayout
      title="Alpha-Theta-Beta"
      mode={mode}
      statusText={programOutput?.status_text}
      calibrating={calibrating}
      calibrationPct={calibPct}
      main={main}
      sidebar={sidebar}
    />
  );
}
