import { useEffect, useMemo, useRef } from 'react';
import { useCanvasSize } from './useCanvasSize';

interface Point {
  x: number;
}

interface InhibitLine<T extends Point> {
  key: string;
  label: string;
  color: string;
  active: (point: T) => boolean;
}

interface Props<T extends Point> {
  points: T[];
  lines: InhibitLine<T>[];
  height?: number;
  width?: number;
  windowSec?: number;
  emptyLabel?: string;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

export function InhibitStateTimeline<T extends Point>({
  points,
  lines,
  height = 96,
  width = 800,
  windowSec = 120,
  emptyLabel = 'Waiting for inhibit state history…',
}: Props<T>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(width, height);
  const chartWidth = size.width;

  const visible = useMemo(() => {
    if (points.length === 0) return [];
    const latest = points[points.length - 1].x;
    return points.filter((point) => point.x >= latest - windowSec);
  }, [points, windowSec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = chartWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${chartWidth}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, chartWidth, height);

    const PAD = { top: 14, right: 16, bottom: 22, left: 92 };
    const plotW = Math.max(1, chartWidth - PAD.left - PAD.right);
    const plotH = Math.max(1, height - PAD.top - PAD.bottom);
    const latestX = visible[visible.length - 1]?.x ?? 0;
    const xMin = Math.max(0, latestX - windowSec);
    const xMax = Math.max(xMin + 1, latestX);
    const xScale = (x: number) => PAD.left + ((x - xMin) / Math.max(1e-6, xMax - xMin)) * plotW;

    if (!visible.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.24)';
      ctx.textAlign = 'center';
      ctx.font = '13px ui-monospace, monospace';
      ctx.fillText(emptyLabel, chartWidth / 2, height / 2);
      return;
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    lines.forEach((line, index) => {
      const y = PAD.top + ((index + 0.5) / Math.max(1, lines.length)) * plotH;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + plotW, y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.48)';
      ctx.textAlign = 'right';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(line.label, PAD.left - 8, y + 3);
    });

    lines.forEach((line, index) => {
      const rowTop = PAD.top + (index / Math.max(1, lines.length)) * plotH;
      const rowBottom = PAD.top + ((index + 1) / Math.max(1, lines.length)) * plotH;
      const activeY = rowTop + 6;
      const inactiveY = rowBottom - 6;

      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      visible.forEach((point, pointIndex) => {
        const x = xScale(point.x);
        const y = line.active(point) ? activeY : inactiveY;
        if (pointIndex === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.strokeStyle = line.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      let drawing = false;
      visible.forEach((point, pointIndex) => {
        const active = line.active(point);
        const x = xScale(point.x);
        if (!active) {
          drawing = false;
          return;
        }
        const y = activeY;
        if (!drawing) {
          ctx.moveTo(x, y);
          drawing = true;
        } else {
          ctx.lineTo(x, y);
        }
        const nextPoint = visible[pointIndex + 1];
        if (nextPoint && line.active(nextPoint)) {
          ctx.lineTo(xScale(nextPoint.x), y);
        }
      });
      ctx.stroke();
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px ui-monospace, monospace';
    for (let i = 0; i <= 4; i++) {
      const tick = xMin + ((xMax - xMin) * i) / 4;
      ctx.fillText(fmtTime(tick), xScale(tick), height - 8);
    }
  }, [chartWidth, height, lines, visible, windowSec]);

  return (
    <div ref={size.wrapRef} style={{ width: '100%', height }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
