import { useEffect, useRef, useState } from 'react';
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

    const PAD_L = 34;
    const PAD_R = 8;
    const PAD_B = 18;
    const W = resolvedW - PAD_L - PAD_R;
    const H = height - PAD_B;

    ctx.fillStyle = '#13131e';
    ctx.fillRect(0, 0, resolvedW, height);

    const freqSpan = maxFreq - minFreq || 1;
    const fToX = (f: number) => PAD_L + ((f - minFreq) / freqSpan) * W;

    for (const b of BAND_REGIONS) {
      if (b.hi <= minFreq || b.lo >= maxFreq) continue;
      const x0 = fToX(Math.max(b.lo, minFreq));
      const x1 = fToX(Math.min(b.hi, maxFreq));
      ctx.fillStyle = b.color + '22';
      ctx.fillRect(x0, 0, x1 - x0, H);
    }

    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const gy = (i / 4) * H;
      ctx.beginPath(); ctx.moveTo(PAD_L, gy); ctx.lineTo(resolvedW - PAD_R, gy); ctx.stroke();
    }

    const maxV = Math.max(...smoothed, ...referenceValues, 1e-12);
    const vToY = (v: number) => H - (v / maxV) * H * 0.95;

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
    ctx.strokeStyle = '#cc6666';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x60, 0); ctx.lineTo(x60, H); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#cc6666aa';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('60Hz', Math.max(2, x60 - 28), 10);

    ctx.fillStyle = '#44445a';
    ctx.font = '9px ui-monospace, monospace';
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
      if (x1 - x0 > tw + 2) ctx.fillText(b.name, cx - tw / 2, H - 4);
    }

    if (referenceFreqs.length > 0) {
      ctx.fillStyle = '#85859599';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(referenceLabel, PAD_L + 4, H - 4);
    }
  }, [freqs, values, referenceFreqs, referenceValues, referenceLabel, resolvedW, height, minFreq, maxFreq, smoothing]);

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
