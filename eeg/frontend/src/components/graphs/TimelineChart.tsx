import React, { useEffect, useRef } from 'react';

interface Series {
  label: string;
  color: string;
  points: { x: number; y: number }[];
}

interface Props {
  series: Series[];
  xLabel?: string;
  yLabel?: string;
  width?: number;
  height?: number;
  windowSec?: number;
}

export function TimelineChart({ series, width = 500, height = 150, windowSec }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width  = width;
    canvas.height = height;
    ctx.fillStyle = '#13131e';
    ctx.fillRect(0, 0, width, height);

    if (!series.length || !series[0].points.length) return;

    const allX = series.flatMap((s) => s.points.map((p) => p.x));
    const allY = series.flatMap((s) => s.points.map((p) => p.y));
    const xMax = Math.max(...allX);
    const xMin = windowSec != null ? xMax - windowSec : Math.min(...allX);
    const yMin = Math.min(...allY, 0);
    const yMax = Math.max(...allY, 1);
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;

    const px = (x: number) => ((x - xMin) / xSpan) * width;
    const py = (y: number) => height - ((y - yMin) / ySpan) * height;

    series.forEach((s) => {
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth   = 1.5;
      s.points.forEach((p, i) => {
        if (p.x < xMin) return;
        if (i === 0 || s.points[i - 1].x < xMin) ctx.moveTo(px(p.x), py(p.y));
        else ctx.lineTo(px(p.x), py(p.y));
      });
      ctx.stroke();
    });
  }, [series, width, height, windowSec]);

  return <canvas ref={canvasRef} style={{ display: 'block', width, height }} />;
}
