import { useEffect, useRef, useState } from 'react';
import { useCanvasSize } from './useCanvasSize';
import { ComponentSettings } from '../controls/ComponentSettings';
import { Slider } from '../controls/Slider';

interface Props {
  t: number[];
  y: number[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
}

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.floor((p / 100) * (s.length - 1)))];
}

export function Waveform({ t, y, width = 600, height = 140, color = '#4488ff', label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size      = useCanvasSize(width, height);
  const [viewSec, setViewSec] = useState(8);
  width = size.width;

  const totalSec = t.length > 1 ? t[t.length - 1] - t[0] : 8;
  const maxView  = Math.max(1, Math.ceil(totalSec));

  // Crop to last viewSec seconds
  const tEnd   = t[t.length - 1] ?? 0;
  const tStart = tEnd - viewSec;
  const startIdx = t.findIndex((v) => v >= tStart);
  const tView  = startIdx >= 0 ? t.slice(startIdx) : t;
  const yView  = startIdx >= 0 ? y.slice(startIdx) : y;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = width  * dpr;
    canvas.height = height * dpr;
    canvas.style.width  = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#13131e';
    ctx.fillRect(0, 0, width, height);

    if (tView.length < 2) return;

    const lo = pct(yView, 2);
    const hi = pct(yView, 98);
    const pad = Math.max((hi - lo) * 0.15, 0.5);
    const yMin = lo - pad;
    const yMax = hi + pad;
    const ySpan = yMax - yMin || 1;

    const tMin = tView[0];
    const tMax = tView[tView.length - 1] || tMin + 1;
    const tSpan = tMax - tMin || 1;

    const px = (ti: number) => ((ti - tMin) / tSpan) * width;
    const py = (v: number)  => height - ((v - yMin) / ySpan) * height;

    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const gy = (i / 4) * height;
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(width, gy); ctx.stroke();
    }

    const zy = py(0);
    if (zy > 0 && zy < height) {
      ctx.strokeStyle = '#303050';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, zy); ctx.lineTo(width, zy); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    tView.forEach((ti, i) => {
      const x = px(ti);
      const yv = py(yView[i]);
      if (i === 0) ctx.moveTo(x, yv);
      else ctx.lineTo(x, yv);
    });
    ctx.stroke();

    ctx.fillStyle = '#44445a';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText(`${yMax.toFixed(0)}µV`, 3, 10);
    ctx.fillText(`${yMin.toFixed(0)}µV`, 3, height - 3);

    if (label) {
      ctx.fillStyle = '#55556a';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(label, width - ctx.measureText(label).width - 4, height - 3);
    }
  }, [tView, yView, width, height, color, label]);

  const settingsPanel = (
    <>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em' }}>Waveform Settings</div>
      <Slider
        label="View window"
        min={1} max={Math.max(8, maxView)} step={0.5}
        value={viewSec}
        onChange={setViewSec}
        format={(v) => `${v.toFixed(1)}s`}
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
