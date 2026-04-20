import { useEffect, useRef } from 'react';

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

    if (t.length < 2) return;

    const lo = pct(y, 2);
    const hi = pct(y, 98);
    const pad = Math.max((hi - lo) * 0.15, 0.5);
    const yMin = lo - pad;
    const yMax = hi + pad;
    const ySpan = yMax - yMin || 1;

    const tMin = t[0];
    const tMax = t[t.length - 1] || tMin + 1;
    const tSpan = tMax - tMin || 1;

    const px = (ti: number) => ((ti - tMin) / tSpan) * width;
    const py = (v: number) => height - ((v - yMin) / ySpan) * height;

    // Grid lines
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const gy = (i / 4) * height;
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(width, gy); ctx.stroke();
    }

    // Zero line (dashed)
    const zy = py(0);
    if (zy > 0 && zy < height) {
      ctx.strokeStyle = '#303050';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, zy); ctx.lineTo(width, zy); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Waveform
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    t.forEach((ti, i) => {
      const x = px(ti);
      const yv = py(y[i]);
      if (i === 0) ctx.moveTo(x, yv);
      else ctx.lineTo(x, yv);
    });
    ctx.stroke();

    // µV range label
    ctx.fillStyle = '#44445a';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText(`${yMax.toFixed(0)}µV`, 3, 10);
    ctx.fillText(`${yMin.toFixed(0)}µV`, 3, height - 3);

    // Label
    if (label) {
      ctx.fillStyle = '#55556a';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(label, width - ctx.measureText(label).width - 4, height - 3);
    }
  }, [t, y, width, height, color, label]);

  return <canvas ref={canvasRef} style={{ display: 'block' }} />;
}
