import { useEffect, useMemo, useRef, useState } from 'react';
import { useCanvasSize } from './useCanvasSize';
import { ComponentSettings } from '../controls/ComponentSettings';
import { RangeSlider } from '../controls/RangeSlider';
import { Slider } from '../controls/Slider';

const BAND_REGIONS = [
  { name: 'δ',   lo: 0.5, hi: 4,  color: '#7777dd' },
  { name: 'θ',   lo: 4,   hi: 8,  color: '#55bb88' },
  { name: 'α',   lo: 8,   hi: 13, color: '#f0cc44' },
  { name: 'SMR', lo: 12,  hi: 15, color: '#f08030' },
  { name: 'β',   lo: 15,  hi: 30, color: '#e05050' },
  { name: 'β2',  lo: 30,  hi: 40, color: '#cc55dd' },
  { name: 'γ',   lo: 40,  hi: 60, color: '#6688aa' },
];

type ScaleMode = 'auto' | 'manual';

interface Props {
  freqs: number[];
  values: number[];
  referenceFreqs?: number[];
  referenceValues?: number[];
  referenceLabel?: string;
  width?: number;
  height?: number;
  maxFreq?: number;
}

export function PSDPlot({
  freqs,
  values,
  referenceFreqs = [],
  referenceValues = [],
  referenceLabel = 'raw',
  width = 500,
  height = 160,
  maxFreq: maxFreqProp = 70,
}: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const smoothedRef  = useRef<number[]>([]);
  const size         = useCanvasSize(width, height);
  const resolvedW    = size.width;

  const [smoothing, setSmoothing] = useState(0.3);
  const [minFreq,   setMinFreq]   = useState(0);
  const [maxFreq,   setMaxFreq]   = useState(Math.max(maxFreqProp, 60));
  const [scaleMode, setScaleMode] = useState<ScaleMode>('auto');
  const [manualMin, setManualMin] = useState(0);
  const [manualMax, setManualMax] = useState(1);

  const formatPower = (v: number) => {
    if (!Number.isFinite(v)) return '--';
    if (v === 0) return '0';
    const abs = Math.abs(v);
    if (abs >= 100) return v.toFixed(0);
    if (abs >= 10) return v.toFixed(1);
    if (abs >= 1) return v.toFixed(2);
    return v.toExponential(1);
  };

  const latestAutoRange = useMemo(() => {
    const inRangeValues = freqs
      .map((f, i) => (f >= minFreq && f <= maxFreq ? values[i] : undefined))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const inRangeReferenceValues = referenceFreqs
      .map((f, i) => (f >= minFreq && f <= maxFreq ? referenceValues[i] : undefined))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const maxVisible = Math.max(...inRangeValues, ...inRangeReferenceValues, 1e-12);
    return { min: 0, max: maxVisible };
  }, [freqs, values, referenceFreqs, referenceValues, minFreq, maxFreq]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = resolvedW  * dpr;
    canvas.height = height * dpr;
    canvas.style.width  = `${resolvedW}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // EMA smoothing
    if (smoothedRef.current.length !== values.length) {
      smoothedRef.current = [...values];
    } else {
      smoothedRef.current = values.map((v, i) =>
        smoothing * v + (1 - smoothing) * smoothedRef.current[i]
      );
    }
    const smoothed = smoothedRef.current;

    const PAD_L = 58;
    const PAD_R = 8;
    const PAD_B = 18;
    const PAD_T = 12;
    const W = resolvedW - PAD_L - PAD_R;
    const H = height - PAD_B - PAD_T;

    ctx.fillStyle = '#13131e';
    ctx.fillRect(0, 0, resolvedW, height);

    const freqSpan = maxFreq - minFreq || 1;
    const fToX = (f: number) => PAD_L + ((f - minFreq) / freqSpan) * W;

    for (const b of BAND_REGIONS) {
      if (b.hi <= minFreq || b.lo >= maxFreq) continue;
      const x0 = fToX(Math.max(b.lo, minFreq));
      const x1 = fToX(Math.min(b.hi, maxFreq));
      ctx.fillStyle = b.color + '22';
      ctx.fillRect(x0, PAD_T, x1 - x0, H);
    }

    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const gy = (i / 4) * H;
      ctx.beginPath(); ctx.moveTo(PAD_L, PAD_T + gy); ctx.lineTo(resolvedW - PAD_R, PAD_T + gy); ctx.stroke();
    }

    const visibleValues = freqs
      .map((f, i) => (f >= minFreq && f <= maxFreq ? smoothed[i] : undefined))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const visibleReferenceValues = referenceFreqs
      .map((f, i) => (f >= minFreq && f <= maxFreq ? referenceValues[i] : undefined))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const autoMax = Math.max(...visibleValues, ...visibleReferenceValues, 1e-12);
    const yMin = scaleMode === 'manual' ? Math.min(manualMin, manualMax - 1e-12) : 0;
    const yMax = scaleMode === 'manual' ? Math.max(manualMax, manualMin + 1e-12) : autoMax;
    const ySpan = yMax - yMin || 1;
    const vToY = (v: number) => {
      const norm = Math.max(0, Math.min(1, (v - yMin) / ySpan));
      return PAD_T + H - norm * H * 0.95;
    };

    if (referenceFreqs.length > 0 && referenceValues.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = '#85859566';
      ctx.lineWidth = 1.2;
      let started = false;
      referenceFreqs.forEach((f, i) => {
        if (f < minFreq || f > maxFreq) return;
        const x = fToX(f);
        const yv = vToY(referenceValues[i] ?? 0);
        if (!started) { ctx.moveTo(x, yv); started = true; }
        else ctx.lineTo(x, yv);
      });
      ctx.stroke();
    }

    if (freqs.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = '#aaccff';
      ctx.lineWidth = 1.5;
      let started = false;
      freqs.forEach((f, i) => {
        if (f < minFreq || f > maxFreq) return;
        const x = fToX(f);
        const yv = vToY(smoothed[i]);
        if (!started) { ctx.moveTo(x, yv); started = true; }
        else ctx.lineTo(x, yv);
      });
      ctx.stroke();
    }

    const x60 = fToX(60);
    if (x60 >= PAD_L && x60 <= resolvedW - PAD_R) {
      ctx.strokeStyle = '#cc6666';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x60, PAD_T); ctx.lineTo(x60, PAD_T + H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#cc6666aa';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText('60Hz', Math.max(PAD_L + 2, x60 - 28), PAD_T + 10);
    }

    ctx.fillStyle = '#44445a';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText(formatPower(yMax), 4, PAD_T + 8);
    ctx.fillText(formatPower(yMin), 4, PAD_T + H - 3);
    ctx.save();
    ctx.translate(10, PAD_T + H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('PSD power', -24, 0);
    ctx.restore();

    [minFreq, 8, 13, 20, 30, 60, maxFreq]
      .filter((f) => f >= minFreq && f <= maxFreq)
      .filter((f, i, arr) => arr.indexOf(f) === i)
      .forEach((f) => {
        const x = fToX(f);
        const txt = `${f}`;
        const tx = Math.min(resolvedW - PAD_R - ctx.measureText(txt).width, Math.max(PAD_L, x - ctx.measureText(txt).width / 2));
        ctx.fillText(txt, tx, height - 3);
      });

    ctx.font = '9px ui-monospace, monospace';
    for (const b of BAND_REGIONS) {
      if (b.hi <= minFreq || b.lo >= maxFreq) continue;
      const x0 = fToX(Math.max(b.lo, minFreq));
      const x1 = fToX(Math.min(b.hi, maxFreq));
      const cx = (x0 + x1) / 2;
      ctx.fillStyle = b.color + 'aa';
      const tw = ctx.measureText(b.name).width;
      if (x1 - x0 > tw + 2) ctx.fillText(b.name, cx - tw / 2, PAD_T + H - 4);
    }

    if (referenceFreqs.length > 0) {
      ctx.fillStyle = '#85859599';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(referenceLabel, PAD_L + 4, PAD_T + H - 4);
    }
  }, [freqs, values, referenceFreqs, referenceValues, referenceLabel, resolvedW, height, minFreq, maxFreq, smoothing, scaleMode, manualMin, manualMax]);

  const settingsPanel = (
    <>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em' }}>PSD Settings</div>
      <Slider
        label="Smoothing"
        min={0} max={0.95} step={0.05}
        value={smoothing}
        onChange={setSmoothing}
        format={(v) => v === 0 ? 'off' : v.toFixed(2)}
      />
      <RangeSlider
        label="Frequency range"
        min={0} max={120} step={1}
        valueMin={minFreq}
        valueMax={maxFreq}
        onChangeMin={setMinFreq}
        onChangeMax={setMaxFreq}
        format={(v) => `${v} Hz`}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button
          type="button"
          className={`btn btn-full${scaleMode === 'auto' ? ' active' : ''}`}
          onClick={() => setScaleMode('auto')}
        >
          Auto scale
        </button>
        <button
          type="button"
          className={`btn btn-full${scaleMode === 'manual' ? ' active' : ''}`}
          onClick={() => {
            setManualMin(latestAutoRange.min);
            setManualMax(latestAutoRange.max);
            setScaleMode('manual');
          }}
        >
          Manual scale
        </button>
      </div>
      {scaleMode === 'manual' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.85em' }}>
            <span style={{ color: 'var(--muted)' }}>Low</span>
            <input
              type="number"
              value={manualMin}
              onChange={(e) => setManualMin(Number(e.target.value))}
              style={{ background: '#1a1a28', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3, padding: '4px 6px', fontFamily: 'inherit', fontSize: 12, minWidth: 0 }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.85em' }}>
            <span style={{ color: 'var(--muted)' }}>High</span>
            <input
              type="number"
              value={manualMax}
              onChange={(e) => setManualMax(Number(e.target.value))}
              style={{ background: '#1a1a28', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 3, padding: '4px 6px', fontFamily: 'inherit', fontSize: 12, minWidth: 0 }}
            />
          </label>
        </div>
      )}
      <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.4 }}>
        Auto uses the visible frequency window. The left axis shows the low and high PSD power used for vertical scaling.
      </div>
    </>
  );

  return (
    <ComponentSettings settings={settingsPanel}>
      <div ref={size.wrapRef} style={{ width: '100%', height }}>
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      </div>
    </ComponentSettings>
  );
}
