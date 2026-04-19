import React, { useEffect, useRef } from 'react';

interface Props {
  freqs: number[];
  values: number[];
  width?: number;
  height?: number;
}

export function PSDPlot({ freqs, values, width = 300, height = 120 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || freqs.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width  = width;
    canvas.height = height;
    ctx.fillStyle = '#13131e';
    ctx.fillRect(0, 0, width, height);

    const maxV = Math.max(...values, 1e-12);
    ctx.beginPath();
    ctx.strokeStyle = '#4488ff';
    ctx.lineWidth   = 1.5;
    freqs.forEach((f, i) => {
      const x = (f / 40) * width;
      const y = height - (values[i] / maxV) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [freqs, values, width, height]);

  return <canvas ref={canvasRef} style={{ display: 'block', width, height }} />;
}
