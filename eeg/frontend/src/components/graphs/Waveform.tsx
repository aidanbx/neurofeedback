import React, { useEffect, useRef } from 'react';

interface Props {
  t: number[];
  y: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function Waveform({ t, y, width = 400, height = 80, color = '#4488ff' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || t.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width  = width;
    canvas.height = height;
    ctx.fillStyle = '#13131e';
    ctx.fillRect(0, 0, width, height);

    const minY = Math.min(...y);
    const maxY = Math.max(...y);
    const span = maxY - minY || 1;
    const tMin = t[0];
    const tMax = t[t.length - 1] || tMin + 1;
    const tSpan = tMax - tMin || 1;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.2;
    t.forEach((ti, i) => {
      const x = ((ti - tMin) / tSpan) * width;
      const yv = height - ((y[i] - minY) / span) * height;
      if (i === 0) ctx.moveTo(x, yv);
      else ctx.lineTo(x, yv);
    });
    ctx.stroke();
  }, [t, y, width, height, color]);

  return <canvas ref={canvasRef} style={{ display: 'block', width, height }} />;
}
