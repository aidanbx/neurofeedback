import { useEffect, useMemo, useRef } from 'react';
import { useCanvasSize } from './useCanvasSize';

interface Point {
  x: number;
}

interface BandSeries<T extends Point> {
  key: string;
  label: string;
  color: string;
  value: (point: T) => number;
  threshold?: (point: T) => number;
  valueOpacity?: string;
  thresholdOpacity?: string;
  lineWidth?: number;
  thresholdLineWidth?: number;
}

interface OverlaySeries<T extends Point> {
  key: string;
  label: string;
  color: string;
  value: (point: T) => number;
  scale?: 'band' | 'unit';
  lineWidth?: number;
}

interface StateRegion<T extends Point> {
  key: string;
  label: string;
  color: string;
  active: (point: T) => boolean;
}

interface ThresholdHandle<T extends Point> {
  key: string;
  label: string;
  color: string;
  value: (point: T) => number;
  onChange: (value: number) => void;
}

interface Props<T extends Point> {
  points: T[];
  bands: BandSeries<T>[];
  overlays?: OverlaySeries<T>[];
  states?: StateRegion<T>[];
  thresholdHandles?: ThresholdHandle<T>[];
  height?: number;
  width?: number;
  windowSec?: number;
  emptyLabel?: string;
  showLegend?: boolean;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function FeedbackTimelineChart<T extends Point>({
  points,
  bands,
  overlays = [],
  states = [],
  thresholdHandles = [],
  height = 260,
  width = 800,
  windowSec = 120,
  emptyLabel = 'Waiting for feedback history…',
  showLegend = true,
}: Props<T>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const interactionRef = useRef<{
    xScale: (value: number) => number;
    valueFromY: (y: number) => number;
    padTop: number;
    plotH: number;
    handleZones: Array<{ key: string; x: number; y: number; radius: number }>;
  } | null>(null);
  const dragHandleKeyRef = useRef<string | null>(null);
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

    ctx.font = '10px ui-monospace, monospace';
    const legend = showLegend ? [
      ...bands.map((band) => ({ label: band.label, color: band.color })),
      ...overlays.map((overlay) => ({ label: overlay.label, color: overlay.color })),
      ...states.map((state) => ({ label: state.label, color: state.color })),
    ] : [];
    const legendStartX = 50;
    const legendTop = 10;
    const legendRowHeight = 14;
    const legendMaxX = chartWidth - 16;
    let legendRows = 0;
    if (legend.length > 0) {
      let cursorX = legendStartX;
      legendRows = 1;
      legend.forEach((item) => {
        const itemWidth = 16 + ctx.measureText(item.label).width + 18;
        if (cursorX > legendStartX && cursorX + itemWidth > legendMaxX) {
          legendRows += 1;
          cursorX = legendStartX;
        }
        cursorX += itemWidth;
      });
    }

    const PAD = {
      top: legendRows > 0 ? 12 + legendRows * legendRowHeight + 8 : 34,
      right: 16,
      bottom: 24,
      left: 46,
    };
    const plotW = Math.max(1, chartWidth - PAD.left - PAD.right);
    const plotH = Math.max(1, height - PAD.top - PAD.bottom);

    const bandValues = visible.flatMap((point) => bands.flatMap((band) => {
      const values = [finite(band.value(point))];
      if (band.threshold) values.push(finite(band.threshold(point)));
      return values;
    }));
    const latestX = visible[visible.length - 1]?.x ?? 0;
    const xMin = Math.max(0, latestX - windowSec);
    const xMax = Math.max(xMin + 1, latestX);
    const yLo = bandValues.length ? Math.min(...bandValues) : -1;
    const yHi = bandValues.length ? Math.max(...bandValues) : 1;
    const ySpan = Math.max(1.5, yHi - yLo);
    const yMin = yLo - ySpan * 0.15;
    const yMax = yHi + ySpan * 0.15;
    const xScale = (x: number) => PAD.left + ((x - xMin) / Math.max(1e-6, xMax - xMin)) * plotW;
    const bandY = (value: number) => PAD.top + plotH - ((value - yMin) / Math.max(1e-6, yMax - yMin)) * plotH;
    const unitY = (value: number) => PAD.top + plotH - Math.max(0, Math.min(1, value)) * plotH;
    const valueFromY = (y: number) => yMax - ((y - PAD.top) / Math.max(1e-6, plotH)) * (yMax - yMin);

    interactionRef.current = {
      xScale,
      valueFromY,
      padTop: PAD.top,
      plotH,
      handleZones: [],
    };

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace, monospace';
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + plotW, y);
      ctx.stroke();
      const value = yMax - ((y - PAD.top) / plotH) * (yMax - yMin);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.textAlign = 'right';
      ctx.fillText(value.toFixed(1), PAD.left - 6, y + 3);
    }

    if (!visible.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.24)';
      ctx.textAlign = 'center';
      ctx.font = '13px ui-monospace, monospace';
      ctx.fillText(emptyLabel, chartWidth / 2, height / 2);
      return;
    }

    states.forEach((state) => {
      ctx.fillStyle = state.color;
      let startIndex = -1;
      visible.forEach((point, index) => {
        const active = state.active(point);
        if (active && startIndex === -1) startIndex = index;
        const nextActive = index < visible.length - 1 ? state.active(visible[index + 1]) : false;
        if (!active || nextActive) return;
        const startPoint = visible[startIndex];
        const endPoint = point;
        const nextPoint = visible[index + 1];
        const x0 = xScale(startPoint.x);
        const x1 = nextPoint ? xScale(nextPoint.x) : xScale(endPoint.x);
        ctx.fillRect(x0, PAD.top, Math.max(3, x1 - x0), plotH);
        startIndex = -1;
      });
    });

    bands.forEach((band) => {
      if (!band.threshold) return;
      ctx.strokeStyle = `${band.color}${band.thresholdOpacity ?? 'dd'}`;
      ctx.lineWidth = band.thresholdLineWidth ?? 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      visible.forEach((point, index) => {
        const x = xScale(point.x);
        const y = bandY(finite(band.threshold?.(point) ?? 0));
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    });

    bands.forEach((band) => {
      ctx.strokeStyle = `${band.color}${band.valueOpacity ?? '88'}`;
      ctx.lineWidth = band.lineWidth ?? 2;
      ctx.beginPath();
      visible.forEach((point, index) => {
        const x = xScale(point.x);
        const y = bandY(finite(band.value(point)));
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    overlays.forEach((overlay) => {
      ctx.strokeStyle = overlay.color;
      ctx.lineWidth = overlay.lineWidth ?? 1.6;
      ctx.beginPath();
      visible.forEach((point, index) => {
        const x = xScale(point.x);
        const y = (overlay.scale ?? 'unit') === 'band'
          ? bandY(finite(overlay.value(point)))
          : unitY(finite(overlay.value(point)));
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
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

    if (legend.length > 0) {
      let cursorX = legendStartX;
      let row = 0;
      ctx.textAlign = 'left';
      ctx.font = '10px ui-monospace, monospace';
      legend.forEach((item) => {
        const itemWidth = 16 + ctx.measureText(item.label).width + 18;
        if (cursorX > legendStartX && cursorX + itemWidth > legendMaxX) {
          row += 1;
          cursorX = legendStartX;
        }
        const y = legendTop + row * legendRowHeight;
        ctx.fillStyle = item.color;
        ctx.fillRect(cursorX, y, 12, 2);
        ctx.fillStyle = item.color;
        ctx.fillText(item.label, cursorX + 16, y + 4);
        cursorX += itemWidth;
      });
    }

    if (thresholdHandles.length > 0 && visible.length > 0) {
      const latestPoint = visible[visible.length - 1];
      interactionRef.current.handleZones = thresholdHandles.map((handle, index) => {
        const y = bandY(handle.value(latestPoint));
        const x = PAD.left + plotW + 8 + (index % 2) * 2;
        ctx.fillStyle = '#05060a';
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = handle.color;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.stroke();
        return { key: handle.key, x, y, radius: 8 };
      });
    }
  }, [bands, chartWidth, height, overlays, showLegend, states, thresholdHandles, visible, windowSec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || thresholdHandles.length === 0) return;

    const toLocal = (event: MouseEvent | PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onPointerDown = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      const { x, y } = toLocal(event);
      const hit = interaction.handleZones.find((zone) => Math.hypot(zone.x - x, zone.y - y) <= zone.radius);
      if (!hit) return;
      dragHandleKeyRef.current = hit.key;
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      const activeKey = dragHandleKeyRef.current;
      const interaction = interactionRef.current;
      if (!activeKey || !interaction) return;
      const handle = thresholdHandles.find((item) => item.key === activeKey);
      if (!handle) return;
      const { y } = toLocal(event);
      const clampedY = Math.max(interaction.padTop, Math.min(interaction.padTop + interaction.plotH, y));
      handle.onChange(interaction.valueFromY(clampedY));
      event.preventDefault();
    };

    const stopDrag = () => {
      dragHandleKeyRef.current = null;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
    };
  }, [thresholdHandles]);

  return (
    <div ref={size.wrapRef} style={{ width: '100%', height }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
