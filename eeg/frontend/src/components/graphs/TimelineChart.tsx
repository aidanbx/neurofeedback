import { useEffect, useRef } from 'react';

export interface Series {
  label: string;
  color: string;
  points: { x: number; y: number }[];
  threshold?: number;
}

interface Props {
  series: Series[];
  width?: number;
  height?: number;
  windowSec?: number;
  yMin?: number;
  yMax?: number;
}

export function TimelineChart({ series, width = 600, height = 200, windowSec, yMin: yMinProp, yMax: yMaxProp }: Props) {
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

    const PAD_L = 28;
    const W = width - PAD_L;
    const H = height;

    ctx.fillStyle = '#0b0c12';
    ctx.fillRect(0, 0, width, height);

    const allPts = series.flatMap((s) => s.points);
    if (allPts.length === 0) return;

    const allX = allPts.map((p) => p.x);
    const allY = allPts.map((p) => p.y);
    const xMax = Math.max(...allX);
    const xMin = windowSec != null ? xMax - windowSec : Math.min(...allX);
    const rawYMin = yMinProp ?? Math.min(...allY, 0);
    const rawYMax = yMaxProp ?? Math.max(...allY, 1);
    const xSpan = xMax - xMin || 1;
    const ySpan = rawYMax - rawYMin || 1;

    const px = (x: number) => PAD_L + ((x - xMin) / xSpan) * W;
    const py = (y: number) => H - ((y - rawYMin) / ySpan) * H * 0.9 - H * 0.05;

    // Grid lines + Y labels
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    const yTicks = [0, 0.25, 0.5, 0.75, 1.0].filter((v) => v >= rawYMin && v <= rawYMax);
    yTicks.forEach((v) => {
      const gy = py(v);
      ctx.beginPath(); ctx.moveTo(PAD_L, gy); ctx.lineTo(width, gy); ctx.stroke();
      ctx.fillStyle = '#44445a';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(v.toFixed(1), 2, gy + 3);
    });

    // Threshold lines (dashed)
    series.forEach((s) => {
      if (s.threshold == null) return;
      const ty = py(s.threshold);
      ctx.strokeStyle = s.color + '66';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(PAD_L, ty); ctx.lineTo(width, ty); ctx.stroke();
      ctx.setLineDash([]);
    });

    // Series lines
    series.forEach((s) => {
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      let started = false;
      s.points.forEach((p) => {
        if (p.x < xMin) return;
        const x = px(p.x);
        const y = py(p.y);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    // Legend (top-left)
    let lx = PAD_L + 4;
    series.forEach((s) => {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, 4, 12, 2);
      ctx.fillStyle = s.color + 'cc';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(s.label, lx + 14, 11);
      lx += ctx.measureText(s.label).width + 28;
    });
  }, [series, width, height, windowSec, yMinProp, yMaxProp]);

  return <canvas ref={canvasRef} style={{ display: 'block' }} />;
}
