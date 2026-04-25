interface Props {
  label: string;
  min: number;
  max: number;
  step: number;
  valueMin: number;
  valueMax: number;
  onChangeMin: (v: number) => void;
  onChangeMax: (v: number) => void;
  format?: (v: number) => string;
}

export function RangeSlider({ label, min, max, step, valueMin, valueMax, onChangeMin, onChangeMax, format }: Props) {
  const fmt = format ?? String;
  const pMin = ((valueMin - min) / (max - min)) * 100;
  const pMax = ((valueMax - min) / (max - min)) * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85em' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>

      {/* Track area */}
      <div style={{ position: 'relative', height: 20 }}>
        {/* Full track background */}
        <div style={{
          position: 'absolute', top: '50%', transform: 'translateY(-50%)',
          left: 6, right: 6, height: 2, borderRadius: 1, background: '#2a2a3e',
          pointerEvents: 'none',
        }} />
        {/* Active segment */}
        <div style={{
          position: 'absolute', top: '50%', transform: 'translateY(-50%)',
          left: `calc(6px + ${pMin / 100} * (100% - 12px))`,
          width: `calc(${(pMax - pMin) / 100} * (100% - 12px))`,
          height: 2, background: 'var(--accent)',
          pointerEvents: 'none',
        }} />
        {/* Min circle */}
        <div style={{
          position: 'absolute', top: '50%',
          left: `calc(6px + ${pMin / 100} * (100% - 12px))`,
          transform: 'translate(-50%, -50%)',
          width: 10, height: 10, borderRadius: '50%',
          background: 'var(--accent)', pointerEvents: 'none',
        }} />
        {/* Max circle */}
        <div style={{
          position: 'absolute', top: '50%',
          left: `calc(6px + ${pMax / 100} * (100% - 12px))`,
          transform: 'translate(-50%, -50%)',
          width: 10, height: 10, borderRadius: '50%',
          background: 'var(--accent)', pointerEvents: 'none',
        }} />
        {/* Invisible inputs on top */}
        <input
          className="dual-range-input"
          type="range" min={min} max={max} step={step} value={valueMin}
          onChange={(e) => onChangeMin(Math.min(Number(e.target.value), valueMax - step))}
          style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'ew-resize', margin: 0, padding: 0 }}
        />
        <input
          className="dual-range-input"
          type="range" min={min} max={max} step={step} value={valueMax}
          onChange={(e) => onChangeMax(Math.max(Number(e.target.value), valueMin + step))}
          style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'ew-resize', margin: 0, padding: 0 }}
        />
      </div>

      {/* Value labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text)', fontWeight: 600 }}>
        <span>{fmt(valueMin)}</span>
        <span>{fmt(valueMax)}</span>
      </div>
    </div>
  );
}
