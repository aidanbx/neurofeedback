import { useEffect, useRef } from 'react';

const BAND_REGIONS = [
  { name: 'δ', lo: 0.5, hi: 4,  color: '#7777dd' },
  { name: 'θ', lo: 4,   hi: 8,  color: '#55bb88' },
  { name: 'α', lo: 8,   hi: 13, color: '#f0cc44' },
  { name: 'β', lo: 15,  hi: 30, color: '#e05050' },
  { name: 'β2', lo: 30, hi: 40, color: '#cc55dd' },
];

interface Props {
  freqs: number[];
  values: number[];
  width?: number;
  height?: number;
  maxFreq?: number;
}

export function PSDPlot({ freqs, values, width = 500, height = 160, maxFreq = 40 }: Props) {
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

    const PAD_B = 18; // bottom padding for labels
    const H = height - PAD_B;

    ctx.fillStyle = '#13131e';
    ctx.fillRect(0, 0, width, height);

    const fToX = (f: number) => (f / maxFreq) * width;

    // Band regions
    for (const b of BAND_REGIONS) {
      const x0 = fToX(Math.max(b.lo, 0));
      const x1 = fToX(Math.min(b.hi, maxFreq));
      ctx.fillStyle = b.color + '22';
      ctx.fillRect(x0, 0, x1 - x0, H);
    }

    // Horizontal grid lines
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const gy = (i / 4) * H;
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(width, gy); ctx.stroke();
    }

    if (freqs.length > 0) {
      const maxV = Math.max(...values, 1e-12);
      const vToY = (v: number) => H - (v / maxV) * H * 0.95;

      // PSD line
      ctx.beginPath();
      ctx.strokeStyle = '#aaccff';
      ctx.lineWidth = 1.5;
      let started = false;
      freqs.forEach((f, i) => {
        if (f > maxFreq) return;
        const x = fToX(f);
        const yv = vToY(values[i]);
        if (!started) { ctx.moveTo(x, yv); started = true; }
        else ctx.lineTo(x, yv);
      });
      ctx.stroke();

      // 60Hz marker
      if (maxFreq >= 60) {
        const x60 = fToX(60);
        ctx.strokeStyle = '#444466';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x60, 0); ctx.lineTo(x60, H); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Freq axis labels
    ctx.fillStyle = '#44445a';
    ctx.font = '9px ui-monospace, monospace';
    [0, 8, 13, 20, 30, maxFreq].forEach((f) => {
      const x = fToX(f);
      const txt = `${f}`;
      ctx.fillText(txt, x - ctx.measureText(txt).width / 2, height - 3);
    });

    // Band name labels
    ctx.font = '9px ui-monospace, monospace';
    for (const b of BAND_REGIONS) {
      const x0 = fToX(b.lo);
      const x1 = fToX(Math.min(b.hi, maxFreq));
      const cx = (x0 + x1) / 2;
      ctx.fillStyle = b.color + 'aa';
      const tw = ctx.measureText(b.name).width;
      if (x1 - x0 > tw + 2) ctx.fillText(b.name, cx - tw / 2, H - 4);
    }
  }, [freqs, values, width, height, maxFreq]);

  return <canvas ref={canvasRef} style={{ display: 'block' }} />;
}
