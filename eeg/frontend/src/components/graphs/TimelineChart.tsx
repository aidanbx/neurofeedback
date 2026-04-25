import { useEffect, useRef } from 'react';
import { useCanvasSize } from './useCanvasSize';

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
  zeroLine?: boolean;
  smoothingFactor?: number;
}

const X_TICK_INTERVALS = [5, 10, 15, 20, 30, 60, 120, 300, 600];
const DESIRED_TICKS = 5;

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

function ema(points: { x: number; y: number }[], factor: number): { x: number; y: number }[] {
  if (factor === 0 || points.length === 0) return points;
  const out = new Array(points.length);
  out[0] = points[0];
  for (let i = 1; i < points.length; i++) {
    out[i] = { x: points[i].x, y: (1 - factor) * points[i].y + factor * out[i - 1].y };
  }
  return out;
}

export function TimelineChart({
  series, width = 600, height = 200, windowSec, yMin: yMinProp, yMax: yMaxProp,
  zeroLine = false, smoothingFactor = 0,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(width, height);
  width = size.width;

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
    const PAD_B = 16;
    const W = width - PAD_L;
    const H = height - PAD_B;

    ctx.fillStyle = '#0b0c12';
    ctx.fillRect(0, 0, width, height);

    const smoothed = series.map((s) => ({ ...s, points: ema(s.points, smoothingFactor) }));
    const allPts = smoothed.flatMap((s) => s.points);
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

    // Y grid + labels (drawn outside clip so labels at x=2 show)
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    const yTicks = yMinProp != null || yMaxProp != null
      ? [rawYMin, (rawYMin + rawYMax) / 2, rawYMax]
      : [0, 0.25, 0.5, 0.75, 1.0].filter((v) => v >= rawYMin && v <= rawYMax);
    ctx.font = '9px ui-monospace, monospace';
    yTicks.forEach((v) => {
      const gy = py(v);
      if (gy < 0 || gy > H) return;
      ctx.strokeStyle = '#1e1e2e';
      ctx.beginPath(); ctx.moveTo(PAD_L, gy); ctx.lineTo(width, gy); ctx.stroke();
      ctx.fillStyle = '#44445a';
      ctx.fillText(v.toFixed(1), 2, gy + 3);
    });

    // X ticks + labels
    const tickInterval = X_TICK_INTERVALS.find((t) => xSpan / t <= DESIRED_TICKS) ?? 600;
    const firstTick = Math.ceil(xMin / tickInterval) * tickInterval;
    ctx.font = '9px ui-monospace, monospace';
    for (let t = firstTick; t <= xMax + 0.001; t += tickInterval) {
      const x = px(t);
      if (x < PAD_L || x > width) continue;
      ctx.strokeStyle = '#1e1e2e';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.strokeStyle = '#44445a';
      ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x, H + 4); ctx.stroke();
      const label = fmtTime(t);
      const lw = ctx.measureText(label).width;
      ctx.fillStyle = '#44445a';
      ctx.fillText(label, Math.min(width - lw - 2, Math.max(PAD_L, x - lw / 2)), height - 3);
    }

    if (zeroLine && rawYMin < 0 && rawYMax > 0) {
      const zy = py(0);
      ctx.strokeStyle = '#666680';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(PAD_L, zy); ctx.lineTo(width, zy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#666680';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText('baseline', PAD_L + 4, zy - 3);
    }

    // Clip chart area for series + threshold lines
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_L, 0, W, H);
    ctx.clip();

    smoothed.forEach((s) => {
      if (s.threshold == null) return;
      const ty = py(s.threshold);
      ctx.strokeStyle = s.color + '66';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(PAD_L, ty); ctx.lineTo(width, ty); ctx.stroke();
      ctx.setLineDash([]);
    });

    smoothed.forEach((s) => {
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      let started = false;
      s.points.forEach((p) => {
        const x = px(p.x);
        const y = py(p.y);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    ctx.restore();

    // Legend (top-left, after restore so not clipped)
    let lx = PAD_L + 4;
    ctx.font = '9px ui-monospace, monospace';
    smoothed.forEach((s) => {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, 4, 12, 2);
      ctx.fillStyle = s.color + 'cc';
      ctx.fillText(s.label, lx + 14, 11);
      lx += ctx.measureText(s.label).width + 28;
    });
  }, [series, width, height, windowSec, yMinProp, yMaxProp, zeroLine, smoothingFactor]);

  return (
    <div ref={size.wrapRef} style={{ width: '100%', height }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
